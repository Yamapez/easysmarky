// easysmarkyを起動するブックマークレットの元コード。
// 実際にブックマークに登録する際は README.md の手順に従い、
// 1行に圧縮したものを bookmarklet の「URL」欄に貼り付けてください。
// SCRIPT_URL は GitHub Pages(gh-pagesブランチ)で公開済みです。

javascript: (function () {
  var SCRIPT_URL = "https://yamapez.github.io/easysmarky/easysmarky.iife.js";
  if (window.__easysmarky) {
    window.__easysmarky.toggle();
    return;
  }
  var script = document.createElement("script");
  script.src = SCRIPT_URL + "?v=" + Date.now();
  document.body.appendChild(script);
})();
