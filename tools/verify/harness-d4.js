// シナリオ d4(保存の競合: 他所での変更・復元の安全)の設定。?scenario=dN で選ばれる(harness.html が名前で引く)。
// 検査は tools/verify/checks/d4.mjs。サーバー側の書き換えは開く前(serverTexts)か、開いたあとに
// window.__esServerSet で行う。
(() => {
  window.__esScenarios = window.__esScenarios || {};

  // 下書きの保存キーは easysmarky:{studentCode}:{baseSheetId}:{times}(d1 と同じ回)
  const DRAFT_KEY = "easysmarky:2025HF249:1001:1";
  // 設問の値。base は下書きを書いたときにサーバーが持っていた値
  const values = (text) => ({ text, direction: 1, fontSize: 40, lineHeight: 1.2, color: "#000000" });

  // 下書きに base のある状態で残っている。
  //  ア(1): この端末で書き換え、サーバーは変わっていない → 戻る・競合なし
  //  イ(2): この端末では触っていない。サーバーは他所で書き換わった → 戻さない(古い値で置き換えない)
  //  ウ(3): この端末で書いた。サーバーも他所で書き換わった → 戻すが、競合として知らせる
  window.__esScenarios.d4restore = {
    serverTexts: { 2: "他所で書かれたイ", 3: "他所で書かれたウ" },
    seedStorage: {
      [DRAFT_KEY]: JSON.stringify({
        v: 2,
        savedAt: Date.now() - 60 * 60 * 1000,
        fields: {
          1: { ...values("下書きのア"), base: values("既存の下書きテキスト") },
          2: { ...values("古いイ"), base: values("古いイ") },
          3: { ...values("下書きのウ"), base: values("") },
        },
      }),
    },
  };

  // 設定なし。保存の競合・失敗系の検査は、開いたあとに window.__esServerSet / __esFail で作る
  window.__esScenarios.d4 = {};
})();
