// 方向4(保存の競合)の検査。
// 保存直前の再取得で「他所での変更」を見つけて送らずに止めること、「上書きして保存」は確認を通してからだけ送ること、
// 変わっていなければ・同じ内容なら止めないこと、手書きの混入で止まること、
// 下書きの復元で「触っていない設問」を古い値で戻さないこと、別タブの書き込みを知らせることを見る。
// シナリオ設定は harness-d4.js(d4restore / d4)。?scenario= で切り替える。
// 各検査は最初に openHarness で開き直すので、前の検査の状態を引きずらない。

const HOST = `document.getElementById("easysmarky-host").shadowRoot`;
// harness-d4.js の DRAFT_KEY と同じ(studentCode 2025HF249 / baseSheetId 1001 / times 1)
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
  /** 設問チップを押して、その設問を開く(ア〜キのラベルで指定) */
  const chip = (label) => ev(`(() => {
    const c = [...${HOST}.querySelectorAll(".es-strip-chip")].find((x) => (x.textContent || "").includes(${JSON.stringify(label)}));
    if (!c) return false;
    c.click();
    return true;
  })()`);
  const setText = (value) => ev(`(() => {
    const ta = ${sel("textarea.es-textarea")};
    if (!ta) return false;
    ta.value = ${JSON.stringify(value)};
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  const fieldText = () => ev(`${sel("textarea.es-textarea")}?.value ?? null`);
  /** 文字が完全に一致するボタンを押す */
  const clickButton = (label) => ev(`(() => {
    const b = [...${HOST}.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  /** 文字を含むボタンを押す(「該当の設問を見る (1/2)」のように件数が付くもの用) */
  const clickButtonLike = (label) => ev(`(() => {
    const b = [...${HOST}.querySelectorAll("button")].find((x) => (x.textContent || "").includes(${JSON.stringify(label)}));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const hasButtonLike = (label) =>
    ev(`[...${HOST}.querySelectorAll("button")].some((x) => (x.textContent || "").includes(${JSON.stringify(label)}))`);
  const hasButton = (label) =>
    ev(`[...${HOST}.querySelectorAll("button")].some((x) => x.textContent.trim() === ${JSON.stringify(label)})`);
  const warnings = () => ev(`[...${HOST}.querySelectorAll(".es-warning")].map((x) => x.textContent).join("|")`);
  const errorText = () => ev(`${sel(".es-error")}?.textContent ?? ""`);
  const status = () => text(".es-save-status");
  const postCount = () => ev(`POST_LOG.length`);
  const lastPostText = (id) => ev(`(() => {
    const last = POST_LOG[POST_LOG.length - 1];
    const hit = last && last.texts.find((t) => t.id === ${id});
    return hit ? hit.text : null;
  })()`);
  const serverSet = (id, value) => ev(`window.__esServerSet(${id}, ${JSON.stringify(value)})`);
  /** 次に出る confirm を、ヘッドレスで止まらないように差し替えて記録する */
  const stubConfirm = (answer) => ev(`(() => {
    window.__d4Confirm = [];
    window.__d4Answer = ${answer};
    window.confirm = (m) => { window.__d4Confirm.push(String(m)); return window.__d4Answer; };
    return true;
  })()`);
  const confirmCount = () => ev(`(window.__d4Confirm || []).length`);

  /**
   * 未保存のまま開き直すと、ブラウザの離脱確認が出て CDP が止まる。開き直す前に、
   * 離脱確認を出す(preventDefault する)オーバーレイのリスナーを止める。検査の途中で確認を出したくないだけで、
   * 離脱ガードそのものの検査は d1 で行っている。
   */
  const openFresh = async (query) => {
    await ev(`window.addEventListener("beforeunload", (e) => e.stopImmediatePropagation(), true), true`);
    await openHarness(send, `${URL_HARNESS}?scenario=${query}`);
  };

  await setViewport(send, 1400, 900);

  // ================================================================ A. 復元で、触っていない設問を戻さない
  await openFresh("d4restore");
  await openSheet();
  const offer = await warnings();
  check("D4 復元の提示に、他所でも変わった設問の件数が出る",
    offer.includes("サーバー側でも内容が変わった設問が1件"), offer);
  await clickButton("復元する");
  await sleep(400);
  const restored = await warnings();
  await chip("ア"); await sleep(200);
  const aText = await fieldText();
  await chip("イ"); await sleep(200);
  const iText = await fieldText();
  await chip("ウ"); await sleep(200);
  const uText = await fieldText();
  check("D4 この端末で触った設問(ア)は戻り、触っていない設問(イ)はサーバーの値のまま残る",
    aText === "下書きのア" && iText === "他所で書かれたイ",
    { aText, iText });
  check("D4 他所でも変わった、触った設問(ウ)は戻るが、競合として知らせる",
    uText === "下書きのウ" && restored.includes("サーバー側でも内容が変わった設問が1件"),
    { uText, restored });

  // 復元バナーは最初の編集で消える。その後に別の設問を打っても、他所で変わったウは保存で上書きの確認を出して止まる
  const postsBeforeRestoreSave = await postCount();
  await chip("オ"); await sleep(200);
  await setText("オの入力");
  await ev(`${sel(".es-save-btn")}.click(), true`);
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("保存していません")`);
  await sleep(200);
  check("D4 復元した競合は、後で別の設問を打っても、保存で上書きの確認を出して止まる",
    (await postCount()) === postsBeforeRestoreSave && (await errorText()).includes("サーバー側で内容が変わった設問が1件"),
    { posts: await postCount(), err: await errorText() });
  // 下書きには、復元した設問の元の base(書いた時点のサーバーの値)が残る。次に開いたときも競合として出せるように
  const savedBase = await ev(`(() => {
    const d = JSON.parse(localStorage.getItem(${JSON.stringify(DRAFT_KEY)}) || "null");
    const e = d && d.fields && d.fields["3"];
    return e && e.base ? e.base.text : null;
  })()`);
  check("D4 復元した設問の下書きには、元の base が残る",
    savedBase === "", { savedBase });

  // ================================================================ B. 保存直前に他所で変わった設問があると、送らずに止める
  await openFresh("d4");
  await openSheet();
  await chip("イ"); await sleep(200);
  await setText("ローカルのイ");
  // 開いたあとに、他所(別タブ・公式画面)で設問アが書き換わったことにする
  await serverSet(1, "他所のア");
  const beforeConflict = await postCount();
  await ev(`${sel(".es-save-btn")}.click(), true`);
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("保存していません")`);
  await sleep(200);
  check("D4 他所で変わった設問があると、送信せず止める",
    (await postCount()) === beforeConflict && (await status()).includes("他所での変更が1件"),
    { posts: await postCount(), beforeConflict, status: await status() });
  const conflictNotice = await errorText();
  check("D4 止めたときは、件数と「上書きして保存」の選択肢を出す",
    conflictNotice.includes("サーバー側で内容が変わった設問が1件") &&
    (await hasButton("上書きして保存")) && (await hasButtonLike("該当の設問を見る")),
    conflictNotice);
  // 確認で「いいえ」なら送らない
  await stubConfirm(false);
  await clickButton("上書きして保存");
  await sleep(200);
  check("D4 上書きは確認を通さないと送らない(いいえなら送らない)",
    (await confirmCount()) === 1 && (await postCount()) === beforeConflict,
    { confirms: await confirmCount(), posts: await postCount() });
  // 確認で「はい」なら、この画面の内容で送る
  await stubConfirm(true);
  await clickButton("上書きして保存");
  await until(`POST_LOG.length > ${beforeConflict}`);
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("反映を確認")`);
  await sleep(200);
  check("D4 上書きを選ぶと、この画面の内容で送られ、照合まで通る",
    (await postCount()) === beforeConflict + 1 &&
    (await lastPostText(1)) === "既存の下書きテキスト" &&
    (await lastPostText(2)) === "ローカルのイ" &&
    (await status()).includes("反映を確認"),
    { posts: await postCount(), a: await lastPostText(1), i: await lastPostText(2), status: await status() });

  // 送った後は基準が更新されるので、同じ内容なら止めない(イが他所で同じ文字に変わった場合)
  await chip("イ"); await sleep(200);
  await setText("ローカルのイ2");
  await serverSet(2, "ローカルのイ2");
  const beforeSame = await postCount();
  await ev(`${sel(".es-save-btn")}.click(), true`);
  await until(`POST_LOG.length > ${beforeSame}`);
  await sleep(200);
  check("D4 他所で変わっても、送る内容と同じなら止めない",
    (await postCount()) === beforeSame + 1 && !(await errorText()).includes("上書きして保存"),
    { posts: await postCount(), beforeSame, err: await errorText() });

  // ================================================================ C. 照合できなかった後の保存は、自分の分を競合と誤認しない
  await openFresh("d4");
  await openSheet();
  await ev(`window.__esFail.verifyOnce = true, true`);
  await chip("ウ"); await sleep(200);
  await setText("ウの一回目");
  await ev(`${sel(".es-save-btn")}.click(), true`);
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("反映を確認できませんでした")`);
  await chip("ウ"); await sleep(200);
  await setText("ウの二回目");
  const beforeRetry = await postCount();
  await ev(`${sel(".es-save-btn")}.click(), true`);
  await until(`POST_LOG.length > ${beforeRetry}`);
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("反映を確認")`);
  await sleep(200);
  check("D4 照合できなかった保存のあとは、自分の分を他所の変更と誤認せず保存できる",
    (await postCount()) === beforeRetry + 1 && !(await errorText()).includes("上書きして保存"),
    { posts: await postCount(), err: await errorText(), status: await status() });

  // ================================================================ D. 他所の変更を確かめられないときは送らない
  await openFresh("d4");
  await openSheet();
  await chip("オ"); await sleep(200);
  await setText("オの入力");
  await ev(`window.__esFail.preCheckOnce = true, true`);
  const beforePre = await postCount();
  await ev(`${sel(".es-save-btn")}.click(), true`);
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("保存に失敗")`);
  await sleep(200);
  check("D4 保存直前の再取得が落ちたら、送らずに失敗として伝え、入力は残す",
    (await postCount()) === beforePre && (await status()).includes("保存に失敗") &&
    (await errorText()).includes("残っています"),
    { posts: await postCount(), beforePre, status: await status(), err: await errorText() });

  // ================================================================ E. 他所で手書きが加わったら、保存を止める
  await openFresh("d4");
  await openSheet();
  await chip("ウ"); await sleep(200);
  await setText("ウの入力");
  await ev(`window.__esServerHandwrite(3), true`);
  const beforeHand = await postCount();
  await ev(`${sel(".es-save-btn")}.click(), true`);
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("保存に失敗")`);
  await sleep(200);
  check("D4 他所で手書きが加わっていたら、保存せず理由を出す",
    (await postCount()) === beforeHand && (await errorText()).includes("手書き"),
    { posts: await postCount(), err: await errorText() });

  // ================================================================ F. 同じ回を別のタブで書かれたら知らせる
  await openFresh("d4");
  await openSheet();
  await ev(`window.dispatchEvent(new StorageEvent("storage", { key: "easysmarky:2025HF249:1001:1" })), true`);
  await sleep(200);
  const tabWarn = await warnings();
  check("D4 同じ回が別のタブで書かれたら、食い違うおそれを知らせる",
    tabWarn.includes("別のタブでも編集されました"), tabWarn);
  await ev(`window.dispatchEvent(new StorageEvent("storage", { key: "easysmarky:summary:2025HF249" })), true`);
  await sleep(100);
  check("D4 関係の無いキーの書き込みでは知らせない(通知は1回だけ)",
    (await warnings()).split("別のタブでも編集").length - 1 === 1, await warnings());

  // ================================================================ G. 手書きのある回は、設定で許可したときだけ保存でき、許可のあとの増加は送らない
  // 回は d4binary(ウに手書き1件・イに canvas の筆跡。件数の合計は2)。許可は設定(easysmarky:prefs)から取る。
  const saveDisabled = () => ev(`${sel(".es-save-btn")}.disabled`);
  const statusNow = () => text(".es-save-status");
  const settingsOpen = () => ev(`${sel(".es-settings")}?.style.display === "flex"`);
  const settingsChecked = () => ev(`${sel(".es-settings-row input")}?.checked ?? null`);
  const setSettingsCheck = (on) => ev(`(() => {
    const b = ${sel(".es-settings-row input")};
    if (!b) return false;
    b.checked = ${on};
    b.dispatchEvent(new Event("change"));
    return true;
  })()`);
  /** 設定の「閉じる」(ヘッダの「閉じる」と区別するため、設定の中のボタンを押す) */
  const closeSettingsByButton = () => ev(`${sel(".es-settings-actions button")}.click(), true`);
  const pressKey = (init) => ev(`window.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify(init)})), true`);
  const overlayVisible = () => ev(`document.getElementById("easysmarky-host")?.style.display !== "none"`);
  const clickSave = async () => {
    await ev(`${sel(".es-save-btn")}.click(), true`);
    await sleep(500);
  };
  const LOCK_TEXT = "手書き・画像のある回は保存できません";
  /** ヘッダの「設定」を押して設定を開く */
  const openSettings = () => clickButton("設定");

  // G1: 既定では保存ボタンが無効。警告欄も同意欄も出さず、状態表示に理由と設定への案内を出す
  await openFresh("d4binary");
  await openSheet();
  check("D4 手書きのある回は、設定で許可するまで保存ボタンが無効",
    (await saveDisabled()) === true, await saveDisabled());
  // 手書きの警告文と同意欄は、フォームからなくなっている(文字のはみ出しなど別の警告は対象外)
  check("D4 フォームには手書きの警告文と同意欄を出さない",
    (await ev(`!!${sel(".es-consent")}`)) === false && !(await warnings()).includes("手書き・画像の解答が含まれています"),
    { warnings: await warnings() });
  check("D4 保存できない理由は状態表示に出す(設定への案内つき)",
    (await statusNow()).includes(LOCK_TEXT) && (await statusNow()).includes("設定"), await statusNow());

  // G2: 設定で許可すると、開き直さずに保存ボタンが有効になり、確認は出さずに送る。件数の表示も出す
  await stubConfirm(true);
  await openSettings();
  check("D4 ヘッダの「設定」で設定を開ける", (await settingsOpen()) === true, await settingsOpen());
  await setSettingsCheck(true);
  check("D4 設定の変更は、開いている画面の保存ボタンにその場で届く", (await saveDisabled()) === false, await saveDisabled());
  await closeSettingsByButton();
  check("D4 設定の「閉じる」で設定だけが閉じる", (await settingsOpen()) === false && (await overlayVisible()) === true, await settingsOpen());
  const beforeConsentSave = await postCount();
  await clickSave();
  check("D4 許可したあとの保存は、確認を出さずに送る",
    (await postCount()) === beforeConsentSave + 1 && (await confirmCount()) === 0,
    { posts: await postCount(), beforeConsentSave, confirms: await confirmCount() });
  check("D4 保存後に、手書き・画像の件数(保存前 → 保存後)を出す",
    (await warnings()).includes("保存前 2 件 → 保存後 2 件"), await warnings());
  const prefs = await ev(`localStorage.getItem("easysmarky:prefs")`);
  check("D4 許可は端末の設定(easysmarky:prefs)に残る", (prefs || "").includes('"allowBinaryLoss":true'), prefs);

  // G3: 設定が開いている間は、裏の画面で ⌘S が保存を起こさない。Esc は設定だけを閉じ、画面は残る
  await openFresh("d4binary");
  await openSheet();
  await openSettings();
  await setSettingsCheck(true);
  const beforeKeys = await postCount();
  await pressKey({ key: "s", metaKey: true, bubbles: true });
  await sleep(400);
  check("D4 設定が開いている間は ⌘S で保存されない", (await postCount()) === beforeKeys, await postCount());
  await pressKey({ key: "Escape", bubbles: true });
  await sleep(150);
  check("D4 Esc は設定だけを閉じ、オーバーレイは開いたまま",
    (await settingsOpen()) === false && (await overlayVisible()) === true,
    { open: await settingsOpen(), visible: await overlayVisible() });

  // G4: 許可のあとに、他所で手書きが1件増えたら送らない(件数は 2→3。判定は画像の id で行う)
  await openFresh("d4binary");
  await openSheet();
  await openSettings();
  await setSettingsCheck(true);
  await closeSettingsByButton();
  await ev(`window.__esServerAddImage(3, 9001), true`);
  const beforeGrow = await postCount();
  await clickSave();
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("保存に失敗")`);
  check("D4 許可のあとに手書きが増えていたら送らず、理由に手書きと書く",
    (await postCount()) === beforeGrow && (await errorText()).includes("手書き"),
    { posts: await postCount(), beforeGrow, err: await errorText() });

  // G5: 件数が同じまま、canvas の筆跡の中身だけが他所で変わったら送らない(件数だけの比較では取りこぼす)
  await openFresh("d4binary");
  await openSheet();
  await openSettings();
  await setSettingsCheck(true);
  await closeSettingsByButton();
  await ev(`window.__esServerSetCanvas(2, "data:image/png;base64,BBBB"), true`);
  const beforeCanvas = await postCount();
  await clickSave();
  await until(`(${sel(".es-save-status")}?.textContent || "").includes("保存に失敗")`);
  check("D4 許可のあとに canvas の筆跡が他所で変わっていたら、件数が同じでも送らない",
    (await postCount()) === beforeCanvas && (await errorText()).includes("手書き"),
    { posts: await postCount(), beforeCanvas, err: await errorText() });

  // G6: 許可が端末に残っていれば、開いた時点から保存でき、設定をオフにするとその場で無効に戻る
  await openFresh("d4binaryOn");
  await openSheet();
  check("D4 端末に許可が残っていれば、開いた時点から保存できる",
    (await saveDisabled()) === false && !(await statusNow()).includes(LOCK_TEXT), { disabled: await saveDisabled(), status: await statusNow() });
  await openSettings();
  check("D4 設定を開くと、残っている許可がチェックに出る", (await settingsChecked()) === true, await settingsChecked());
  await setSettingsCheck(false);
  check("D4 設定をオフにすると、開いている画面の保存ボタンがその場で無効に戻る",
    (await saveDisabled()) === true, await saveDisabled());
  await closeSettingsByButton();

  // G7: 一覧の要約も設定に合わせる。許可の前は「保存不可」、許可したあと一覧に戻ると「保存不可」は出ない
  await openFresh("d4binary");
  await openSheet();
  await ev(`${sel(".es-header-back")}.click(), true`);
  await until(`!!${sel(".es-list-item")}`);
  await sleep(300);
  const lockedRow = await ev(`${sel(".es-list-item")}?.textContent ?? ""`);
  check("D4 許可の前は、一覧の回が「手書きあり・保存不可」と出る", lockedRow.includes("保存不可"), lockedRow);
  await openSheet();
  await openSettings();
  await setSettingsCheck(true);
  await closeSettingsByButton();
  await ev(`${sel(".es-header-back")}.click(), true`);
  await until(`!!${sel(".es-list-item")}`);
  await sleep(300);
  const allowedRow = await ev(`${sel(".es-list-item")}?.textContent ?? ""`);
  check("D4 許可したあと一覧に戻ると、同じ回は「保存不可」と出ない", !allowedRow.includes("保存不可"), allowedRow);
}
