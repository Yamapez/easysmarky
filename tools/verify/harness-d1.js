// シナリオ d1(方向1: 安全性・データ保全)の設定。?scenario=dN で選ばれる(harness.html が名前で引く)。
// 検査ごとに名前を分けて登録する。設定項目は harness.html の「シナリオ」節を参照。
(() => {
  window.__esScenarios = window.__esScenarios || {};

  // 下書きの保存キーは easysmarky:{studentCode}:{baseSheetId}:{times}。
  // studentCode は studentCodeFromLoginId("85_2025HF249") = "2025HF249"、baseSheetId は 1001、times は 1
  const DRAFT_KEY = "easysmarky:2025HF249:1001:1";
  const draft = (savedAt) => JSON.stringify({
    v: 2,
    savedAt,
    fields: {
      1: { text: "復元した下書きア", direction: 0, fontSize: 40, lineHeight: 1.2, color: "#000000" },
      2: { text: "復元した下書きイ", direction: 0, fontSize: 40, lineHeight: 1.2, color: "#000000" },
    },
  });

  // 設定なし(従来どおり)。?scenario=d1 のときに空の設定として読まれる
  window.__esScenarios.d1 = {};
  // 一覧から開く前に、この端末に下書きが残っている状態
  window.__esScenarios.d1restore = { seedStorage: { [DRAFT_KEY]: draft(Date.now() - 60 * 60 * 1000) } };
  // 保存後照合の不一致を3件作る(2・3・5 を REPORT に書き戻さない)
  window.__esScenarios.d1mismatch = { skipWriteBackIds: [2, 3, 5] };
  // 不一致が1件だけのとき(件数の表示が出ないことを見る)
  window.__esScenarios.d1mismatch1 = { skipWriteBackIds: [2] };
  // 保存の応答を遅らせ、下書きの自動保存(500ms)より後に保存が終わるようにする(保留中の書き込みの取り消しを見る)
  window.__esScenarios.d1savequick = { delayMs: { save: 300 } };
  // 前の退避(古い内容)が残っている状態で、下書きに提示が出ている(退避は今の下書きで置き換わるべき)
  window.__esScenarios.d1archive = {
    seedStorage: {
      [DRAFT_KEY]: draft(Date.now() - 60 * 60 * 1000),
      "easysmarky:archive:2025HF249:1001:1": JSON.stringify({ v: 2, savedAt: 0, fields: {} }),
    },
  };
})();
