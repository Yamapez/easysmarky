// 方向3(スマホの入力体験)の検査。
// 使い方: await open(`${URL_HARNESS}?scenario=d3`) で開き(open は about:blank を挟んで openHarness を呼ぶ)、evalJs で状態を読み、check(名前, 条件, 詳細) を呼ぶ。
// 設定(擬似 visualViewport・遅延・記憶した倍率)は URL で切り替える。仕様は tools/verify/harness-d3.js を参照。

const SH = `document.getElementById("easysmarky-host").shadowRoot`;
const sleepLocal = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一覧の先頭の回を開き、設問の解答欄プレビューが出るまで待つ(ブラウザ側で待機する) */
const OPEN_SHEET = `(async () => {
  const sh = ${SH};
  const wait = (fn, ms = 10000) => new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = fn();
      if (v) return res(v);
      if (Date.now() - t0 > ms) return rej(new Error("timeout"));
      setTimeout(tick, 50);
    })();
  });
  const item = await wait(() => sh.querySelector(".es-list-item"));
  item.click();
  await wait(() => sh.querySelector(".es-field-editor .es-preview-wrap"));
  // 解答用紙の枠で操作するため、解答用紙タブへ切り替える(問題ページが先に出る回があるため)
  const answerTab = [...sh.querySelectorAll(".es-viewer-tabs button")].find((b) => b.textContent === "解答用紙");
  if (answerTab) answerTab.click();
  await new Promise((r) => setTimeout(r, 600));
  return true;
})()`;

/** 解答用紙ビューアの現在の倍率(canvas の幅が % のとき) */
const ZOOM_NOW = `(() => {
  const c = ${SH}.querySelector(".es-viewer-canvas");
  return c ? parseFloat(c.style.width) / 100 : null;
})()`;

const ACTIVE_FIELD = `(() => {
  const r = ${SH}.querySelector(".es-rim.active");
  return r ? Number(r.dataset.fieldId) : null;
})()`;

