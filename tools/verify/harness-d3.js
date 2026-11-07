// シナリオ d3(方向3: スマホの入力体験)の設定。?scenario=d3 のときだけ使われる。
// harness.html の inline script より先に読み込まれるので、URL の指定から初期データと擬似環境を組み立てる。
//   ?delay=ms  一覧・報告の応答を遅らせる(読み込み表示の確認用)
//   ?zoom=n    開く前に easysmarky:prefs へ記憶した倍率を入れる
//   ?real=1    擬似の visualViewport を入れない(実機の visualViewport の値を見る用)
// 既定では visualViewport を差し替える。キーボード表示は window.__esFakeVV の height を変えて resize を流して再現する
// (ヘッドレスの Emulation では visualViewport.height が変わらないため)。
(function () {
  window.__esScenarios = window.__esScenarios || {};
  const params = new URLSearchParams(location.search);
  if (params.get("scenario") !== "d3") {
    window.__esScenarios.d3 = {};
    return;
  }
  const cfg = {};
  const delay = Number(params.get("delay"));
  if (delay > 0) cfg.delayMs = { list: delay, digitalReport: delay };
  const zoom = Number(params.get("zoom"));
  if (zoom > 0) {
    cfg.seedStorage = { "easysmarky:prefs": JSON.stringify({ v: 1, zoom, direction: null }) };
  }
  window.__esScenarios.d3 = cfg;

  if (params.get("real") !== "1") {
    const fake = new EventTarget();
    Object.assign(fake, { width: innerWidth, height: innerHeight, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
    window.__esFakeVV = fake;
  }
})();
