// easysmarkyを起動するブックマークレットの元コード。
// 実際にブックマークに登録する際は README.md の手順に従い、
// 1行に圧縮したものを bookmarklet の「URL」欄に貼り付けてください。
// SCRIPT_URL は GitHub Pages(gh-pagesブランチ)で公開済みです。
//
// スマホでは開発者ツールが使えないため、失敗したときに「無反応」に見えないよう
// エラーを alert で表に出しています。また、読み込み中の二重タップで
// script タグが2本入るのを防いでいます(2本目は開いたばかりの画面を閉じてしまうため)。

javascript: (function () {
  var SCRIPT_URL = "https://yamapez.github.io/easysmarky/easysmarky.iife.js";
  try {
    if (window.__easysmarky) {
      window.__easysmarky.toggle();
      return;
    }
    // 読み込み中の再タップ。ここで何かすると二重に読み込まれるので無視する。
    if (window.__easysmarkyLoading) return;
    window.__easysmarkyLoading = true;

    var script = document.createElement("script");
    script.src = SCRIPT_URL + "?v=" + Date.now();
    script.onload = function () {
      window.__easysmarkyLoading = false;
    };
    script.onerror = function () {
      window.__easysmarkyLoading = false;
      alert(
        "easysmarky: スクリプトを読み込めませんでした。\n" +
          "通信環境や、ネットワーク側の制限をご確認ください。\n" +
          SCRIPT_URL
      );
    };
    (document.body || document.documentElement).appendChild(script);
  } catch (e) {
    window.__easysmarkyLoading = false;
    alert("easysmarky: 起動に失敗しました。\n" + e);
  }
})();