/** 指定した設問の枠を、解答用紙ビューアの表示域の中に入れてから中心の座標を返す(タップ用) */
const rimCenterInView = (fieldId) => `(() => {
  const sh = ${SH};
  const rim = sh.querySelector('.es-rim[data-field-id="${fieldId}"]');
  if (!rim) return null;
  rim.scrollIntoView({ block: "center", inline: "center" });
  const r = rim.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

const ROOT_RECT = `(() => {
  const r = ${SH}.querySelector(".es-root").getBoundingClientRect();
  return { top: r.top, height: r.height };
})()`;

const ROOT_VARS = `(() => {
  const root = ${SH}.querySelector(".es-root");
  return {
    vvh: root.style.getPropertyValue("--es-vvh"),
    vvTop: root.style.getPropertyValue("--es-vv-top"),
    kbd: root.classList.contains("es-kbd"),
  };
})()`;

export async function run(ctx) {
  const { send, evalJs, setViewport, openHarness, check, URL_HARNESS, screenshot } = ctx;
  const d3 = (query = "") => `${URL_HARNESS}?scenario=d3${query}`;
  // 遷移の直前のページ(フォームが開いたまま等)の DOM を openHarness が拾わないよう、いったん白紙に戻してから開く
  const open = async (url) => {
    await send("Page.navigate", { url: "about:blank" });
    await sleepLocal(150);
    await openHarness(send, url);
  };
  const prefsZoom = `(() => {
    try { const p = JSON.parse(localStorage.getItem("easysmarky:prefs")); return p ? p.zoom : null; }
    catch (e) { return "error"; }
  })()`;

  // ---------------------------------------------------------------- 1. キーボード(擬似 visualViewport)
  await setViewport(send, 430, 900);
  await open(d3());
  await evalJs(send, OPEN_SHEET);

  const kb0 = await evalJs(send, ROOT_VARS);
  check("d3: 画面を開くと見える高さ(--es-vvh)が画面の高さになり、キーボードは出ていない",
    kb0.vvh === "900px" && kb0.kbd === false, kb0);

  // キーボードを出す: 見える高さを縮めて resize を流す。入力欄へフォーカスしたあと
  await evalJs(send, `(() => { window.__esFakeVV.height = 520; window.__esFakeVV.dispatchEvent(new Event("resize")); return true; })()`);
  await evalJs(send, `(async () => {
    const sh = ${SH};
    sh.querySelector('.es-rim[data-field-id="1"]').click();
    await new Promise((r) => setTimeout(r, 300));
    return true;
  })()`);
  await sleepLocal(200);
  const kb1 = await evalJs(send, ROOT_VARS);
  const rootRect = await evalJs(send, ROOT_RECT);
  const textareaBox = await evalJs(send, `(() => {
    const ta = ${SH}.querySelector("textarea.es-textarea");
    if (!ta) return null;
    const r = ta.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  })()`);
  check("d3: キーボード表示で見える高さに追従し、es-kbd が付く",
    kb1.vvh === "520px" && kb1.kbd === true && Math.abs(rootRect.height - 520) < 2, { kb1, rootRect });
  check("d3: キーボード表示中も入力欄が見える領域の中に残る",
    textareaBox != null && textareaBox.bottom <= 520 + 1 && textareaBox.top >= -1,
    { textareaBox, rootRect });

  // フォーカス後に、スクロールが .es-root や親要素へ飛んでいないこと(ページごと押し上げていない)
  const scrolls = await evalJs(send, `(() => {
    const sh = ${SH};
    const pick = (sel) => { const el = sh.querySelector(sel); return el ? el.scrollTop : null; };
    return { root: pick(".es-root"), content: pick(".es-content"), panel: pick(".es-panel") };
  })()`);
  check("d3: キーボード表示でも外側の要素(.es-root・.es-content)がずれない",
    scrolls.root === 0 && scrolls.content === 0 && scrolls.panel === 0, scrolls);

  // キーボードが閉じると元の高さに戻る
  await evalJs(send, `(() => { window.__esFakeVV.height = 900; window.__esFakeVV.dispatchEvent(new Event("resize")); return true; })()`);
  await sleepLocal(100);
  const kb2 = await evalJs(send, ROOT_VARS);
  check("d3: キーボードを閉じると高さと es-kbd が元に戻る",
    kb2.vvh === "900px" && kb2.kbd === false, kb2);

  // 案内の出し分け: スマホ幅では常時出し、PC 幅では出さない
  const touchHintMobile = await evalJs(send, `(() => {
    const el = ${SH}.querySelector(".es-touch-hints");
    return el ? { display: getComputedStyle(el).display, text: el.textContent } : null;
  })()`);
  check("d3: スマホ幅では操作案内(ピンチと「読む」)を常時出す",
    touchHintMobile && touchHintMobile.display !== "none" && touchHintMobile.text.includes("ピンチ") && touchHintMobile.text.includes("読む"),
    touchHintMobile);
  await setViewport(send, 1400, 900);
  await sleepLocal(300);
  const touchHintPc = await evalJs(send, `(() => {
    const el = ${SH}.querySelector(".es-touch-hints");
    return el ? getComputedStyle(el).display : null;
  })()`);
  check("d3: PC 幅では操作案内を出さない(既存のキー案内だけ)", touchHintPc === "none", touchHintPc);
  await setViewport(send, 430, 900);
  await sleepLocal(300);

  // ---------------------------------------------------------------- 2. ピンチズーム(実時間のタッチ)
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  // キーボードの節で入力欄にフォーカスが残っているので、ピンチの前に外して「ピンチで入力欄に入らないこと」を見る
  await evalJs(send, `(() => { ${SH}.activeElement?.blur(); return true; })()`);
  const zoom0 = await evalJs(send, ZOOM_NOW);
  const activeBefore = await evalJs(send, ACTIVE_FIELD);
  const scrollCenter = await evalJs(send, `(() => {
    const r = ${SH}.querySelector(".es-viewer-scroll").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  // 2本指の中心は画面の中央に固定し、指を縦に広げる(ピンチ)。ピンチ中は枠の参照を保持して、再生成されていないかを見る
  await evalJs(send, `(() => { window.__d3Rim = ${SH}.querySelector('.es-rim[data-field-id="2"]'); return !!window.__d3Rim; })()`);
  const cx = scrollCenter.x;
  const cy = scrollCenter.y;
  const touch = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [
    { x: cx, y: cy - 30, id: 0 },
    { x: cx, y: cy + 30, id: 1 },
  ]);
  const mid = [];
  for (let i = 1; i <= 10; i++) {
    const d = 60 + i * 14;
    await touch("touchMove", [
      { x: cx, y: cy - d / 2, id: 0 },
      { x: cx, y: cy + d / 2, id: 1 },
    ]);
    await sleepLocal(30);
    mid.push(await evalJs(send, `(() => ({
      zoom: ${ZOOM_NOW},
      rimStillThere: window.__d3Rim ? window.__d3Rim.isConnected : null,
    }))()`));
  }
  await touch("touchEnd", []);
  await sleepLocal(150);

  const zoomAfterPinch = await evalJs(send, ZOOM_NOW);
  const activeAfterPinch = await evalJs(send, ACTIVE_FIELD);
  const taFocused = await evalJs(send, `(() => ${SH}.activeElement?.tagName === "TEXTAREA")()`);
  check("d3: 2本指で広げるとズームが連続して大きくなる(最初は 100%)",
    zoom0 === 1 && zoomAfterPinch > 1.5 && mid.length > 0 && mid[mid.length - 1].zoom > mid[0].zoom,
    { zoom0, zoomAfterPinch, first: mid[0], last: mid[mid.length - 1] });
  check("d3: ピンチ中は枠を作り直さない(参照が生きたまま)",
    mid.every((m) => m.rimStillThere === true), mid.map((m) => m.rimStillThere));
  check("d3: ピンチで枠の選択が変わらず、入力欄にも入らない",
    activeAfterPinch === activeBefore && taFocused === false,
    { activeBefore, activeAfterPinch, taFocused });

  const saved = await evalJs(send, prefsZoom);
  check("d3: 手動で変えた倍率が次回の初期値として記憶される",
    typeof saved === "number" && Math.abs(saved - zoomAfterPinch) < 0.05, { saved, zoomAfterPinch });

  // 離してから少し待つと、1本指のタップは枠に届く(誤発火の抑止が解けている)
  await sleepLocal(450);
  const tapPoint = await evalJs(send, rimCenterInView(2));
  await touch("touchStart", [{ x: tapPoint.x, y: tapPoint.y, id: 0 }]);
  await touch("touchEnd", []);
  await sleepLocal(200);
  const activeAfterTap = await evalJs(send, ACTIVE_FIELD);
  check("d3: ピンチ後しばらくすると、1本指のタップで枠が選べる",
    activeAfterTap === 2, { activeAfterTap, tapPoint });

  // 2本指を動かさずに、枠の上(枠1)と枠の外に同時に置いて離す。ピンチではないが、枠の click を拾わないこと
  await evalJs(send, `(() => { ${SH}.activeElement?.blur(); return true; })()`);
  const onRim = await evalJs(send, rimCenterInView(1));
  const offRim = await evalJs(send, `(() => {
    const r = ${SH}.querySelector(".es-viewer-scroll").getBoundingClientRect();
    return { x: r.right - 14, y: r.bottom - 14 };
  })()`);
  await touch("touchStart", [
    { x: onRim.x, y: onRim.y, id: 0 },
    { x: offRim.x, y: offRim.y, id: 1 },
  ]);
  await sleepLocal(60);
  await touch("touchEnd", []);
  await sleepLocal(450);
  const activeAfterStill = await evalJs(send, ACTIVE_FIELD);
  const taAfterStill = await evalJs(send, `(() => ${SH}.activeElement?.tagName === "TEXTAREA")()`);
  check("d3: 2本指を動かさずに枠の上で離しても、枠は選ばれず入力欄にも入らない",
    activeAfterStill === 2 && taAfterStill === false, { activeAfterStill, taAfterStill, onRim, offRim });

  // ---------------------------------------------------------------- 3. ズームの記憶(次回の初期値・自動ズーム)
  // 一覧へ戻って開き直す(同じ画面内で記憶が読み直されること)。この時点の倍率は記憶した値になっているはず
  await evalJs(send, `(() => { ${SH}.querySelector(".es-header-back")?.click(); return true; })()`);
  await sleepLocal(400);
  await evalJs(send, OPEN_SHEET);
  const zoomReopened = await evalJs(send, ZOOM_NOW);
  check("d3: 開き直すと、記憶した倍率で表示される(自動ズームは広い解答欄では上書きしない)",
    typeof saved === "number" && Math.abs(zoomReopened - saved) < 0.05,
    { saved, zoomReopened });
  await setViewport(send, 430, 900);

  await send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });

  // 記憶の上で自動ズームが止まらないこと: 倍率 1.5 を記憶して開き、小さい解答欄(オ)を選ぶと 1.5 を超えて拡大する
  await open(d3("&zoom=1.5"));
  await evalJs(send, OPEN_SHEET);
  const zoomMemWide = await evalJs(send, ZOOM_NOW);
  check("d3: 記憶した 150% で開く(先頭は横長の解答欄なので自動ズームは 150% のまま)",
    Math.abs(zoomMemWide - 1.5) < 0.01, zoomMemWide);
  await evalJs(send, `(() => { ${SH}.querySelector('.es-strip-chip[data-field-id="5"]')?.click(); return true; })()`);
  await sleepLocal(700);
  const zoomMemNarrow = await evalJs(send, ZOOM_NOW);
  check("d3: 記憶があっても、小さい解答欄を選ぶと自動で 150% より大きくなる(自動ズームが止まっていない)",
    zoomMemNarrow > 1.5 + 0.05, zoomMemNarrow);
  await evalJs(send, `(() => { ${SH}.querySelector('.es-strip-chip[data-field-id="3"]')?.click(); return true; })()`);
  await sleepLocal(700);
  const zoomMemWide2 = await evalJs(send, ZOOM_NOW);
  check("d3: 横長の解答欄へ移ると、記憶した 150% に戻る",
    Math.abs(zoomMemWide2 - 1.5) < 0.01, zoomMemWide2);

  // 「全体」は記憶を消す(次回から従来どおり 100% で始まる)
  await evalJs(send, `(() => { [...${SH}.querySelectorAll(".es-viewer-zoom button")].find((b) => b.textContent === "全体").click(); return true; })()`);
  await sleepLocal(200);
  const zoomFit = await evalJs(send, ZOOM_NOW);
  const savedAfterFit = await evalJs(send, prefsZoom);
  check("d3: 「全体」で倍率が 100% に戻り、記憶も消える",
    zoomFit === 1 && savedAfterFit === null, { zoomFit, savedAfterFit });
  // 「全体」の直後だけでなく、同じ画面で設問を移ったあとも下限が残っていないこと(横長の設問は自動では 100%)
  await evalJs(send, `(() => { ${SH}.querySelector('.es-strip-chip[data-field-id="3"]')?.click(); return true; })()`);
  await sleepLocal(700);
  const zoomAfterFitNav = await evalJs(send, ZOOM_NOW);
  check("d3: 「全体」のあとは、設問を移っても記憶の下限が残らず 100% のまま",
    zoomAfterFitNav === 1, zoomAfterFitNav);

  // ---------------------------------------------------------------- 4. 読み込み表示(スピナーと reduced-motion)
  await open(d3("&delay=900"));
  // 一覧の応答を待ったあと、報告の取得を遅らせた状態で設問を開く
  await evalJs(send, `(async () => {
    const sh = ${SH};
    const t0 = Date.now();
    while (!sh.querySelector(".es-list-item")) {
      if (Date.now() - t0 > 10000) throw new Error("list timeout");
      await new Promise((r) => setTimeout(r, 50));
    }
    sh.querySelector(".es-list-item").click();
    return true;
  })()`);
  await sleepLocal(120);
  const spinner = await evalJs(send, `(() => {
    const el = ${SH}.querySelector('.es-loading[role="status"]');
    if (!el) return null;
    const style = getComputedStyle(el, "::before");
    return { text: el.textContent.trim(), animationName: style.animationName, animationPlayState: style.animationPlayState };
  })()`);
  check("d3: 読み込み中は回転するスピナーが出て、文字も残る",
    spinner && spinner.animationName === "es-spin" && spinner.text.includes("読み込み中"), spinner);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const spinnerReduced = await evalJs(send, `(() => {
    const el = ${SH}.querySelector('.es-loading[role="status"]');
    if (!el) return "gone";
    return getComputedStyle(el, "::before").animationName;
  })()`);
  check("d3: 動きを減らす設定では、スピナーの回転が止まる",
    spinnerReduced === "none", spinnerReduced);
  await send("Emulation.setEmulatedMedia", { features: [] });

  // 報告が届いたら、通常どおりの編集画面になる(スピナーは残らない)
  await evalJs(send, `(async () => {
    const sh = ${SH};
    const t0 = Date.now();
    while (!sh.querySelector(".es-field-editor .es-preview-wrap")) {
      if (Date.now() - t0 > 10000) throw new Error("editor timeout");
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  })()`);
  const spinnerGone = await evalJs(send, `!${SH}.querySelector('.es-loading[role="status"]')`);
  check("d3: 読み込みが終わるとスピナーの表示は消える", spinnerGone === true, spinnerGone);

  // ---------------------------------------------------------------- 5. 実機の visualViewport(擬似なし)
  await open(d3("&real=1"));
  await evalJs(send, OPEN_SHEET);
  const real = await evalJs(send, `(() => {
    const vv = window.visualViewport;
    const root = ${SH}.querySelector(".es-root");
    return {
      hasVV: !!vv,
      vvHeight: vv ? vv.height : null,
      innerHeight: window.innerHeight,
      vvh: root.style.getPropertyValue("--es-vvh"),
      kbd: root.classList.contains("es-kbd"),
    };
  })()`);
  check("d3: 実際の visualViewport の高さが --es-vvh に入り、キーボードは出ていないと判定される",
    real.hasVV === true && real.vvh === `${real.vvHeight}px` && real.kbd === false, real);
  await screenshot(send, "d3-mobile-edit.png");
}
