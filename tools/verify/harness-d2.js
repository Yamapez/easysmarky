// シナリオ d2(方向2: 一覧画面)の設定。?scenario=d2 のときだけ使われる。
// 締切は実行時刻からの相対日数で作る(日付に依存させない)。
// 注意: 既定の先頭の回(id 1001、REPORT と一致)は既定の一覧の話。このシナリオでも 1001 は残す。
window.__esScenarios = window.__esScenarios || {};

const D2_DAY = 86_400_000;
const d2At = (days) => (days === null ? null : new Date(Date.now() + days * D2_DAY).toISOString());

function d2Base(id, reportNo, std, final, published = true) {
  return {
    id, sheet_code: `S-${id}`, report_no: reportNo, answer_image_completed: false,
    is_published: published, publish_at: null,
    std_deadline_at: d2At(std), final_deadline_at: d2At(final), sheet_type: 1,
  };
}

/** 提出済みか、途中まで書いた(下書き)の生徒の回。times は一覧APIが返す値 */
function d2Student(baseId, { times = 1, submitted = false } = {}) {
  return {
    id: baseId * 10, base_sheet_id: baseId, times, status: 0, score: null,
    submitted_at: submitted ? d2At(-1) : null,
  };
}

function d2Subject(code, name, bases, students) {
  return {
    student_subject: { subject_code: code, nendo: 2025, report_count: bases.length, subject_name: name },
    student_sheets: students,
    base_sheets: bases,
  };
}

function buildD2List() {
  const rows = [
    // 国語: 1001 は未提出で全体でいちばん早い締切(先頭に来る)。1003 は提出済み
    d2Subject("JPN", "国語総合", [
      d2Base(1001, 1, -40, null),
      d2Base(1002, 2, -3, 10),
      d2Base(1003, 3, 7, null),
      d2Base(1004, 4, 14, null, false),
    ], [
      null,
      d2Student(1002, { times: 2 }),
      d2Student(1003, { submitted: true }),
      null,
    ]),
    // 数学: 2001 は最終締切を過ぎた未提出。2003 は締切を過ぎた提出済み(強調しない)
    d2Subject("MTH", "数学", [
      d2Base(2001, 1, -20, -5),
      d2Base(2002, 2, 3, null),
      d2Base(2003, 3, -10, null),
    ], [
      null,
      d2Student(2002, { submitted: true }),
      d2Student(2003, { submitted: true }),
    ]),
    // 英語: 締切が早い 3001 は提出済み。提出済みは締切に関係なく後ろに回る
    d2Subject("ENG", "英語", [
      d2Base(3001, 1, -30, null),
      d2Base(3002, 2, 20, null),
    ], [
      d2Student(3001, { submitted: true }),
      null,
    ]),
  ];
  // 一覧を長くして、スクロールできる状態にする(補助科目 6 つ・各 2 回)
  for (let i = 1; i <= 6; i++) {
    rows.push(d2Subject(`F${i}`, `補助科目${i}`, [
      d2Base(4000 + i * 10 + 1, 1, 30 + i, null),
      d2Base(4000 + i * 10 + 2, 2, 40 + i, null),
    ], [null, null]));
  }
  return { student_subject_rows: rows, max_report_count: 4, report_nos: [1, 2, 3, 4], sheet_types: [1] };
}

window.__esScenarios.d2 = { sheetList: buildD2List() };
