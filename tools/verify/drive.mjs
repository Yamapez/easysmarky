// easysmarky のUI回帰チェック。`npm run verify` で実行する。
//
// dist/easysmarky.iife.js(実際の配布物)を、SmarkyのAPIをスタブしたページに読み込ませ、
// ヘッドレスChromiumで操作して挙動を検証する。playwright/puppeteer は使わず、
// Node のグローバル WebSocket で CDP を直接叩く(依存を増やさないため)。
//
// 重要: --virtual-time-budget は使わないこと。仮想時間ではレンダリング更新が
// 実時間どおりに走らず ResizeObserver が配信されないため、
// 「タブ切替でプレビューが描画されない」という偽の不具合が出る。
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

function assertAll(label, r) {
  const s = r.steps;

  // --- 1設問集中レイアウトの骨格 ---
  check(`${label}: 設問ストリップに全設問が並ぶ`, s.initial.stripChips === 3, s.initial.stripChips);
  check(`${label}: 最初の設問が開いている`, s.initial.editorName.includes("問1"), s.initial.editorName);
  check(`${label}: 進捗が入力済み数を表す`, s.initial.progress === "入力済み 1/3", s.initial.progress);

  // --- 解答欄オーバーレイ(rim座標は解答用紙のものなので問題ページには出さない) ---
  check(`${label}: 問題ページには解答欄の枠を出さない`, s.initial.rimCount === 0, s.initial.rimCount);
  // rim の座標系は base_sheet.correct_image_size。実機に base_sheet.width/height は
  // 無いので、そこから取ろうとすると枠が1つも出なくなる(実機で実際に起きていた)。
  check(`${label}: 解答用紙にそのページの設問ぶんの枠と凡例が出る`,
    s.answerSheet.rimCount === 2 && s.answerSheet.legendDisplay === "flex",
    { rims: s.answerSheet.rimCount, legend: s.answerSheet.legendDisplay });
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
  if (s.initial.twoPaneMediaQuery) {
    check(`${label}: 2カラムで問題と入力の両ペインが出る`,
      s.initial.questionPaneDisplay !== "none" && s.initial.formPaneDisplay !== "none",
      `${s.initial.questionPaneDisplay}/${s.initial.formPaneDisplay}`);
    check(`${label}: 初期表示で既存下書きのプレビューが描画される`,
      s.initial.field1.display === "block" && parseFloat(s.initial.field1.width) > 0, s.initial.field1);
    check(`${label}: 解答欄プレビューの横に問題プレビューが出る`,
      s.initial.questionPreviewDisplay !== "none" && s.initial.questionPreviewCanvasWidth > 0,
      { display: s.initial.questionPreviewDisplay, width: s.initial.questionPreviewCanvasWidth });
  } else {
    check(`${label}: 問題プレビューは狭い画面では出さない`,
      s.initial.questionPreviewDisplay === "none", s.initial.questionPreviewDisplay);
    check(`${label}: 問題ページから始まり入力ペインは畳まれている`,
      s.initial.dataMode === "view" && s.initial.formPaneDisplay === "none",
      `${s.initial.dataMode}/${s.initial.formPaneDisplay}`);
    check(`${label}: 解答欄をタップすると入力モードに入る`,
      s.afterRimTap.dataMode === "edit", s.afterRimTap.dataMode);
    // 最重要: 入力ペインが display:none で始まるため、既存下書きのプレビューを描くのは
    // 編集モードに入って ResizeObserver が発火する経路だけになる。
    // ここが落ちると、下書きを再開したスマホユーザーはプレビューが永久に空になる。
    check(`${label}: 入力モードでプレビューが描画される(ResizeObserver経由)`,
      s.afterRimTap.field1.display === "block" && parseFloat(s.afterRimTap.field1.width) > 0,
      s.afterRimTap);
  }

  // --- 設問の移動 ---
  check(`${label}: ストリップで設問を移動できる`,
    s.stripNav.activeChipIndex === 2 && s.stripNav.editorName.includes("ウ"), s.stripNav);
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
    s.stripNav.pagerLabel === "2 / 2" && s.stripNav.rimCount === 1,
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
  {
    const shown = s.initial.twoPaneMediaQuery ? s.initial.field1 : s.afterRimTap.field1;
    check(`${label}: プレビューが使える幅いっぱいに拡縮される`,
      !!shown && shown.slotWidth > 0 && Math.abs(shown.renderedWidth - shown.slotWidth) <= 2 &&
      shown.renderedWidth !== shown.intrinsicWidth,
      shown && { rendered: shown.renderedWidth, slot: shown.slotWidth, intrinsic: shown.intrinsicWidth });
  }
  // 文字は解答欄の中央に置かれる。フォント実測値に依存しないので環境差で揺れない
  {
    const shown = s.initial.twoPaneMediaQuery ? s.initial.field1 : s.afterRimTap.field1;
    check(`${label}: プレビューの文字が解答欄の中央に置かれる`,
      !!shown && shown.centerX != null &&
      Math.abs(shown.centerX - shown.renderedWidth / 2) < 1.5 &&
      Math.abs(shown.centerY - shown.renderedHeight / 2) < 1.5,
      shown && { centerX: shown.centerX, centerY: shown.centerY,
                 w: shown.renderedWidth, h: shown.renderedHeight });
  }

  // --- プレビュー描画 ---
  check(`${label}: 幅変更でスケールが再計算される`, s.resize.rescaledCorrectly === true,
    { png: [s.resize.pngWidthBefore, s.resize.pngWidthAfterShrink, s.resize.pngWidthAfterRestore] });
  check(`${label}: ResizeObserverが無限ループしない`,
    s.resize.mutationCallbacksAt400ms === s.resize.mutationCallbacksAt1300ms,
    `${s.resize.mutationCallbacksAt400ms} -> ${s.resize.mutationCallbacksAt1300ms}`);
  check(`${label}: 入力したテキストのプレビューが出る`,
    s.typed.field.display === "block" && parseFloat(s.typed.field.width) > 0, s.typed.field);
  check(`${label}: 入力すると進捗とストリップが更新される`,
    s.typed.progress === "入力済み 2/3" && s.typed.filledDots === 2,
    { progress: s.typed.progress, dots: s.typed.filledDots });
  check(`${label}: 文字数と収まり判定が出る`, /字/.test(s.typed.fit), s.typed.fit);
  check(`${label}: Ctrl+↵ で次の設問に移る`,
    s.shortcut.after !== s.shortcut.before && s.shortcut.after.length > 0, s.shortcut);

  // --- 保存 ---
  check(`${label}: 下書き保存が再取得照合まで通る`,
    s.save.postCount === 1 && s.save.status.includes("反映を確認"), s.save.status);
  check(`${label}: 背景ページのスクロールがロックされる`,
    s.scrollLock.html === "hidden" && s.scrollLock.body === "hidden", s.scrollLock);
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
    assertAll(label, await evalJs(send, "window.__esAssert()"));
  }

  // 目視確認用のスクリーンショット
  await setViewport(send, 1400, 900);
  await openHarness(send, URL_HARNESS);
  await evalJs(send, `window.__esView("list")`);
  await screenshot(send, "desktop-list.png");
  await evalJs(send, `window.__esView("view")`);
  await screenshot(send, "desktop.png");

  await setViewport(send, 430, 900);
  await openHarness(send, URL_HARNESS);
  await evalJs(send, `window.__esView("view")`);
  await screenshot(send, "mobile-view.png");
  await evalJs(send, `window.__esView("edit")`);
  await screenshot(send, "mobile-edit.png");
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
