// 方向2(一覧画面)の検査。設定は harness-d2.js(?scenario=d2)。
// 締切の強調・提出済みの後ろ送り・続きから・更新・スクロール保持・書字方向の記憶を、ページ内の状態で確かめる。

const SHADOW = 'document.getElementById("easysmarky-host").shadowRoot';
const q = (sel) => `${SHADOW}.querySelector(${JSON.stringify(sel)})`;
const clickItem = (id) => `${q(`.es-list-item[data-base-sheet-id="${id}"]`)}.click(); true`;
const clickChip = (i) => `${SHADOW}.querySelectorAll(".es-strip-chip")[${i}].click(); true`;
const clickDirection = (text) =>
  `Array.from(${SHADOW}.querySelectorAll(".es-direction-toggle button")).find((b) => b.textContent === "${text}").click(); true`;
const activeDirections = `Array.from(${SHADOW}.querySelectorAll(".es-direction-toggle button.active")).map((b) => b.textContent)`;

/** 一覧の行を、画面の並び順のまま読む(見出しごとの科目名と、締切の強調・提出済みの有無つき) */
const LIST_READ = `(() => {
  const col = ${q(".es-column")};
  let heading = "";
  const out = [];
  for (const el of Array.from(col.children)) {
    if (el.classList.contains("es-list-heading")) heading = el.textContent;
    else if (el.classList.contains("es-list-item")) {
      out.push({
        id: Number(el.dataset.baseSheetId),
        heading,
        classes: Array.from(el.classList),
        overdue: Array.from(el.querySelectorAll(".es-badge.overdue, .es-badge.overdue-final")).map((x) => x.textContent),
        submitted: !!el.querySelector(".es-badge.done"),
      });
    }
  }
  return out;
})()`;

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function fillerIds() {
  const ids = [];
  for (let i = 1; i <= 6; i++) ids.push(4000 + i * 10 + 1, 4000 + i * 10 + 2);
  return ids;
}

