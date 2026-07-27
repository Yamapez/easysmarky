import { fetchDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery } from "../api/types";
import { createEditableField, type EditableField } from "../model/field";
import { checkSaveGuard } from "../model/toParam";
import { saveDraft } from "../save/save";
import {
  clearBackup,
  debounce,
  loadBackup,
  saveBackup,
  saveSheetSummary,
  type SheetBackup,
} from "../storage/backup";
import { createFieldEditor, fieldLabel, fieldShortLabel, type FieldEditorHandle } from "./fieldEditor";
import type { HeaderHandle } from "./overlay";
import { createPageViewer, pageArrayIndex, type RimFieldInfo } from "./pageViewer";
import { createQuestionStrip, type StripItem } from "./questionStrip";
import type { SelectedSheet } from "./sheetPicker";

export interface FormViewOptions {
  sheet: SelectedSheet;
  header: HeaderHandle;
  onBack: () => void;
}

/** ビューアと入力を横に並べる幅。styles.ts の @media (min-width: 900px) と一致させること */
const TWO_PANE_MIN_WIDTH = 900;

function isFilledField(field: EditableField): boolean {
  return field.isEditableText && !field.hasExtraStamps && field.text.trim() !== "";
}

/** easysmarkyで入力できる設問か(進捗の分母になる) */
function isEditable(field: EditableField): boolean {
  return field.isEditableText && !field.hasExtraStamps;
}

function formatTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(at)}`;
}

function formatDeadline(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `締切 ${d.getMonth() + 1}/${d.getDate()}`;
}

export async function renderFormView(container: HTMLElement, opts: FormViewOptions): Promise<void> {
  container.innerHTML = '<div class="es-loading">読み込み中...</div>';

  const { sheet } = opts;
  const query: DigitalReportQuery = {
    subject_code: sheet.subjectCode,
    nendo: sheet.nendo,
    report_no: sheet.reportNo,
    student_code: sheet.studentCode,
    is_preview_mode: false,
    times: sheet.times,
  };

  const report = await fetchDigitalReport(query);
  const cutMargin = report.cut_margin;
  const answerImages = report.base64_answer_images ?? [];
  const questionImages = report.base64_question_images ?? [];

  const fields: EditableField[] = (report.base_sheet_fields ?? [])
    .slice()
    .sort((a, b) => a.page - b.page || a.id - b.id)
    .map(createEditableField);
  const guard = checkSaveGuard(fields);

  const fieldById = new Map(fields.map((f) => [f.raw.id, f]));
  const editableCount = fields.filter(isEditable).length;

  container.innerHTML = "";

  // ---------------------------------------------------------------- ヘッダ
  opts.header.setBack(opts.onBack, "← 科目一覧");
  opts.header.setTitle(
    `${sheet.subjectName || report.subject_name} ／ 第${sheet.reportNo}回`,
    formatDeadline(sheet.stdDeadlineAt),
  );

  const progressWrap = document.createElement("div");
  progressWrap.className = "es-progress";
  const progressCount = document.createElement("span");
  progressCount.className = "es-progress-count";
  const progressBar = document.createElement("div");
  progressBar.className = "es-progress-bar";
  const progressFill = document.createElement("div");
  progressFill.className = "es-progress-fill";
  progressBar.appendChild(progressFill);
  const autosaveEl = document.createElement("span");
  autosaveEl.className = "es-autosave";
  progressWrap.appendChild(progressCount);
  progressWrap.appendChild(progressBar);
  progressWrap.appendChild(autosaveEl);
  opts.header.setStatus(progressWrap);

  // ---------------------------------------------------------------- 骨組み
  const form = document.createElement("div");
  form.className = "es-form";
  form.dataset.mode = "view";
  container.appendChild(form);

  const notices = document.createElement("div");
  notices.className = "es-notices";
  form.appendChild(notices);

  const work = document.createElement("div");
  work.className = "es-work";
  form.appendChild(work);

  const questionPane = document.createElement("div");
  questionPane.className = "es-pane-question";
  work.appendChild(questionPane);

  const formPane = document.createElement("div");
  formPane.className = "es-pane-form";
  work.appendChild(formPane);

  // --- 設問ヘッダ ---
  const editorHead = document.createElement("div");
  editorHead.className = "es-editor-head";
  const backToViewBtn = document.createElement("button");
  backToViewBtn.type = "button";
  backToViewBtn.className = "es-editor-back";
  backToViewBtn.textContent = "← 問題に戻る";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "es-editor-nav pc-only";
  prevBtn.textContent = "◀";
  prevBtn.setAttribute("aria-label", "前の設問");
  const titleWrap = document.createElement("div");
  titleWrap.className = "es-editor-title";
  const nameEl = document.createElement("div");
  nameEl.className = "es-editor-name";
  const metaEl = document.createElement("div");
  metaEl.className = "es-editor-meta";
  titleWrap.appendChild(nameEl);
  titleWrap.appendChild(metaEl);
  const nextFieldBtn = document.createElement("button");
  nextFieldBtn.type = "button";
  nextFieldBtn.className = "es-editor-nav primary pc-only";
  nextFieldBtn.textContent = "▶";
  nextFieldBtn.setAttribute("aria-label", "次の設問");
  editorHead.appendChild(backToViewBtn);
  editorHead.appendChild(prevBtn);
  editorHead.appendChild(titleWrap);
  editorHead.appendChild(nextFieldBtn);
  formPane.appendChild(editorHead);

  const editorBody = document.createElement("div");
  editorBody.className = "es-editor-body";
  formPane.appendChild(editorBody);

  // --- 保存バー ---
  const saveBar = document.createElement("div");
  saveBar.className = "es-savebar";
  const saveRow = document.createElement("div");
  saveRow.className = "es-savebar-row";
  const mobilePrevBtn = document.createElement("button");
  mobilePrevBtn.type = "button";
  mobilePrevBtn.className = "es-editor-nav";
  mobilePrevBtn.textContent = "◀";
  mobilePrevBtn.setAttribute("aria-label", "前の設問");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "es-save-btn";
  saveBtn.textContent = "下書き保存";
  const nextEmptyBtn = document.createElement("button");
  nextEmptyBtn.type = "button";
  nextEmptyBtn.className = "es-next-btn";
  nextEmptyBtn.textContent = "次の未入力へ";
  const mobileNextBtn = document.createElement("button");
  mobileNextBtn.type = "button";
  mobileNextBtn.className = "es-editor-nav primary";
  mobileNextBtn.textContent = "▶";
  mobileNextBtn.setAttribute("aria-label", "次の設問");
  saveRow.appendChild(mobilePrevBtn);
  saveRow.appendChild(saveBtn);
  saveRow.appendChild(nextEmptyBtn);
  saveRow.appendChild(mobileNextBtn);
  saveBar.appendChild(saveRow);
  const statusEl = document.createElement("div");
  statusEl.className = "es-save-status";
  saveBar.appendChild(statusEl);
  const saveNote = document.createElement("div");
  saveNote.className = "es-save-note";
  saveNote.textContent = "提出は公式のSmarky画面から行ってください。";
  saveBar.appendChild(saveNote);
  formPane.appendChild(saveBar);

  // ---------------------------------------------------------------- ビューア
  const rimFields: RimFieldInfo[] = fields.map((f) => ({
    id: f.raw.id,
    page: f.raw.page,
    rim: f.raw.rim,
    // 枠やチップは狭いので配点は出さない(配点は設問ヘッダに出る)
    label: fieldShortLabel(f),
    locked: !isEditable(f),
  }));

  const viewer = createPageViewer({
    questionImages,
    answerImages,
    rims: {
      fields: rimFields,
      sheetWidth: report.base_sheet?.width ?? 0,
      sheetHeight: report.base_sheet?.height ?? 0,
      isFilled: (id) => {
        const f = fieldById.get(id);
        return !!f && isFilledField(f);
      },
      onSelect: (id) => focusField(id, { openEditor: true }),
    },
  });
  questionPane.appendChild(viewer.element);

  // ---------------------------------------------------------------- ストリップ
  const stripItems: StripItem[] = rimFields.map((f) => ({
    id: f.id,
    page: f.page,
    label: f.label,
    locked: f.locked,
  }));
  const strip = createQuestionStrip({
    items: stripItems,
    isFilled: (id) => {
      const f = fieldById.get(id);
      return !!f && isFilledField(f);
    },
    onSelect: (id) => focusField(id, { openEditor: true }),
  });
  form.appendChild(strip.element);

  // ---------------------------------------------------------------- スマホ下部バー
  const mobileBar = document.createElement("div");
  mobileBar.className = "es-mobile-bar";
  const mobileInfo = document.createElement("div");
  mobileInfo.className = "es-mobile-bar-info";
  const mobileTitle = document.createElement("div");
  mobileTitle.className = "es-mobile-bar-title";
  const mobileSub = document.createElement("div");
  mobileSub.className = "es-mobile-bar-sub";
  mobileInfo.appendChild(mobileTitle);
  mobileInfo.appendChild(mobileSub);
  const mobileSaveBtn = document.createElement("button");
  mobileSaveBtn.type = "button";
  mobileSaveBtn.className = "es-save-btn";
  mobileSaveBtn.textContent = "下書き保存";
  const mobileNextEmptyBtn = document.createElement("button");
  mobileNextEmptyBtn.type = "button";
  mobileNextEmptyBtn.className = "es-next-btn";
  mobileNextEmptyBtn.textContent = "次の未入力へ";
  mobileBar.appendChild(mobileInfo);
  mobileBar.appendChild(mobileSaveBtn);
  mobileBar.appendChild(mobileNextEmptyBtn);
  form.appendChild(mobileBar);

  // ---------------------------------------------------------------- 下書きの保存
  let lastSavedAt: number | null = null;

  function collectBackup(): SheetBackup {
    const backup: SheetBackup = {};
    for (const f of fields) {
      if (!isEditable(f)) continue;
      backup[f.raw.id] = {
        text: f.text,
        direction: f.direction,
        fontSize: f.fontSize,
        lineHeight: f.lineHeight,
        color: f.color,
      };
    }
    return backup;
  }

  function persistSummary(savedAt: number): void {
    saveSheetSummary(sheet.studentCode, sheet.baseSheetId, sheet.times, {
      total: editableCount,
      filled: fields.filter(isFilledField).length,
      blocked: guard.blocked,
      savedAt,
    });
  }

  const persistBackup = debounce(() => {
    const at = Date.now();
    saveBackup(sheet.studentCode, sheet.baseSheetId, sheet.times, collectBackup(), at);
    persistSummary(at);
    lastSavedAt = at;
    refreshStatusText();
  }, 500);

  // 開いただけでも一覧に進捗が出るよう、初回は即座に要約を残す
  persistSummary(Date.now());

  // ---------------------------------------------------------------- 表示の更新
  function refreshProgress(): void {
    const filled = fields.filter(isFilledField).length;
    progressCount.textContent = `入力済み ${filled}/${editableCount}`;
    progressFill.style.width = editableCount > 0 ? `${(filled / editableCount) * 100}%` : "0";
    progressFill.classList.toggle("done", editableCount > 0 && filled >= editableCount);

    const remaining = editableCount - filled;
    mobileTitle.textContent = remaining > 0 ? `残り ${remaining} 設問` : "すべて入力済みです";
    const noEmpty = nextEmptyId() === null;
    nextEmptyBtn.disabled = noEmpty;
    mobileNextEmptyBtn.disabled = noEmpty;
  }

  function refreshStatusText(): void {
    const text = lastSavedAt ? `この端末に自動保存 ${formatTime(lastSavedAt)}` : "";
    autosaveEl.textContent = text;
    mobileSub.textContent = text;
  }

  function refreshFieldMeta(): void {
    const field = focusId != null ? fieldById.get(focusId) : undefined;
    if (!field) {
      nameEl.textContent = "";
      metaEl.textContent = "";
      return;
    }
    const position = fields.findIndex((f) => f.raw.id === field.raw.id) + 1;
    nameEl.textContent = fieldLabel(field);
    metaEl.textContent = `設問 ${position} / ${fields.length} ・ ${field.raw.page}ページ`;
    const first = position <= 1;
    const last = position >= fields.length;
    prevBtn.disabled = first;
    mobilePrevBtn.disabled = first;
    nextFieldBtn.disabled = last;
    mobileNextBtn.disabled = last;
  }

  // ---------------------------------------------------------------- 設問の切替
  let focusId: number | null = null;
  let editor: FieldEditorHandle | null = null;

  function nextEmptyId(): number | null {
    const start = focusId != null ? fields.findIndex((f) => f.raw.id === focusId) : -1;
    for (let i = 1; i <= fields.length; i++) {
      const field = fields[(start + i + fields.length) % fields.length];
      if (isEditable(field) && !isFilledField(field)) return field.raw.id;
    }
    return null;
  }

  function renderEditor(): void {
    editor?.destroy();
    editorBody.innerHTML = "";
    const field = focusId != null ? fieldById.get(focusId) : undefined;
    if (!field) return;
    editor = createFieldEditor({
      field,
      pageImage: answerImages[pageArrayIndex(answerImages, field.raw.page)] ?? null,
      questionPageImage: questionImages[pageArrayIndex(questionImages, field.raw.page)] ?? null,
      cutMargin,
      onChange: (changed) => {
        // エディタは複製を編集するので、変更を元の配列へ書き戻す
        const index = fields.findIndex((f) => f.raw.id === changed.raw.id);
        if (index >= 0) {
          fields[index] = changed;
          fieldById.set(changed.raw.id, changed);
        }
        refreshProgress();
        strip.refresh();
        viewer.refreshRims();
        persistBackup();
      },
      onShowPage: (page) => {
        viewer.goTo(viewer.currentSource(), pageArrayIndex(
          viewer.currentSource() === "question" ? questionImages : answerImages,
          page,
        ));
        setMode("view");
      },
    });
    editorBody.appendChild(editor.element);
  }

  interface FocusOptions {
    /** スマホで入力画面へ切り替えるか(枠タップ・ストリップ・次の未入力へ) */
    openEditor?: boolean;
    focusText?: boolean;
  }

  function focusField(id: number, options: FocusOptions = {}): void {
    if (!fieldById.has(id)) return;
    focusId = id;
    renderEditor();
    refreshFieldMeta();
    strip.setActive(id);
    viewer.showField(id);
    if (options.openEditor) setMode("edit");
    // スマホでは自分から入力に入ったときだけフォーカスする(勝手にキーボードを出さない)
    if (options.focusText !== false && (options.openEditor || window.innerWidth >= TWO_PANE_MIN_WIDTH)) {
      editor?.focus();
    }
  }

  function stepField(delta: number): void {
    if (fields.length === 0) return;
    const current = focusId != null ? fields.findIndex((f) => f.raw.id === focusId) : -1;
    const next = Math.min(Math.max(current + delta, 0), fields.length - 1);
    focusField(fields[next].raw.id, { openEditor: form.dataset.mode === "edit" });
  }

  function setMode(mode: "view" | "edit"): void {
    form.dataset.mode = mode;
  }

  // ---------------------------------------------------------------- お知らせ欄
  if (guard.blocked) {
    const warn = document.createElement("div");
    warn.className = "es-warning";
    warn.textContent = guard.reason ?? "";
    notices.appendChild(warn);
  }

  const existingBackup = loadBackup(sheet.studentCode, sheet.baseSheetId, sheet.times);
  if (existingBackup) {
    const restoreBar = document.createElement("div");
    restoreBar.className = "es-warning";
    const message = document.createElement("div");
    message.textContent = existingBackup.savedAt
      ? `この端末に、${formatDateTime(existingBackup.savedAt)} に入力した下書きが残っています。`
      : "この端末に保存された下書きが残っています。";
    restoreBar.appendChild(message);
    const actions = document.createElement("div");
    actions.className = "es-warning-actions";
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.textContent = "復元する";
    const discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.className = "secondary";
    discardBtn.textContent = "破棄する";
    actions.appendChild(restoreBtn);
    actions.appendChild(discardBtn);
    restoreBar.appendChild(actions);
    restoreBtn.addEventListener("click", () => {
      for (const field of fields) {
        const entry = existingBackup.fields[field.raw.id];
        if (!entry) continue;
        field.text = entry.text;
        field.direction = entry.direction;
        field.fontSize = entry.fontSize;
        field.lineHeight = entry.lineHeight;
        field.color = entry.color;
      }
      restoreBar.remove();
      renderEditor();
      refreshProgress();
      strip.refresh();
      viewer.refreshRims();
    });
    discardBtn.addEventListener("click", () => {
      clearBackup(sheet.studentCode, sheet.baseSheetId, sheet.times);
      restoreBar.remove();
    });
    notices.appendChild(restoreBar);
  }

  // ---------------------------------------------------------------- 保存
  let saveNotice: HTMLElement | null = null;

  function setSaveStatus(text: string, color: string): void {
    statusEl.textContent = text;
    statusEl.style.color = color;
  }

  function showSaveNotice(message: string, mismatchedIds: number[]): void {
    saveNotice?.remove();
    const card = document.createElement("div");
    card.className = "es-error";
    card.style.marginBottom = "0";
    const text = document.createElement("div");
    text.textContent = message;
    card.appendChild(text);
    const actions = document.createElement("div");
    actions.className = "es-save-actions";
    actions.style.marginTop = "10px";
    if (mismatchedIds.length > 0) {
      const jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.textContent = "該当の設問を見る";
      jumpBtn.addEventListener("click", () => focusField(mismatchedIds[0], { openEditor: true }));
      actions.appendChild(jumpBtn);
    }
    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "secondary";
    retryBtn.textContent = "もう一度保存";
    retryBtn.addEventListener("click", () => void runSave());
    actions.appendChild(retryBtn);
    card.appendChild(actions);
    notices.appendChild(card);
    saveNotice = card;
  }

  let saving = false;

  async function runSave(): Promise<void> {
    if (saving || guard.blocked) return;
    saving = true;
    saveBtn.disabled = true;
    mobileSaveBtn.disabled = true;
    saveNotice?.remove();
    saveNotice = null;
    setSaveStatus("保存中...", "#7a848a");
    try {
      const result = await saveDraft({
        fields,
        cutMargin,
        baseSheetId: sheet.baseSheetId,
        studentCode: sheet.studentCode,
        times: sheet.times,
        verifyQuery: query,
      });
      if (!result.ok) {
        const message = result.blockedReason ?? (result.errors ?? ["保存に失敗しました。"]).join("\n");
        setSaveStatus("保存に失敗しました。", "#a02622");
        showSaveNotice(message, []);
      } else if (result.mismatchedFieldIds && result.mismatchedFieldIds.length > 0) {
        const message = `保存はされましたが、一部の設問(${result.mismatchedFieldIds.length}件)の反映が確認できませんでした。公式画面で内容をご確認ください。`;
        setSaveStatus(message, "#a02622");
        showSaveNotice(message, result.mismatchedFieldIds);
      } else {
        setSaveStatus("保存済み(サーバーで反映を確認しました)。", "#2e7d32");
      }
    } catch {
      const message = "予期せぬエラーが発生しました。通信状況をご確認のうえ再度お試しください。";
      setSaveStatus(message, "#a02622");
      showSaveNotice(message, []);
    } finally {
      saving = false;
      saveBtn.disabled = guard.blocked;
      mobileSaveBtn.disabled = guard.blocked;
    }
  }

  saveBtn.disabled = guard.blocked;
  mobileSaveBtn.disabled = guard.blocked;
  saveBtn.addEventListener("click", () => void runSave());
  mobileSaveBtn.addEventListener("click", () => void runSave());

  // ---------------------------------------------------------------- 操作
  backToViewBtn.addEventListener("click", () => setMode("view"));
  prevBtn.addEventListener("click", () => stepField(-1));
  nextFieldBtn.addEventListener("click", () => stepField(1));
  mobilePrevBtn.addEventListener("click", () => stepField(-1));
  mobileNextBtn.addEventListener("click", () => stepField(1));

  function goToNextEmpty(): void {
    const id = nextEmptyId();
    if (id != null) focusField(id, { openEditor: true });
  }
  nextEmptyBtn.addEventListener("click", goToNextEmpty);
  mobileNextEmptyBtn.addEventListener("click", goToNextEmpty);

  // ショートカットはオーバーレイ全体で効かせたいので window で受ける。
  // 一覧に戻る(form が捨てられる)か、オーバーレイが閉じられたら自分で外れる。
  function onKeyDown(event: KeyboardEvent): void {
    if (!form.isConnected) {
      window.removeEventListener("keydown", onKeyDown, true);
      return;
    }
    if (form.getClientRects().length === 0) return; // オーバーレイ非表示中
    if (event.ctrlKey || event.metaKey) {
      if (event.key === "Enter") {
        event.preventDefault();
        stepField(1);
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void runSave();
      }
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      viewer.step(event.key === "ArrowUp" ? -1 : 1);
    }
  }
  window.addEventListener("keydown", onKeyDown, true);

  // ---------------------------------------------------------------- 初期表示
  const firstEditable = fields.find(isEditable) ?? fields[0];
  if (firstEditable) {
    // スマホは問題ページから始める(問題文が見えないまま解答を求めない)ので、
    // ここでは入力画面へは切り替えない。
    focusField(firstEditable.raw.id, { openEditor: false, focusText: false });
  }
  refreshProgress();
  refreshStatusText();
}
