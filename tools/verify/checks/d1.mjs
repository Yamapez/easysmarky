// 方向1(安全性・データ保全)の検査。
// 自動保存が書けないときの見せ方と離脱の文言、下書きの復元と「元に戻す」、破棄の確認、
// 保存後照合の不一致が複数あるときの「該当の設問を見る」の巡回を見る。
// シナリオ設定は harness-d1.js(d1restore / d1mismatch / d1mismatch1)。?scenario= で切り替える。
// 各検査は最初に openHarness で開き直すので、前の検査の状態を引きずらない。

const HOST = `document.getElementById("easysmarky-host").shadowRoot`;
// harness-d1.js の DRAFT_KEY と同じ(studentCode 2025HF249 / baseSheetId 1001 / times 1)
const DRAFT_KEY = "easysmarky:2025HF249:1001:1";

const sel = (s) => `${HOST}.querySelector(${JSON.stringify(s)})`;

export async function run(ctx) {
  const { send, evalJs, setViewport, openHarness, check, URL_HARNESS, sleep } = ctx;
  const ev = (expr) => evalJs(send, expr);
  const text = async (s) => (await ev(`${sel(s)}?.textContent ?? null`)) ?? "";

  /** 条件が真になるまで待つ(時間切れなら false) */
  async function until(expr, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await ev(expr)) return true;
      await sleep(100);
    }
    return false;
  }

  const openSheet = async () => {
    await until(`!!${sel(".es-list-item")}`);
    await ev(`${sel(".es-list-item")}.click(), true`);
    await until(`!!${sel(".es-form")} && !!${sel("textarea.es-textarea")}`);
    await sleep(600); // 画像デコードと初回描画の待ち
  };
  const setText = (value) => ev(`(() => {
    const ta = ${sel("textarea.es-textarea")};
    if (!ta) return false;
    ta.value = ${JSON.stringify(value)};
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const fieldText = () => ev(`${sel("textarea.es-textarea")}?.value ?? null`);
  const chip = (label) => ev(`(() => {
    const c = [...${HOST}.querySelectorAll(".es-strip-chip")].find((x) => (x.textContent || "").includes(${JSON.stringify(label)}));
    if (!c) return false;
    c.click();
    return true;
  })()`);
  const clickButton = (label) => ev(`(() => {
    const b = [...${HOST}.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const hasButton = (label) =>
    ev(`[...${HOST}.querySelectorAll("button")].some((x) => x.textContent.trim() === ${JSON.stringify(label)})`);
  const warnings = () => ev(`[...${HOST}.querySelectorAll(".es-warning")].map((x) => x.textContent).join("|")`);
  const storedDraft = () => ev(`localStorage.getItem(${JSON.stringify(DRAFT_KEY)})`);
  /** 次に出る confirm を、ヘッドレスで止まらないように差し替えて記録する */
  const stubConfirm = (answer) => ev(`(() => {
    window.__d1Confirm = [];
    window.__d1Answer = ${answer};
    window.confirm = (m) => { window.__d1Confirm.push(String(m)); return window.__d1Answer; };
    return true;
  })()`);
  const lastConfirm = () => ev(`((window.__d1Confirm || []).slice(-1)[0]) ?? ""`);
  const clickSave = () => ev(`${sel(".es-save-btn")}.click(), true`);

  // ================================================================ A. 自動保存が書けないとき
  await setViewport(send, 1400, 900);
  await openHarness(send, `${URL_HARNESS}?scenario=d1`);
  // 一覧が出ている間に書き込みを失敗させ、フォームを開く(起動直後の書き込みで失敗を拾えるか)
  await ev(`(() => {
    window.__d1OrigSetItem = window.__d1OrigSetItem || Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException("quota", "QuotaExceededError"); };
    return true;
  })()`);
  await openSheet();
  await sleep(300);
  const startFail = { text: await text(".es-autosave"), failed: await ev(`${sel(".es-autosave")}.classList.contains("failed")`) };
  check("D1 起動直後に書けなければ、自動保存の失敗を警告する",
    startFail.failed === true && startFail.text.includes("自動保存できません"), startFail);

  await setText("失敗中の入力");
  await sleep(800); // 自動保存は 500ms の遅延のあとに書かれる
  const failAfterEdit = await text(".es-autosave");
  check("D1 入力後も書けなければ、失敗の警告のまま(成功時刻は出さない)",
    failAfterEdit.includes("自動保存できません") && !/\d\d:\d\d/.test(failAfterEdit), failAfterEdit);

  await stubConfirm(false);
  await ev(`${sel(".es-header-back")}.click(), true`);
  await sleep(150);
  const leaveFail = await lastConfirm();
  check("D1 自動保存に失敗したまま離れるときは、残っているとは言わずに確認する",
    leaveFail.includes("自動保存にも失敗") && !leaveFail.includes("自動保存されていますが"), leaveFail);
  check("D1 確認でやめたら、画面に留まる", (await ev(`!!${sel(".es-form")}`)) === true, null);

  // 書き込みが戻ったら、次の入力で警告が消え、時刻が出る
  await ev(`(() => { if (window.__d1OrigSetItem) Storage.prototype.setItem = window.__d1OrigSetItem; return true; })()`);
  await setText("回復後の入力");
  const recovered = await until(
    `${sel(".es-autosave")}.textContent.includes("この端末に自動保存 ") && !${sel(".es-autosave")}.classList.contains("failed")`,
    3000,
  );
  check("D1 書けるようになると、次の自動保存で警告が消え時刻が出る", recovered === true, await text(".es-autosave"));
  await stubConfirm(false);
  await ev(`${sel(".es-header-back")}.click(), true`);
  await sleep(150);
  const leaveOk = await lastConfirm();
  check("D1 自動保存できている未保存の離脱では、従来どおりの文言を使う",
    leaveOk.includes("自動保存されていますが") && !leaveOk.includes("失敗"), leaveOk);

  // ================================================================ B. 復元と「元に戻す」
  await openHarness(send, `${URL_HARNESS}?scenario=d1restore`);
  await openSheet();
  await sleep(300);
  const offer = await warnings();
  check("D1 下書きが残っていれば、復元と破棄の選択肢を出す",
    offer.includes("残っています") && (await hasButton("復元する")) && (await hasButton("破棄する")), offer);
  const beforeRestore = await fieldText();
  check("D1 復元する前は、解答欄にサーバーの内容が出ている", beforeRestore === "既存の下書きテキスト", beforeRestore);

  await clickButton("復元する");
  await sleep(300);
  const restoredA = await fieldText();
  const banner = await warnings();
  check("D1 復元すると下書きの内容になり、「元に戻す」付きのバナーに変わる",
    restoredA === "復元した下書きア" && banner.includes("下書きを復元しました") && (await hasButton("元に戻す")),
    { restoredA, banner });

  await chip("イ");
  await sleep(300);
  const restoredB = await fieldText();
  check("D1 復元は残っている全設問に効く", restoredB === "復元した下書きイ", restoredB);

  await clickButton("元に戻す");
  await sleep(300);
  const undoneB = await fieldText(); // 設問イのまま
  await chip("ア");
  await sleep(300);
  const undoneA = await fieldText();
  check("D1 元に戻すと、復元前の内容に戻る(全設問)",
    undoneB === "" && undoneA === "既存の下書きテキスト", { undoneB, undoneA });
  const stored = await storedDraft();
  check("D1 元に戻しても、この端末の下書きは書き換えない",
    stored !== null && JSON.parse(stored).fields["1"].text === "復元した下書きア", stored);
  const offerAgain = await warnings();
  check("D1 元に戻したあとは、復元と破棄の選択肢をもう一度出す",
    offerAgain.includes("残っています") && (await hasButton("復元する")) && !(await hasButton("元に戻す")), offerAgain);

  // 復元のあとに編集が入ったら「元に戻す」は消える(今打った分を黙って消さないため)
  await clickButton("復元する");
  await sleep(300);
  await setText("復元のあとに打った文");
  await sleep(200);
  check("D1 復元のあとに編集すると「元に戻す」は消え、打った分は残る",
    !(await hasButton("元に戻す")) && (await fieldText()) === "復元のあとに打った文",
    { undo: await hasButton("元に戻す"), value: await fieldText() });

  // ================================================================ C. 破棄は確認を通す
  await openHarness(send, `${URL_HARNESS}?scenario=d1restore`);
  await openSheet();
  await sleep(300);
  await stubConfirm(false);
  await clickButton("破棄する");
  await sleep(200);
  const confirmText = await lastConfirm();
  check("D1 破棄は確認を通す(確認に、元に戻せないことを書く)", confirmText.includes("破棄") && confirmText.includes("元に戻せません"), confirmText);
  check("D1 確認でやめたら、下書きも選択肢も残る",
    (await storedDraft()) !== null && (await hasButton("破棄する")), null);

  await ev(`window.__d1Answer = true`);
  await clickButton("破棄する");
  await sleep(200);
  check("D1 確認で了承すると、下書きと選択肢が消える",
    (await storedDraft()) === null && !(await hasButton("破棄する")), null);

  // ================================================================ D. 保存後照合の不一致が3件
  await openHarness(send, `${URL_HARNESS}?scenario=d1mismatch`);
  await openSheet();
  await sleep(300);
  await chip("イ");
  await sleep(200);
  await setText("不一致イ");
  await chip("ウ");
  await sleep(200);
  await setText("不一致ウ");
  await chip("オ");
  await sleep(200);
  await setText("不一致オ");
  await sleep(100);
  await clickSave();
  await until(`${sel(".es-save-status")}.textContent.includes("(3件)")`, 10000);
  const statusD = await text(".es-save-status");
  const cardD = await text(".es-error");
  check("D1 不一致が複数のとき、ステータスは短く件数だけを出す",
    statusD.includes("(3件)") && !statusD.includes("公式画面") && !statusD.includes("保存済み"), statusD);
  check("D1 詳細はカードにだけ出す(ステータスと重ねない)", cardD.includes("公式画面") && cardD.includes("3件"), cardD);

  const visits = [];
  for (let i = 0; i < 4; i++) {
    visits.push(await ev(`(() => {
      const b = [...${HOST}.querySelectorAll(".es-save-actions button")].find((x) => x.textContent.startsWith("該当の設問を見る"));
      if (!b) return null;
      b.click();
      return { label: b.textContent, name: ${sel(".es-editor-name")}?.textContent ?? "" };
    })()`));
    await sleep(250);
  }
  check("D1 「該当の設問を見る」は押すたびに次の不一致へ回り、(n/3) を出す",
    visits[0]?.label.includes("(1/3)") && visits[1]?.label.includes("(2/3)") &&
    visits[2]?.label.includes("(3/3)") && visits[3]?.label.includes("(1/3)") &&
    visits[0].name.includes("イ") && visits[1].name.includes("ウ") &&
    visits[2].name.includes("オ") && visits[3].name.includes("イ"),
    visits);

  // ================================================================ E. 不一致が1件のとき
  await openHarness(send, `${URL_HARNESS}?scenario=d1mismatch1`);
  await openSheet();
  await sleep(300);
  await chip("イ");
  await sleep(200);
  await setText("不一致イ");
  await sleep(100);
  await clickSave();
  await until(`${sel(".es-save-status")}.textContent.includes("(1件)")`, 10000);
  const one = await ev(`(() => {
    const b = [...${HOST}.querySelectorAll(".es-save-actions button")].find((x) => x.textContent.startsWith("該当の設問を見る"));
    if (!b) return null;
    b.click();
    return { label: b.textContent, name: ${sel(".es-editor-name")}?.textContent ?? "" };
  })()`);
  check("D1 不一致が1件のときは位置(n/1)を出さず、その設問へ移る",
    one?.label === "該当の設問を見る" && one.name.includes("イ"), one);

  await setViewport(send, 430, 900);
}
