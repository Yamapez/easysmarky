// easysmarky のUI回帰チェック。`npm run verify` で実行する。
//
// dist/easysmarky.iife.js(実際の配布物)を、SmarkyのAPIをスタブしたページに読み込ませ、
// ヘッドレスChromiumで操作して挙動を検証する。playwright/puppeteer は使わず、
// Node のグローバル WebSocket で CDP を直接叩く(依存を増やさないため)。
//
// 重要: --virtual-time-budget は使わないこと。仮想時間ではレンダリング更新が
// 実時間どおりに走らず ResizeObserver が配信されないため、
// 「幅変更後にプレビューが再描画されない」という偽の不具合が出る。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const OUT_DIR = join(HERE, "out");
const PROFILE = join(OUT_DIR, "chrome-profile");
const CHROME = process.env.CHROME_BIN || "chromium";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 静的サーバ
async function startServer() {
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const path = join(REPO_ROOT, rel);
    try {
      const body = await readFile(path);
      res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

// ---------------------------------------------------------------- CDP
async function launchChrome(port) {
  const child = spawn(CHROME, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE}`,
    "--window-size=1400,900",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return { child, wsUrl: page.webSocketDebuggerUrl };
    } catch { /* まだ起動中 */ }
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error(`${CHROME} の DevTools エンドポイントに接続できませんでした`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", (e) => rej(new Error("ws error " + e.message)));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = msg.id && pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
    else slot.resolve(msg.result);
  });
  const send = async (method, params = {}) => {
    await ready;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error("CDP timeout: " + method));
      }, 120000);
    });
  };
  return { ws, send };
}

async function evalJs(send, expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("page exception: " + (d.exception?.description ?? JSON.stringify(d)));
  }
  return r.result.value;
}

const setViewport = (send, width, height) =>
  send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });

async function openHarness(send, url) {
  await send("Page.navigate", { url });
  for (let i = 0; i < 120; i++) {
    await sleep(150);
    const ok = await evalJs(
      send,
      `!!document.getElementById("easysmarky-host")?.shadowRoot?.querySelector(".es-list-item, .es-form")`,
      false,
    );
    if (ok) return;
  }
  throw new Error("オーバーレイが起動しませんでした: " + url);
}

async function screenshot(send, name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT_DIR, name), Buffer.from(data, "base64"));
}

// ---------------------------------------------------------------- アサーション
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
}

/**
 * 表示の縦横比が canvas の内部解像度の比と一致するか(1%以内)。
 * 幅だけ指定して height:auto に任せると、max-height が当たったときに高さだけ潰れて
 * 横に伸びる(v0.8.0の不具合)。ここが唯一その崩れを捕まえる検査。
 */
const ratioOk = (st) =>
  !!st && st.intrinsicRatio > 0 && st.renderedRatio > 0 &&
  Math.abs(st.renderedRatio - st.intrinsicRatio) / st.intrinsicRatio <= 0.01;
/** 高さの上限に当たっているか(= 幅いっぱいには広がらない状態) */
const heightCapped = (st) =>
  !!st && st.maxHeightPx != null && st.renderedHeight >= st.maxHeightPx - 1;

function assertAll(label, r, viewportWidth) {
  const s = r.steps;
  const isMobile = viewportWidth < 900;

  // --- 1設問集中レイアウトの骨格 ---
  // 設問は ア・イ・エ(編集不可)・ウ・オ の5件(page→id順。エは選択式で編集不可、
  // オは縦長の解答欄。ア と オ は最初から入力済み)
  check(`${label}: 設問ストリップに全設問が並ぶ`, s.initial.stripChips === 5, s.initial.stripChips);
  check(`${label}: 最初の設問が開いている`, s.initial.editorName.includes("問1"), s.initial.editorName);
  check(`${label}: 進捗が入力済み数を表す`, s.initial.progress === "入力済み 2/4", s.initial.progress);

  // --- 解答欄オーバーレイ(rim座標は解答用紙のものなので問題ページには出さない) ---
  check(`${label}: 問題ページには解答欄の枠を出さない`, s.initial.rimCount === 0, s.initial.rimCount);
  // rim の座標系は base_sheet.correct_image_size。実機に base_sheet.width/height は
  // 無いので、そこから取ろうとすると枠が1つも出なくなる(実機で実際に起きていた)。
  // 1ページ目の設問はア・イ・エ(編集不可)の3件
  // 凡例は狭い画面では出さない(解答用紙ペインが狭く、本文に重なるため。
  // 枠のラベルが「— 入力中」「— 未入力」と状態を文字で書いている)
  check(`${label}: 解答用紙にそのページの設問ぶんの枠と凡例が出る`,
    s.answerSheet.rimCount === 3 &&
    s.answerSheet.legendDisplay === (isMobile ? "none" : "flex"),
    { rims: s.answerSheet.rimCount, legend: s.answerSheet.legendDisplay, mobile: isMobile });
  check(`${label}: 編集不可の設問は枠もロック表示になる`,
    s.answerSheet.lockedRims === 1, s.answerSheet.lockedRims);
  // 1ページ目は用紙 1000x1400。rim[40,400,920,120] → left 4% / width 92%
  check(`${label}: 枠が用紙サイズに対する百分率で置かれる`,
    s.answerSheet.firstRimStyle?.left === "4%" && s.answerSheet.firstRimStyle?.width === "92%",
    s.answerSheet.firstRimStyle);
  check(`${label}: 入力済み・入力中の枠が塗り分けられる`,
    s.answerSheet.activeRims === 1 && s.answerSheet.filledRims === 0,
    { active: s.answerSheet.activeRims, filled: s.answerSheet.filledRims });

  // --- 解答欄タップ → 入力 ---
  check(`${label}: 解答欄をタップするとその設問が開く`,
    s.afterRimTap.editorName.includes("問1"), s.afterRimTap);
  // 常時上下分割レイアウト: 問題ビューアと入力ペインは、PC・スマホどちらの幅でも
  // 常に両方表示されている(タブ切替で片方が隠れることはもう無い)
  check(`${label}: 問題ビューアと入力の両ペインが常に出る`,
    s.initial.questionPaneDisplay !== "none" && s.initial.formPaneDisplay !== "none",
    `${s.initial.questionPaneDisplay}/${s.initial.formPaneDisplay}`);
  check(`${label}: 初期表示で既存下書きのプレビューが描画される`,
    s.initial.field1.display === "block" && parseFloat(s.initial.field1.width) > 0, s.initial.field1);
  if (s.initial.twoPaneMediaQuery) {
    check(`${label}: 解答欄プレビューの横に問題プレビューが出る`,
      s.initial.questionPreviewDisplay !== "none" && s.initial.questionPreviewCanvasWidth > 0,
      { display: s.initial.questionPreviewDisplay, width: s.initial.questionPreviewCanvasWidth });
  } else {
    check(`${label}: 問題プレビューは狭い画面では出さない`,
      s.initial.questionPreviewDisplay === "none", s.initial.questionPreviewDisplay);
  }
  // 常時分割後の主動線: rimタップ後はテキストエリアにフォーカスが移り、すぐ入力できる
  check(`${label}: 解答欄をタップするとテキストエリアにフォーカスが移る`,
    s.afterRimTap.textareaFocused === true, s.afterRimTap);

  // --- 現在の枠の強調(選択中だけ目立たせ、他は沈める) ---
  check(`${label}: 選択中の枠が強調され、他の枠は沈む`,
    s.emphasis.hasActiveClass === true &&
    parseFloat(s.emphasis.activeOpacity) >= 0.99 &&
    parseFloat(s.emphasis.otherOpacity) < 0.9,
    s.emphasis);

  // --- ズームは設問を切り替えても保持される ---
  check(`${label}: 手動でズームすると設問を切り替えても保持される`,
    s.zoomPersist.afterZoomIn === "150%" && s.zoomPersist.afterFieldSwitch === s.zoomPersist.afterZoomIn,
    s.zoomPersist);

  // --- 手動ズームしていなければ、小さい解答欄へは自動でズームする ---
  check(`${label}: 手動ズームなしで小さい解答欄を選ぶと自動でズームする`,
    parseFloat(s.autoZoom.canvasWidth) > 155 && parseFloat(s.autoZoom.canvasWidth) < 175 &&
    s.autoZoom.lockedCardShown === true,
    s.autoZoom);

  // --- 別ページの設問を選ぶと、その枠が見える位置まで自動でパンする ---
  check(`${label}: 設問を選ぶとその枠が視界に入るまで自動でパンする`,
    s.autoPan.pagerLabel === "2 / 2" && s.autoPan.rimVisible === true, s.autoPan);

  // --- Ctrl+↵ は編集不可の設問を飛ばす ---
  check(`${label}: Ctrl+↵ は編集不可の設問(エ)を飛ばす`,
    s.skipLocked.before.includes("イ") && s.skipLocked.after.includes("ウ") &&
    s.skipLocked.after !== s.skipLocked.before,
    s.skipLocked);

  // --- 設問の移動 ---
  check(`${label}: ストリップで設問を移動できる`,
    s.stripNav.activeChipIndex === 3 && s.stripNav.editorName.includes("ウ"), s.stripNav);
  check(`${label}: 「次の未入力へ」で未入力の設問に移る`,
    s.nextEmpty.textareaValue === "", s.nextEmpty);

  // --- 切り出しプレビューの座標換算 ---
  // rim / cut_margin は base_sheet(1000x1400)の座標系。ハーネスのページ画像は
  // 解答用紙が2.0倍・問題が1.5倍にしてある。ここを換算せずに rim をそのまま画像ピクセルと
  // して扱うと、切り出し範囲が縮んで実物と合わなくなる(実機で出た不具合)。
  // 解答欄1 rim[40,400,920,120]、余白 = cut_margin 20 + プレビュー用 2mm(200dpi で 16)= 36
  //   → 用紙座標で (4,364)-(996,556) = 992x192 → 画像ピクセル(2倍)で 1984x384
  check(`${label}: 切り出しをページ画像の解像度に換算する`,
    s.initial.field1Crop?.intrinsicWidth === 1984 && s.initial.field1Crop?.intrinsicHeight === 384,
    s.initial.field1Crop);
  // 内部解像度が合っていても切り出し位置がズレている可能性があるので、画素で確かめる
  check(`${label}: 切り出した範囲が実際の解答欄と一致する`,
    s.initial.field1CropPixels?.center === "#ffe3e3" &&
    s.initial.field1CropPixels?.margin === "#fffdf5",
    s.initial.field1CropPixels);
  // 設問3は2ページ目(用紙 800x1120・解像度1.25倍)の rim[0,800,760,120]、余白 36。
  // 左は0で、右は用紙幅 800 でクランプ → 796x192 → 画像ピクセル(1.25倍)で 995x240。
  // ページごとの座標系を使わず1ページ目の 1000x1400 を使い回すと値がズレる。
  check(`${label}: ページごとの用紙サイズで切り出しを換算する`,
    s.stripNav.field3Crop?.intrinsicWidth === 995 && s.stripNav.field3Crop?.intrinsicHeight === 240,
    s.stripNav.field3Crop);
  check(`${label}: 用紙端でも解答欄が切り出しに収まる`,
    s.stripNav.field3CenterPixel === "#e3e9ff", s.stripNav.field3CenterPixel);
  // 2ページ目へ送られ、そのページの用紙(800x1120)基準で枠が置かれる。
  // rim[0,800,760,120] → left 0% / top 71.4285…% / width 95% / height 10.714…%
  check(`${label}: 設問を選ぶとその設問のページへ送られる`,
    s.stripNav.pagerLabel === "2 / 2" && s.stripNav.rimCount === 2,
    { pager: s.stripNav.pagerLabel, rims: s.stripNav.rimCount });
  check(`${label}: 枠がページごとの用紙サイズで置かれる`,
    s.stripNav.firstRimStyle?.left === "0%" && s.stripNav.firstRimStyle?.width === "95%",
    s.stripNav.firstRimStyle);
  // 問題ページは別の座標系(question_image_size)・別解像度(1.5倍)。
  //   992x192 → 画像ピクセルで 1488x288
  check(`${label}: 問題プレビューは問題ページ自身の座標系・解像度で切り出す`,
    s.initial.questionCrop?.intrinsicWidth === 1488 && s.initial.questionCrop?.intrinsicHeight === 288,
    s.initial.questionCrop);
  // プレビューは使える幅いっぱいに拡縮される。canvas の内部解像度のまま置くと
  // 表示が実質1:1になり、解答欄の大きさ次第で桁違いのサイズで出てしまう
  // (実機で 78x130 の設問と 665x76 の設問が同じペインに同居する)
  // 差の許容値は .es-preview-wrap の左右ボーダー(2px×2辺=4px)ぶん
  {
    // 両ペイン常時表示なので、初期表示ですでにプレビューが描かれている
    const shown = s.initial.field1;
    // 幅いっぱいに広がるのは高さの上限に当たっていないとき。当たったら縦横比を
    // 保つために幅は狭くなる(縦長側は下の tallField で見る)
    check(`${label}: プレビューが使える幅いっぱいに拡縮される`,
      !!shown && shown.slotWidth > 0 && shown.renderedWidth !== shown.intrinsicWidth &&
      (heightCapped(shown)
        ? shown.renderedWidth <= shown.slotWidth + 1
        : Math.abs(shown.renderedWidth - shown.slotWidth) <= 5),
      shown && { rendered: shown.renderedWidth, slot: shown.slotWidth,
                 intrinsic: shown.intrinsicWidth, capped: heightCapped(shown) });
  }
  // 文字は解答欄の中央に置かれる。フォント実測値に依存しないので環境差で揺れない
  {
    // 両ペイン常時表示なので、初期表示ですでにプレビューが描かれている
    const shown = s.initial.field1;
    check(`${label}: プレビューの文字が解答欄の中央に置かれる`,
      !!shown && shown.centerX != null &&
      Math.abs(shown.centerX - shown.renderedWidth / 2) < 1.5 &&
      Math.abs(shown.centerY - shown.renderedHeight / 2) < 1.5,
      shown && { centerX: shown.centerX, centerY: shown.centerY,
                 w: shown.renderedWidth, h: shown.renderedHeight });
  }

  // --- 縦横比(v0.8.0 では横に引き伸ばされていた) ---
  // 幅だけ px 指定して height:auto に任せると、CSS の max-height は高さだけを
  // 切り詰める(縦横比を保つ CSS の規則は width/height が両方 auto のときだけ効く)。
  // 実機では丸囲みの ⓐⓑⓒ が楕円になり、罫線が太い帯になって読めなくなっていた。
  check(`${label}: 横長プレビューが縦横比を保つ`, ratioOk(s.initial.field1),
    { intrinsic: s.initial.field1?.intrinsicRatio, rendered: s.initial.field1?.renderedRatio });
  // 設問オは2ページ目(用紙 800x1120・解像度1.25倍)の rim[620,300,100,260]、余白 36。
  // 172x332 → 画像ピクセルで 215x415(縦横比 0.518)
  check(`${label}: 縦長の切り出しもページごとの座標系で換算される`,
    s.tallField.crop?.intrinsicWidth === 215 && s.tallField.crop?.intrinsicHeight === 415,
    s.tallField.crop);
  check(`${label}: 縦長の解答欄では高さの上限に当たる(上限が効く経路を必ず通す)`,
    heightCapped(s.tallField.field) &&
    s.tallField.field.renderedWidth < s.tallField.field.slotWidth - 5,
    s.tallField.field);
  check(`${label}: 縦長プレビューが縦横比を保つ(max-heightで潰れない)`,
    ratioOk(s.tallField.field), s.tallField.field);
  check(`${label}: 縦長プレビューでも文字が解答欄の中央に置かれる`,
    s.tallField.field?.centerX != null &&
    Math.abs(s.tallField.field.centerX - s.tallField.field.renderedWidth / 2) < 1.5 &&
    Math.abs(s.tallField.field.centerY - s.tallField.field.renderedHeight / 2) < 1.5,
    s.tallField.field);
  check(`${label}: 縦長の切り出しが実際の解答欄と一致する`,
    s.tallField.centerPixel === "#ffefc2", s.tallField.centerPixel);

  // --- プレビュー描画 ---
  check(`${label}: 幅変更でスケールが再計算される`, s.resize.rescaledCorrectly === true,
    { png: [s.resize.pngWidthBefore, s.resize.pngWidthAfterShrink, s.resize.pngWidthAfterRestore] });
  check(`${label}: ResizeObserverが無限ループしない`,
    s.resize.mutationCallbacksAt400ms === s.resize.mutationCallbacksAt1300ms,
    `${s.resize.mutationCallbacksAt400ms} -> ${s.resize.mutationCallbacksAt1300ms}`);
  check(`${label}: 入力したテキストのプレビューが出る`,
    s.typed.field.display === "block" && parseFloat(s.typed.field.width) > 0, s.typed.field);
  check(`${label}: 入力すると進捗とストリップが更新される`,
    s.typed.progress === "入力済み 3/4" && s.typed.filledDots === 3,
    { progress: s.typed.progress, dots: s.typed.filledDots });
  check(`${label}: 文字数と収まり判定が出る`, /字/.test(s.typed.fit), s.typed.fit);
  check(`${label}: Ctrl+↵ で次の設問に移る`,
    s.shortcut.after !== s.shortcut.before && s.shortcut.after.length > 0, s.shortcut);

  // --- 「次の未入力へ」を辿りきると先頭へ巻き戻り、告知する ---
  check(`${label}: 未入力を辿りきると巻き戻ってトーストで告知する`,
    s.nextEmptyWrap.editorName.includes("イ") &&
    s.nextEmptyWrap.toastVisible === true &&
    (s.nextEmptyWrap.toastText || "").includes("戻"),
    s.nextEmptyWrap);

  // --- 保存 ---
  check(`${label}: 下書き保存が再取得照合まで通る`,
    s.save.postCount === 1 && s.save.status.includes("反映を確認"), s.save.status);
  check(`${label}: 保存成功でこの端末の下書きバックアップが消える`,
    Array.isArray(s.backupAfterSave.keys) && s.backupAfterSave.keys.length === 0,
    s.backupAfterSave);
  check(`${label}: 編集を再開すると「保存済み」が「未保存」に変わる`,
    s.statusClearOnEdit.before.includes("反映を確認") && s.statusClearOnEdit.after.includes("未保存"),
    s.statusClearOnEdit);
  check(`${label}: 未保存の間はタブを閉じる操作で確認が出る`,
    s.unloadDirty === true, s.unloadDirty);
  check(`${label}: 全設問が入ると保存バーに提出の案内が出る`,
    s.allFilled.progress === "入力済み 4/4" && s.allFilled.saveNote.includes("全設問の入力が済みました"),
    s.allFilled);
  check(`${label}: Alt+↵ で未入力が無いと告知する`,
    (s.altEnter.toastText || "").includes("未入力の設問はありません"), s.altEnter);
  check(`${label}: 最後の設問で進もうとすると告知する`,
    s.edgeEnd.editorAtLast.includes("オ") && (s.edgeEnd.toastText || "").includes("最後の設問"),
    s.edgeEnd);
  check(`${label}: 設問チップは左右キーで隣へフォーカスが移る(開かない)`,
    s.stripArrow.focusedIsSecond === true && s.stripArrow.editorUnchanged === true, s.stripArrow);
  check(`${label}: 通信で保存に失敗したら、入力がこの端末に残っていると伝える`,
    s.saveNetworkFail.status.includes("保存に失敗") &&
    s.saveNetworkFail.notice.includes("通信") && s.saveNetworkFail.notice.includes("残っています"),
    s.saveNetworkFail);
  check(`${label}: 照合できなかったら「反映を確認できませんでした」と出し、確認済みとは言わない`,
    s.verifyFail.status.includes("反映を確認できませんでした") && !s.verifyFail.status.includes("保存済み"),
    s.verifyFail);
  check(`${label}: 通常の保存で回復すると「保存済み」に戻り、離脱の確認も出なくなる`,
    s.saveRecovered.status.includes("保存済み") && s.saveRecovered.unloadStillPrevented === false,
    s.saveRecovered);
  check(`${label}: 送信中に編集しても、送った内容で照合し、追記ぶんだけ未保存で残る`,
    s.inFlightEdit.status.includes("未保存") && !s.inFlightEdit.status.includes("確認できませんでした") &&
    !s.inFlightEdit.status.includes("一部の設問") && s.inFlightEdit.notice === "",
    s.inFlightEdit);
  check(`${label}: 開いただけ・今の向きを押し直しただけでは未保存にならない`,
    s.openState.status === "" && s.openState.unloadPrevented === false &&
    s.samePressState.status === "" && s.samePressState.unloadPrevented === false,
    { open: s.openState, same: s.samePressState });
  check(`${label}: 初回ヒントは出て、閉じると以後は保存されて出ない`,
    s.hint.shownAtStart === true && s.hint.hiddenAfterDismiss === true && s.hint.stored === true,
    s.hint);
  check(`${label}: 背景ページのスクロールがロックされる`,
    s.scrollLock.html === "hidden" && s.scrollLock.body === "hidden", s.scrollLock);

  // --- Esc で閉じる(1回目はフォーカス解除だけ、2回目で閉じる) ---
  check(`${label}: Esc の1回目は入力欄からフォーカスを外すだけ`,
    s.escClose.activeIsTextareaBefore === true && s.escClose.activeIsTextareaAfterFirst === false &&
    s.escClose.hostVisibleAfterFirst === true,
    s.escClose);
  check(`${label}: 未保存のまま Esc すると確認が出て、やめれば閉じない`,
    s.escClose.confirmCountDeclined === 1 && s.escClose.hostVisibleAfterDeclined === true &&
    s.escClose.confirmMessage.includes("保存されていない"),
    s.escClose);
  check(`${label}: 未保存のとき「閉じる」「← 科目一覧」も確認を通し、やめれば留まる`,
    s.leaveButtons.close.confirmCount === 1 && s.leaveButtons.close.hostVisible === true &&
    s.leaveButtons.backConfirmCount === 1 && s.leaveButtons.stillOnForm === true,
    s.leaveButtons);
  check(`${label}: 確認でOKすると閉じる`,
    s.escClose.hostVisibleAfterConfirmed === false, s.escClose);
}

// ---------------------------------------------------------------- 読むモード(縦長の窓)
// 縦長の解答欄(問5・右側に縦書きの問題文がある想定)で、窓が画面の内側に収まり、
// 解答欄を含み、解答欄の右側(左より)広く取られていることを確かめる
async function assertReaderWindowVertical(send, label, viewportWidth) {
  const r = await evalJs(send, `(async () => {
    const host = document.getElementById("easysmarky-host");
    const root = host.shadowRoot;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const pane = root.querySelector(".es-pane-question");
    const answerTab = [...pane.querySelectorAll(".es-viewer-tabs button")].find((b) => b.textContent === "解答用紙");
    answerTab?.click();
    await wait(50);
    // 枠は表示中のページにしか出ない。問5は2ページ目にあるので、そこへ送る
    if (!pane.querySelector('.es-rim[data-field-id="5"]')) {
      pane.querySelector('button[aria-label="次のページ"]')?.click();
      await wait(100);
    }
    pane.querySelector('.es-rim[data-field-id="5"]')?.click();
    await wait(200);
    const rimEl = pane.querySelector('.es-rim[data-field-id="5"]');
    root.querySelector('button[aria-label="ページを全画面で読む"]').click();
    await wait(100);
    const reader = root.querySelector(".es-reader");
    const img = reader?.querySelector(".es-viewer-img");
    if (img && !(img.complete && img.naturalWidth > 0)) {
      await new Promise((res) => img.addEventListener("load", res, { once: true }));
    }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const canvas = reader?.querySelector(".es-viewer-canvas");
    const sc = reader?.querySelector(".es-viewer-scroll");
    const mc = pane.querySelector(".es-viewer-canvas");
    if (!rimEl || !canvas || !sc || !img || !mc) return null;
    const ar = rimEl.getBoundingClientRect();
    const m = mc.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    const s = sc.getBoundingClientRect();
    // 解答欄の端を、画像上の位置に換算する(窓の外でも値は出る。窓に入っているかはここで判定する)
    const xL = ir.left + ((ar.left - m.left) / m.width) * ir.width;
    const xR = ir.left + ((ar.right - m.left) / m.width) * ir.width;
    const yT = ir.top + ((ar.top - m.top) / m.height) * ir.height;
    const yB = ir.top + ((ar.bottom - m.top) / m.height) * ir.height;
    const out = {
      cropped: canvas.classList.contains("is-cropped"),
      fitsViewport: c.width <= s.width + 1 && c.height <= s.height + 1,
      rimInWindow: xL >= c.left - 1 && xR <= c.right + 1 && yT >= c.top - 1 && yB <= c.bottom + 1,
      roomLeft: xL - c.left,
      roomRight: c.right - xR,
      canvas: [Math.round(c.width), Math.round(c.height)],
      scroll: [Math.round(s.width), Math.round(s.height)],
    };
    // 確認用に残す(窓の見え方を目で見る)
    return out;
  })()`);
  check(`${label}: 縦長の解答欄でも窓が画面に収まり、解答欄を含む`,
    r?.cropped === true && r.fitsViewport === true && r.rimInWindow === true, r);
  check(`${label}: 窓は解答欄の右側に広く、左は狭く取られる(縦書きの問題文が右にある想定)`,
    r != null && r.roomRight > r.roomLeft, r);
  // 窓の中でも ＋ で拡大できる(縦長だと高さの上限に当たって大きさが変わらない、というのを防ぐ)
  const zoomed = await evalJs(send, `(async () => {
    const root = document.getElementById("easysmarky-host").shadowRoot;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const before = root.querySelector(".es-reader .es-viewer-canvas")?.getBoundingClientRect().width ?? null;
    root.querySelector('.es-reader button[aria-label="拡大"]')?.click();
    await wait(80);
    const after = root.querySelector(".es-reader .es-viewer-canvas")?.getBoundingClientRect().width ?? null;
    return { before, after };
  })()`);
  check(`${label}: 窓の中の ＋ で大きさが段階どおり大きくなる(1 → 1.5 倍)`,
    zoomed?.before > 0 && zoomed.after > zoomed.before * 1.4 && zoomed.after < zoomed.before * 1.6, zoomed);
  await screenshot(send, `reader-window-vertical-${viewportWidth}.png`);
  await evalJs(send, `document.getElementById("easysmarky-host").shadowRoot.querySelector(".es-reader-head button:not(.es-reader-toggle)").click()`);
}

// ---------------------------------------------------------------- 読むモード
// 解答用紙を枠なしで全画面に開く。上のビューアとは独立し、閉じても元の表示を壊さない。
// 幅に応じた初期倍率(約1100px幅になる最小の段階)で始まることも確かめる
async function assertReader(send, label, viewportWidth) {
  const r = await evalJs(send, `(async () => {
    const host = document.getElementById("easysmarky-host");
    const root = host.shadowRoot;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const pane = root.querySelector(".es-pane-question");
    const snapshot = (scope) => ({
      zoom: scope.querySelector(".es-viewer-canvas")?.style.width ?? null,
      count: scope.querySelector(".es-viewer-count")?.textContent ?? null,
      tab: scope.querySelector(".es-viewer-tabs button.active")?.textContent ?? null,
    });
    const answerTab = [...pane.querySelectorAll(".es-viewer-tabs button")].find((b) => b.textContent === "解答用紙");
    answerTab?.click();
    await wait(50);
    // 設問を1つ選んでおく(読み始めの位置は、選んでいる設問の枠に合わせる)
    pane.querySelector(".es-rim:not(:disabled)")?.click();
    await wait(50);
    const mainBefore = snapshot(pane);

    const readBtn = root.querySelector('button[aria-label="ページを全画面で読む"]');
    readBtn.focus();
    readBtn.click();
    await wait(50);
    const reader = root.querySelector(".es-reader");
    const out = {
      opened: !!reader,
      rimCount: reader ? reader.querySelectorAll(".es-rim").length : null,
      reader: reader ? snapshot(reader) : null,
      mainBefore,
      focusOnOpen: !!root.activeElement?.closest(".es-reader"),
    };
    // 読むモード中の編集系キー(Ctrl+↵)が裏の入力欄へ移らないこと
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await wait(50);
    out.focusAfterCtrlEnter = !!root.activeElement?.closest(".es-reader");

    // 画像の読み込みを待ってから、選んでいる枠の中心が読むモードの見える範囲に入るかを見る
    const readerImg = reader ? reader.querySelector(".es-viewer-img") : null;
    if (readerImg && !(readerImg.complete && readerImg.naturalWidth > 0)) {
      await new Promise((res) => readerImg.addEventListener("load", res, { once: true }));
    }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const activeRim = pane.querySelector(".es-rim.active");
    const mainCanvas = pane.querySelector(".es-viewer-canvas");
    const readerCanvas = reader ? reader.querySelector(".es-viewer-canvas") : null;
    const readerScroll = reader ? reader.querySelector(".es-viewer-scroll") : null;
    const readerImgEl = reader ? reader.querySelector(".es-viewer-img") : null;
    out.hadActive = !!activeRim;
    out.focusVisible = null;
    out.windowPressedOpen = reader?.querySelector(".es-reader-toggle")?.getAttribute("aria-pressed") === "true";
    out.windowCropped = readerCanvas?.classList.contains("is-cropped") ?? null;
    out.rimInWindow = null;
    // 窓は縦横比が横長なので幅いっぱいで収まる(倍率1)。描画された幅で確かめる(style の文字列には依存しない)
    out.windowFillsWidth = readerCanvas && readerScroll
      ? Math.abs(readerCanvas.getBoundingClientRect().width - readerScroll.getBoundingClientRect().width) < 2
      : null;
    if (activeRim && mainCanvas && readerCanvas && readerScroll && readerImgEl) {
      const ar = activeRim.getBoundingClientRect();
      const mc = mainCanvas.getBoundingClientRect();
      // 枠の中心を、用紙画像に対する割合で表す(主ビューアと読むモードで同じ用紙なので共通)
      const fx = (ar.left + ar.width / 2 - mc.left) / mc.width;
      const fy = (ar.top - mc.top) / mc.height;
      // 窓表示では canvas は切り出した範囲しか映らないので、位置は画像そのものの矩形で換算する
      const ir = readerImgEl.getBoundingClientRect();
      const px = ir.left + fx * ir.width;
      const py = ir.top + fy * ir.height;
      const rc = readerCanvas.getBoundingClientRect();
      const sc = readerScroll.getBoundingClientRect();
      out.focusVisible = px >= sc.left && px <= sc.right && py >= sc.top && py <= sc.bottom;
      // 窓表示なら、選んでいる設問の枠が窓(canvas)の中に入っていること
      out.rimInWindow = px >= rc.left && px <= rc.right && py >= rc.top && py <= rc.bottom;
    }

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await wait(50);
    out.closedByEsc = !root.querySelector(".es-reader");
    out.focusRestoredAfterEsc = root.activeElement === readBtn;
    out.hostVisibleAfterEsc = host.style.display !== "none";
    out.mainAfterEsc = snapshot(pane);

    // 選んでいる枠が、読むモードの画像上で見える範囲に入っているか(窓表示でも全体表示でも同じ換算で測る)
    const probeVisible = () => {
      const rimNow = pane.querySelector(".es-rim.active");
      const im = root.querySelector(".es-reader .es-viewer-img");
      const scr = root.querySelector(".es-reader .es-viewer-scroll");
      const mcv = pane.querySelector(".es-viewer-canvas");
      if (!rimNow || !im || !scr || !mcv) return null;
      const ar2 = rimNow.getBoundingClientRect();
      const mc2 = mcv.getBoundingClientRect();
      const fx2 = (ar2.left + ar2.width / 2 - mc2.left) / mc2.width;
      const fy2 = (ar2.top - mc2.top) / mc2.height;
      const ir2 = im.getBoundingClientRect();
      const s2 = scr.getBoundingClientRect();
      const px2 = ir2.left + fx2 * ir2.width;
      const py2 = ir2.top + fy2 * ir2.height;
      return px2 >= s2.left && px2 <= s2.right && py2 >= s2.top && py2 <= s2.bottom;
    };
    // 開き直して「設問まわり」を切ると、開いた時点の全体表示(倍率・位置)に戻り、閉じるボタンで閉じられる
    root.querySelector('button[aria-label="ページを全画面で読む"]').click();
    await wait(50);
    const tog = root.querySelector(".es-reader .es-reader-toggle");
    out.windowPressedOnReopen = tog?.getAttribute("aria-pressed") === "true";
    tog?.click();
    await wait(150);
    out.windowOffCropped = root.querySelector(".es-reader .es-viewer-canvas")?.classList.contains("is-cropped") ?? null;
    out.windowOffPressed = root.querySelector(".es-reader .es-reader-toggle")?.getAttribute("aria-pressed") ?? null;
    out.offZoom = root.querySelector(".es-reader .es-viewer-canvas")?.style.width ?? null;
    out.offFocusVisible = probeVisible();
    root.querySelector(".es-reader-head button:not(.es-reader-toggle)").click();
    await wait(50);
    out.closedByButton = !root.querySelector(".es-reader");
    return out;
  })()`);

  check(`${label}: 読むモードは選んでいる設問のまわりの窓で始まる`,
    r.windowPressedOpen === true && r.windowCropped === true && r.rimInWindow === true,
    { pressed: r.windowPressedOpen, cropped: r.windowCropped, rimInWindow: r.rimInWindow });
  check(`${label}: 「設問まわり」を切ると全体に戻り、開いた時点の倍率・位置になる`,
    r.windowPressedOnReopen === true && r.windowOffCropped === false && r.windowOffPressed === "false"
      && r.offZoom === `${([1, 1.5, 2, 3, 4].find((s) => viewportWidth * s >= 1100) ?? 4) * 100}%`
      && r.offFocusVisible === true,
    { reopenPressed: r.windowPressedOnReopen, offCropped: r.windowOffCropped, offPressed: r.windowOffPressed, offZoom: r.offZoom, offFocusVisible: r.offFocusVisible });
  check(`${label}: 読むボタンで全画面の読むモードが開く`, r.opened === true, r);
  check(`${label}: 読むモードには解答欄の枠を出さない`, r.rimCount === 0, r.rimCount);
  check(`${label}: 読むモードは今の種別・ページから始まる`,
    r.reader?.tab === "解答用紙" && r.reader?.count === r.mainBefore.count, { reader: r.reader, main: r.mainBefore });
  check(`${label}: 窓は画面幅いっぱいの倍率(100%)で始まる`,
    r.windowFillsWidth === true, { windowFillsWidth: r.windowFillsWidth });
  // 縦書きは右端から読むので、左上から始まると本文を探すのに何画面も送ることになる。
  // 選んでいる設問の枠が、読み始めの見える範囲に入っていることを確かめる
  check(`${label}: 読み始めは選んでいる設問の解答欄が見える範囲に入る`,
    r.hadActive === true && r.focusVisible === true, { hadActive: r.hadActive, focusVisible: r.focusVisible });
  check(`${label}: 読むモードを開くと閉じるボタンに移り、閉じると読む前のボタンに戻る`,
    r.focusOnOpen === true && r.focusRestoredAfterEsc === true, { focusOnOpen: r.focusOnOpen, restored: r.focusRestoredAfterEsc });
  check(`${label}: 読むモード中は Ctrl+↵ で裏の入力欄へ移らない`,
    r.focusAfterCtrlEnter === true, r.focusAfterCtrlEnter);
  check(`${label}: 読むモードの Esc は読むモードだけを閉じる`,
    r.closedByEsc === true && r.hostVisibleAfterEsc === true, r);
  check(`${label}: 読むモードを閉じても上のビューアのズームとページは変わらない`,
    JSON.stringify(r.mainAfterEsc) === JSON.stringify(r.mainBefore), { before: r.mainBefore, after: r.mainAfterEsc });
  check(`${label}: 「閉じる」ボタンでも読むモードが閉じる`, r.closedByButton === true, r.closedByButton);

  // 目視確認用: 読むモードを開いた状態を1枚残す(文字が読める大きさかを見る)
  await evalJs(send, `document.getElementById("easysmarky-host").shadowRoot.querySelector('button[aria-label="ページを全画面で読む"]').click()`);
  await sleep(500);
  await screenshot(send, `reader-${viewportWidth}.png`);
  await evalJs(send, `document.getElementById("easysmarky-host").shadowRoot.querySelector(".es-reader-head button:not(.es-reader-toggle)").click()`);
}

// ---------------------------------------------------------------- 実行
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const { server, port: httpPort } = await startServer();
const URL_HARNESS = `http://127.0.0.1:${httpPort}/tools/verify/harness.html`;
const { child, wsUrl } = await launchChrome(9333 + (process.pid % 500));
const { send } = connect(wsUrl);

try {
  await send("Page.enable");
  await send("Runtime.enable");

  for (const [label, w, h] of [["スマホ(430px)", 430, 900], ["PC(1400px)", 1400, 900]]) {
    await setViewport(send, w, h);
    await openHarness(send, URL_HARNESS);
    assertAll(label, await evalJs(send, "window.__esAssert()"), w);
    await openHarness(send, URL_HARNESS);
    await evalJs(send, `window.__esView("view")`);
    await assertReader(send, label, w);
    await assertReaderWindowVertical(send, label, w);
  }

  // 目視確認用のスクリーンショット
  await setViewport(send, 1400, 900);
  await openHarness(send, URL_HARNESS);
  await evalJs(send, `window.__esView("list")`);
  await screenshot(send, "desktop-list.png");
  await evalJs(send, `window.__esView("view")`);
  await screenshot(send, "desktop.png");

  // 常時上下分割なので、問題ビューアと入力欄は同じ画面に常に同居する。
  // rimタップ後(入力欄にフォーカスした状態)の1枚だけで両ペインの共存を確認できる
  await setViewport(send, 430, 900);
  await openHarness(send, URL_HARNESS);
  await evalJs(send, `window.__esView("edit")`);
  await screenshot(send, "mobile.png");

  // 縦長の解答欄。他の設問は幅で先に頭打ちになるので、canvas の max-height が
  // 当たる見た目を確認できるのはこの1枚だけ(高さの上限で幅も一緒に縮み、
  // プレビューが枠ごと中央に寄っていれば縦横比は保たれている)
  await openHarness(send, URL_HARNESS);
  await evalJs(send, `window.__esView("tall")`);
  await screenshot(send, "mobile-tall.png");
} catch (e) {
  check("実行が最後まで完了する", false, String(e && e.stack || e));
} finally {
  // 終了を待たずにプロファイルを消すと、Chromium の書き込みと競合して ENOTEMPTY になる
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGKILL");
  await Promise.race([exited, sleep(5000)]);
  server.close();
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {
    /* 消せなくても out/ は gitignore 済みなので無視する */
  });
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.ok) console.log("      " + JSON.stringify(c.detail));
}
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
console.log(`screenshots: ${OUT_DIR}`);
process.exit(failed.length ? 1 : 0);
