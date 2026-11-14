// Smarky のページに easysmarky 本体を差し込む。ブックマークレット(bookmarklet/loader.js)と同じく、
// <script> をページに足して「ページの中」で動かす。ここでは Smarky の API もログイン情報も触らない。
//
// まず配布元(GitHub Pages)の最新を読み、使えなかったときだけ APK 同梱の写しを使う。
// 「使えた」かどうかは、読み込みのイベントではなく結果で決める。学校のフィルタは
// ブロック画面を 200 で返すことがあり、その場合 onload は発火するがスクリプトは動かない。
// 通信が黙って捨てられる場合は、どのイベントも来ないのでタイムアウトで切り替える。
(function () {
  var REMOTE = "https://yamapez.github.io/easysmarky/easysmarky.app.js";
  var BUNDLED = browser.runtime.getURL("easysmarky.app.js");
  var TIMEOUT_MS = 5000;

  var fellBack = false;
  var timer = null;

  // 起動ボタン(src/ui/launcher.ts が作る)が出ていれば、配布元の版が動いている
  function launched() {
    return !!document.getElementById("easysmarky-launcher");
  }

  function addScript(src) {
    var script = document.createElement("script");
    script.src = src;
    (document.body || document.documentElement).appendChild(script);
  }

  function fallBack() {
    if (fellBack) return;
    fellBack = true;
    if (timer !== null) clearTimeout(timer);
    addScript(BUNDLED);
  }

  var remote = document.createElement("script");
  remote.src = REMOTE + "?v=" + Date.now();
  remote.onload = function () {
    if (!launched()) fallBack();
  };
  remote.onerror = fallBack;
  (document.body || document.documentElement).appendChild(remote);

  timer = setTimeout(function () {
    if (!launched()) fallBack();
  }, TIMEOUT_MS);
})();