export async function run(ctx) {
  const { send, evalJs, setViewport, openHarness, check, URL_HARNESS, sleep, screenshot } = ctx;
  const ev = (expr) => evalJs(send, expr);
  const until = async (expr, label, timeout = 8000) => {
    const start = Date.now();
    for (;;) {
      const v = await ev(expr).catch(() => null);
      if (v) return v;
      if (Date.now() - start > timeout) throw new Error(`timeout: ${label}`);
      await sleep(100);
    }
  };
  const openItem = async (id) => {
    await ev(clickItem(id));
    await until(`!!${q(".es-form")}`, `form ${id}`);
    await sleep(300);
  };
  const backToList = async () => {
    await ev(`${q(".es-header-back")}.click(); true`);
    await until(`!!${q(".es-list-refresh")}`, "list");
    await sleep(100);
  };
  const refreshList = async () => {
    await ev(`${q(".es-list-refresh")}.click(); true`);
    await until(`!!${q(".es-list-refresh")} && !${q(".es-loading")}`, "refresh");
  };
  const keyOfLast = `Object.keys(localStorage).find((k) => k.startsWith("easysmarky:last:"))`;

  // ============================================================ A: 一覧の表示・更新・続きから
  await setViewport(send, 430, 900);
  await openHarness(send, `${URL_HARNESS}?scenario=d2`);
  // 未保存の確認が出るとCDPが止まるので、確認は通す(この検査では未保存にしない操作だけ行う)
  await ev(`window.confirm = () => true; true`);

  const rows = await ev(LIST_READ);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const ids = rows.map((r) => r.id);
  const expectIds = [1001, 1002, 1003, 2001, 2003, 2002, 3002, 3001, ...fillerIds()];
  check("一覧の並び: 科目は締切の近い順、回は未提出が先で締切の近い順、提出済みは後ろ",
    deepEq(ids, expectIds), ids);

  const headings = [...new Set(rows.map((r) => r.heading))];
  check("科目の並びは、未提出の中でいちばん近い締切の順(国語→数学→英語→補助)",
    deepEq(headings.slice(0, 3), ["国語総合", "数学", "英語"]), headings);

  check("締切(標準): 標準締切だけ過ぎた未提出は「標準締切を過ぎています」(注意)",
    deepEq(byId[1001].overdue, ["標準締切を過ぎています"]) &&
    deepEq(byId[1002].overdue, ["標準締切を過ぎています"]) &&
    byId[1001].classes.includes("overdue") && !byId[1001].classes.includes("overdue-final"),
    { 1001: byId[1001], 1002: byId[1002] });

  check("締切(最終): 最終締切を過ぎた未提出は「最終締切を過ぎています」(強い警告)",
    deepEq(byId[2001].overdue, ["最終締切を過ぎています"]) && byId[2001].classes.includes("overdue-final"),
    byId[2001]);

  const submittedIds = [1003, 2002, 2003, 3001];
  check("締切: 提出済みは締切を過ぎていても強調しない",
    submittedIds.every((id) => byId[id].submitted && byId[id].overdue.length === 0 &&
      !byId[id].classes.includes("overdue") && !byId[id].classes.includes("overdue-final")),
    submittedIds.map((id) => byId[id]));

  check("締切: 期限内の未提出は強調しない",
    [3002, 4011].every((id) => !byId[id].submitted && byId[id].overdue.length === 0),
    [3002, 4011].map((id) => byId[id]));

  check("更新ボタンは一覧の注記行にある",
    await ev(`!!${q(".es-list-note .es-list-refresh")}`), null);

  check("続きから: 開いた履歴が無いときは出ない", !(await ev(`!!${q(".es-resume")}`)), null);

  await screenshot(send, "d2-list-phone.png");

  // --- スクロール保持: 回を開いて戻っても、scrollTop の値が元に戻る。続きからの行が増えると見える中身は1行ほどずれるが、位置の値は保つ ---
  await ev(`${q(".es-column")}.scrollTop = 600; true`);
  await sleep(100);
  const topBefore = await ev(`${q(".es-column")}.scrollTop`);
  await openItem(2001);
  await backToList();
  const topAfterBack = await ev(`${q(".es-column")}.scrollTop`);
  check("スクロール保持: 回を開いて「← 科目一覧」で戻ると、元の位置(±2px)に戻る",
    topBefore >= 590 && Math.abs(topAfterBack - 600) <= 2, { topBefore, topAfterBack });

  // --- 更新でも同じ位置に残る ---
  await ev(`${q(".es-column")}.scrollTop = 600; true`);
  await sleep(100);
  await refreshList();
  const topAfterRefresh = await ev(`${q(".es-column")}.scrollTop`);
  check("スクロール保持: 更新しても同じ位置(±2px)に残る",
    Math.abs(topAfterRefresh - 600) <= 2, { topAfterRefresh });

  // --- 続きから: 直前に開いた 2001 が先頭に出る ---
  const resume = await ev(`(() => {
    const el = ${q(".es-resume")};
    const col = ${q(".es-column")};
    return el ? { text: el.textContent, first: col.firstElementChild === el } : null;
  })()`);
  check("続きから: 前回開いた回(数学 第1回)を一覧の先頭に出す",
    resume !== null && resume.text === "続きから: 数学 第1回" && resume.first === true, resume);

  // --- 続きから: 開く回の times は一覧APIの値を優先する(保存されていた times は使わない) ---
  await ev(`(() => {
    const key = ${keyOfLast};
    localStorage.setItem(key, JSON.stringify({ v: 1, baseSheetId: 1002, times: 1, subjectCode: "JPN",
      subjectName: "国語総合", nendo: 2025, reportNo: 2, openedAt: 0 }));
    return true;
  })()`);
  await refreshList();
  const resumeText = await ev(`${q(".es-resume")}.textContent`);
  await ev(`window.__d2Urls = []; (() => {
    const prev = window.fetch;
    window.fetch = (input, init) => { window.__d2Urls.push(String(input)); return prev(input, init); };
  })(); true`);
  await ev(`${q(".es-resume")}.click(); true`);
  await until(`!!${q(".es-form")}`, "resume form");
  const urls = await ev(`window.__d2Urls.filter((u) => u.includes("digital_report"))`);
  const timesSent = urls.map((u) => new URL(u, "http://x").searchParams.get("times"));
  check("続きから: 開く回の times は一覧APIの値(2)で、保存されていた値(1)は使わない",
    resumeText === "続きから: 国語総合 第2回" && timesSent.length > 0 && timesSent.every((t) => t === "2"),
    { resumeText, timesSent });

  // --- 続きから: 今の一覧に無い回は出さない。壊れた保存値でも一覧は出る ---
  await backToList();
  await ev(`(() => {
    localStorage.setItem(${keyOfLast}, JSON.stringify({ v: 1, baseSheetId: 9999, times: 1, subjectCode: "X",
      subjectName: "消えた科目", nendo: 2024, reportNo: 9, openedAt: 0 }));
    return true;
  })()`);
  await refreshList();
  check("続きから: 今の一覧に無い回(baseSheetId が無い)は出ない",
    !(await ev(`!!${q(".es-resume")}`)), null);
  await ev(`localStorage.setItem(${keyOfLast}, "{not json"); true`);
  await refreshList();
  check("続きから: 保存値が壊れていても一覧は出て、続きからは出ない",
    (await ev(`!!${q(".es-list-item")}`)) && !(await ev(`!!${q(".es-resume")}`)), null);

  // --- 進捗: 集計規則の版が古い要約(rules なし)は一覧に出さない。版が合えば出る ---
  // 旧版の要約「1/1」が残っていると、記号問題の未回答でも完了に見えてしまうため。
  const seedSummary = (entry) => ev(`(() => {
    const last = Object.keys(localStorage).find((k) => k.startsWith("easysmarky:last:"));
    if (!last) throw new Error("seedSummary: easysmarky:last: が無い(前段の続きからの検査が必要)");
    const code = last.slice("easysmarky:last:".length);
    localStorage.setItem("easysmarky:summary:" + code, JSON.stringify({ "1001:1": ${JSON.stringify(entry)} }));
    return true;
  })()`);
  const progress1001 = () => ev(`${q('.es-list-item[data-base-sheet-id="1001"] .es-list-progress')}?.textContent ?? null`);
  const summary = { total: 1, filled: 1, blocked: false, savedAt: 0 };
  await seedSummary(summary); // 版なし(旧版で書かれた要約)
  await refreshList();
  const oldProgress = await progress1001();
  await seedSummary({ ...summary, rules: 2 }); // 現在の版
  await refreshList();
  const currentProgress = await progress1001();
  check("進捗: 集計規則の版が古い要約は一覧に出さず「—」にする(完了に見えない)",
    oldProgress === "—" && currentProgress === "1/1",
    { oldProgress, currentProgress });

  // --- 更新: 取り直した内容を反映する(提出済みになった 1001 は強調が消え、後ろへ回る) ---
  await ev(`(() => {
    const L = JSON.parse(JSON.stringify(window.__esScenarios.d2.sheetList));
    L.student_subject_rows[0].student_sheets[0] = {
      id: 9001, base_sheet_id: 1001, times: 1, status: 0, score: null, submitted_at: new Date().toISOString(),
    };
    window.__esScenarios.d2.sheetList = L;
    return true;
  })()`);
  await refreshList();
  const rows2 = await ev(LIST_READ);
  const kokugo2 = rows2.filter((r) => r.heading === "国語総合").map((r) => r.id);
  const r1001 = rows2.find((r) => r.id === 1001);
  // 提出済み同士は締切の近い順(1001 の締切は 1003 より早い)。未提出の 1002 より後ろに回る
  check("更新: 取り直した内容を反映し、提出済みになった回は強調が消えて後ろへ回る",
    deepEq(kokugo2, [1002, 1001, 1003]) && r1001.submitted && r1001.overdue.length === 0,
    { kokugo2, r1001 });

  // --- 更新の失敗: 「読み込めませんでした」と出し、やり直しで一覧に戻る ---
  await ev(`(() => {
    window.__d2Prev = window.fetch;
    window.fetch = (input, init) =>
      String(input).startsWith("/api/student/student_sheet_list")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : window.__d2Prev(input, init);
    return true;
  })()`);
  await ev(`${q(".es-list-refresh")}.click(); true`);
  await until(`!!${q(".es-error")}`, "error box");
  const errText = await ev(`${q(".es-error")}.textContent`);
  await ev(`window.fetch = window.__d2Prev; true`);
  check("更新の失敗: 「読み込めませんでした」を出す", errText.includes("読み込めませんでした"), errText);
  await ev(`${q(".es-list-item")}.click(); true`);
  await until(`!!${q(".es-list-refresh")}`, "list after retry");
  check("更新の失敗: やり直しで一覧に戻る", (await ev(`!!${q(".es-list-item")}`)) === true, null);

  // ============================================================ B: 書字方向の記憶
  // 記憶は端末共通(easysmarky:prefs)。ページを開き直すと消えるので、同じページ内で確かめる
  await openHarness(send, `${URL_HARNESS}?scenario=d2`);
  await ev(`window.confirm = () => true; true`);
  check("書字方向: 最初は記憶が無い", (await ev(`localStorage.getItem("easysmarky:prefs")`)) === null, null);

  await openItem(1001);
  await ev(clickChip(0));
  await sleep(300);
  check("書字方向: 答えのあるテキスト設問(ア)は、答えの向き(横書き)のまま",
    deepEq(await ev(activeDirections), ["横書き"]), await ev(activeDirections));

  await ev(clickChip(1));
  await sleep(300);
  await ev(clickDirection("縦書き"));
  const prefsAfterVert = await ev(`localStorage.getItem("easysmarky:prefs")`);
  check("書字方向: 手動で縦書きにすると、端末に覚える",
    prefsAfterVert !== null && JSON.parse(prefsAfterVert).direction === 2, prefsAfterVert);

  await ev(`window.__prefWrites = 0;
    (() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "easysmarky:prefs") window.__prefWrites++;
        return orig.call(this, k, v);
      };
    })(); true`);
  await ev(clickDirection("縦書き"));
  check("書字方向: 今の向きを押し直しただけでは保存しない", (await ev(`window.__prefWrites`)) === 0, null);

  await backToList();
  await openItem(1002);
  await ev(clickChip(1));
  await sleep(300);
  check("書字方向: 記憶した縦書きが、答えの無い設問(イ)の既定値になる(別の回でも)",
    deepEq(await ev(activeDirections), ["縦書き"]), await ev(activeDirections));
  check("書字方向: 開いただけでは保存しない", (await ev(`window.__prefWrites`)) === 0, null);

  await ev(clickChip(0));
  await sleep(300);
  check("書字方向: 答えのある設問(ア)は、記憶が変わっても答えの向きのまま",
    deepEq(await ev(activeDirections), ["横書き"]), await ev(activeDirections));

  // ============================================================ C: 既定シナリオ(先頭は 1001 のまま)
  await openHarness(send, URL_HARNESS);
  const first = await ev(`(() => { const b = ${q(".es-list-item")}; return b ? b.dataset.baseSheetId : null; })()`);
  check("既定シナリオ: 一覧の先頭は 1001 のまま(既存検査は先頭の回を開く前提)", first === "1001", first);
  check("既定シナリオ: 開いた履歴が無いので続きからは出ない",
    !(await ev(`!!${q(".es-resume")}`)), null);
}
