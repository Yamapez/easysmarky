import { fetchDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery } from "../api/types";
import { createEditableField, isEditableField, type EditableField } from "../model/field";
import { layoutAnswerText } from "../render/answerLayout";
import { answerPageSize, answerPageSizeByIndex, questionPageSize } from "../model/sheetGeometry";
import { checkSaveGuard } from "../model/toParam";
import { saveDraft } from "../save/save";
import {
  archiveBackupOnce,
  clearArchive,
  clearBackup,
  debounce,
  loadBackup,
  saveBackup,
  saveSheetSummary,
  type LoadedBackup,
  type SheetBackup,
} from "../storage/backup";
import { saveLastSheet } from "../storage/listState";
import { createFieldEditor, fieldLabel, fieldShortLabel, type FieldEditorHandle } from "./fieldEditor";
import type { HeaderHandle } from "./overlay";
import { readingWindowRect } from "../model/readingWindow";
import {
  createPageViewer,
  pageArrayIndex,
  type PageSource,
  type PageViewerHandle,
  ZOOM_STEPS,
  type RimFieldInfo,
} from "./pageViewer";
import { createQuestionStrip, type StripItem } from "./questionStrip";
import type { SelectedSheet } from "./sheetPicker";

export interface FormViewOptions {
  sheet: SelectedSheet;
  header: HeaderHandle;
  onBack: () => void;
}

function isFilledField(field: EditableField): boolean {
  return isEditableField(field) && field.text.trim() !== "";
}

/** easysmarkyで入力できる設問か(進捗の分母になる) */
function isEditable(field: EditableField): boolean {
  return isEditableField(field);
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
  container.innerHTML = '<div class="es-loading" role="status">読み込み中...</div>';

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
  // 報告を開けたら「続きから」用に残す(一覧の先頭に出す)
  saveLastSheet(sheet.studentCode, sheet);
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
  // 未保存の変更があるか。サーバーに反映されたことを確認できるまでは true のまま
  let dirty = false;
  // 編集のたびに増やす。保存の送信中に編集が入ったかを見分けるために使う
  let editSeq = 0;
  // サーバーでの反映を照合できた最後の時刻
  let serverSavedAt: number | null = null;

  opts.header.setBack(opts.onBack, "← 科目一覧");
  opts.header.setLeaveGuard(() => {
    if (!dirty) return true;
    // 自動保存に失敗しているときは「この端末に残っている」とは言わない(言うと、離れても失われないと誤解させる)
    let message = "保存されていない変更があります。\nこの端末には自動保存されていますが、Smarkyにはまだ反映されていません。\nこの画面を離れますか?";
    if (backupFailed) {
      message = "保存されていない変更があります。\nこの端末への自動保存にも失敗しているため、離れると入力内容が失われるおそれがあります。\nSmarkyにはまだ反映されていません。\nこの画面を離れますか?";
    }
    return window.confirm(message);
  });
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

  const toast = document.createElement("div");
  toast.className = "es-toast";
  toast.setAttribute("aria-live", "polite");
  work.appendChild(toast);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function announce(text: string): void {
    if (toastTimer != null) clearTimeout(toastTimer);
    toast.textContent = text;
    toast.classList.add("show");
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
  }

  const questionPane = document.createElement("div");
  questionPane.className = "es-pane-question";
  work.appendChild(questionPane);

  const formPane = document.createElement("div");
  formPane.className = "es-pane-form";
  work.appendChild(formPane);

  // --- 設問ヘッダ ---
  const editorHead = document.createElement("div");
  editorHead.className = "es-editor-head";
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
  statusEl.setAttribute("aria-live", "polite");
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
      pageSize: (index) => answerPageSizeByIndex(report.base_sheet, index),
      isFilled: (id) => {
        const f = fieldById.get(id);
        return !!f && isFilledField(f);
      },
      // 入力した文字を枠の上に出す。解答欄プレビューと同じ描画・同じ中央配置(再開した下書きの既存位置は別。answerLayout.ts 参照)
      text: (id) => {
        const f = fieldById.get(id);
        return f && isEditable(f) ? layoutAnswerText(f, cutMargin) : null;
      },
      onSelect: (id) => focusField(id, { focusInput: true }),
    },
    onOpenReader: () => openReader(),
    // 手動で選んだ倍率を端末に記憶し、次回の初期値にする(自動ズームの下限にもなる)
    zoomMemory: true,
  });
  questionPane.appendChild(viewer.element);

  // ---------------------------------------------------------------- 読むモード
  // 問題文は解答用紙の画像に印字されていることがある(国語など)。上のペインは小さく本文が読めないので、
  // いま表示している種別(問題・解答用紙)のページを枠なしで全画面に開く。
  // 閉じても上のビューアの表示位置・ズームは変わらない。
  let reader: HTMLElement | null = null;
  /** 読むモードを開いたボタン。閉じたあとにフォーカスを戻す */
  let readerOpener: HTMLElement | null = null;
  const READ_TARGET_WIDTH = 1100;

  function closeReader(): void {
    reader?.remove();
    reader = null;
    window.removeEventListener("keydown", onReaderKeyDown, true);
    readerOpener?.focus();
    readerOpener = null;
  }

  function onReaderKeyDown(event: KeyboardEvent): void {
    if (!reader || !reader.isConnected) {
      window.removeEventListener("keydown", onReaderKeyDown, true);
      return;
    }
    if (event.key !== "Escape") return;
    // IME確定のキャンセルでも Escape が飛んでくるブラウザがあるため無視する
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    closeReader();
  }

  function openReader(): void {
    if (reader) return;
    // 画面幅に応じて、本文が読める幅(約1100px)になる最小の倍率から始める(全体表示のとき)
    const fullZoom =
      ZOOM_STEPS.find((s) => window.innerWidth * s >= READ_TARGET_WIDTH) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    const current = focusId != null ? fieldById.get(focusId) : undefined;
    // 窓表示: 選んでいる設問の解答欄の右側(縦書きの問題文)まわりだけを見せる。
    // その設問のある解答用紙ページにだけ効き、ほかのページは全体を出す
    const cropTo = current
      ? (source: PageSource, index: number) => {
          if (source !== "answer") return null;
          if (pageArrayIndex(answerImages, current.raw.page) !== index) return null;
          const sheet = answerPageSizeByIndex(report.base_sheet, index);
          if (!sheet) return null;
          const rect = readingWindowRect(current.raw.rim, sheet);
          // 用紙の外にあって空になる窓は出さない(表示側の判定と食い違わないよう、ここで決める)
          if (rect.width <= 0 || rect.height <= 0) return null;
          return { rect, sheet };
        }
      : undefined;

    const el = document.createElement("div");
    el.className = "es-reader";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "ページの全画面表示");
    const head = document.createElement("div");
    head.className = "es-reader-head";

    // 今いるページから読み始める(解答用紙を見ていて、設問がそのページにあるとき)
    let pos: { source: PageSource; index: number } = { source: viewer.currentSource(), index: viewer.currentIndex() };
    let cropOn = cropTo != null;
    let readerViewer: PageViewerHandle | null = null;

    /**
     * 表示を組み直す。窓表示は設問の周りだけを画面幅に収めて出し、全体表示は開いた時点と同じ
     * 倍率・位置(設問の解答欄が見える位置)に戻す。どちらも同じ経路で作るので、切り替えても挙動がずれない。
     */
    function mountViewer(): void {
      const windowApplies = cropOn && cropTo != null && cropTo(pos.source, pos.index) != null;
      const sheetAt = pos.source === "answer" ? answerPageSizeByIndex(report.base_sheet, pos.index) : null;
      let focus: { x: number; y: number } | undefined;
      if (!windowApplies && current && sheetAt && pageArrayIndex(answerImages, current.raw.page) === pos.index) {
        const [x, y, w] = current.raw.rim;
        focus = { x: (x + w / 2) / sheetAt.width, y: y / sheetAt.height };
      }
      const next = createPageViewer({
        questionImages,
        answerImages,
        // 窓は設問の周りだけなので、画面に収まる倍率(1)から始める。全体表示は読める幅の倍率
        initialZoom: windowApplies ? 1 : fullZoom,
        initialSource: pos.source,
        initialIndex: pos.index,
        focus,
        cropTo,
        cropOn,
        onRender: syncToggle,
      });
      if (readerViewer) {
        readerViewer.element.replaceWith(next.element);
      } else {
        el.appendChild(next.element);
      }
      readerViewer = next;
    }

    let toggle: HTMLButtonElement | null = null;
    /** 押下中 = いま窓が見えている(設問のないページでは窓が出ないので押下にならない) */
    function syncToggle(state: { source: PageSource; index: number }): void {
      if (!toggle || !cropTo) return;
      const showing = cropOn && cropTo(state.source, state.index) != null;
      toggle.setAttribute("aria-pressed", String(showing));
    }
    if (cropTo) {
      // 押すと、選んでいる設問まわりだけ/ページ全体、を切り替える
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "es-reader-toggle";
      toggle.textContent = "設問まわり";
      toggle.addEventListener("click", () => {
        if (readerViewer) pos = { source: readerViewer.currentSource(), index: readerViewer.currentIndex() };
        cropOn = !cropOn;
        mountViewer();
      });
      head.appendChild(toggle);
    }
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "閉じる";
    closeBtn.setAttribute("aria-label", "読むモードを閉じる");
    closeBtn.addEventListener("click", closeReader);
    head.appendChild(closeBtn);
    el.appendChild(head);
    mountViewer();

    // 開いた側のボタンを覚えておき、閉じたら戻す。開いた直後は閉じるボタンへ移す
    readerOpener = (form.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    form.appendChild(el);
    closeBtn.focus();

    reader = el;
    window.addEventListener("keydown", onReaderKeyDown, true);
  }

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
    onSelect: (id) => focusField(id, { focusInput: true }),
  });
  form.appendChild(strip.element);


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

  /** この端末に自動保存できていないか。true の間は警告を出し、離脱の確認もそう言う */
  let backupFailed = false;
  /** 復元の提示が出ていて、古い下書きがまだ退避されていない間 true。最初の入力で退避してから自動保存する */
  let offerPending = false;

  function persistSummary(savedAt: number): boolean {
    return saveSheetSummary(sheet.studentCode, sheet.baseSheetId, sheet.times, {
      total: editableCount,
      filled: fields.filter(isFilledField).length,
      blocked: guard.blocked,
      savedAt,
    });
  }

  /** 今の入力をこの端末に書く。すぐ書きたいとき(破棄の直後など)はこれを直接呼ぶ */
  function persistNow(): void {
    const at = Date.now();
    if (offerPending) {
      // 古い下書きは、上書きする前に退避する。退避できなければ、今の入力では上書きしない(要約だけ更新)
      if (!archiveBackupOnce(sheet.studentCode, sheet.baseSheetId, sheet.times)) {
        persistSummary(at);
        refreshStatusText();
        return;
      }
      offerPending = false;
      if (offerNoteEl) {
        offerNoteEl.textContent = "入力を始めたため、古い下書きは退避しました。この画面を開いている間は「復元する」で戻せます。";
      }
    }
    const ok = saveBackup(sheet.studentCode, sheet.baseSheetId, sheet.times, collectBackup(), at);
    persistSummary(at);
    backupFailed = !ok;
    // 書けたときだけ時刻を進める。失敗した時刻を「自動保存 hh:mm」と出すと、残っていると誤解させる
    if (ok) lastSavedAt = at;
    refreshStatusText();
  }

  const persistBackup = debounce(persistNow, 500);

  // 開いただけでも一覧に進捗が出るよう、初回は即座に要約を残す。
  // 下書きはここでは書かない(既存の下書きを、復元するか決める前に空の値で上書きしてしまうため)。
  // 代わりに要約が書けるかで、この端末に書き込めるかを確かめる。
  backupFailed = !persistSummary(Date.now());

  // ---------------------------------------------------------------- 表示の更新
  function refreshProgress(): void {
    const filled = fields.filter(isFilledField).length;
    progressCount.textContent = `入力済み ${filled}/${editableCount}`;
    progressFill.style.width = editableCount > 0 ? `${(filled / editableCount) * 100}%` : "0";
    const allFilled = editableCount > 0 && filled >= editableCount;
    progressFill.classList.toggle("done", allFilled);
    // 全部入れ終わったら、次にやること(保存して、提出は公式画面で)を案内する
    saveNote.textContent = allFilled
      ? "全設問の入力が済みました。下書き保存したら、提出は公式のSmarky画面から行ってください。"
      : "提出は公式のSmarky画面から行ってください。";

    const noEmpty = nextEmptyId() === null;
    nextEmptyBtn.disabled = noEmpty;
  }

  /** 編集が入ったことを記録する。保存バーの表示は保存中でなければ直ちに更新する */
  function markDirty(): void {
    editSeq++;
    dirty = true;
    // 復元のあとに編集が入ったら「元に戻す」は無効にする。戻すと、今打った分が黙って消えるため
    if (undoSeq !== null && undoSeq !== editSeq) removeRestoreBar();
    if (!saving) refreshSaveState();
  }

  /** 保存バーの状態表示。未保存の変更の有無と、最後にサーバーで確認できた時刻から決める */
  function refreshSaveState(): void {
    if (dirty) {
      setSaveStatus("未保存の変更があります。下書き保存してください。", "#8a5a00");
    } else if (serverSavedAt != null) {
      setSaveStatus(`保存済み ${formatTime(serverSavedAt)}(サーバーで反映を確認しました)`, "#2e7d32");
    } else {
      setSaveStatus("", "");
    }
  }

  /** 自動保存の失敗を、幅によらず見える場所に出す。ヘッダの文字は狭い画面では隠れるため(styles.ts) */
  let autosaveWarnEl: HTMLElement | null = null;
  function refreshAutosaveWarning(): void {
    if (backupFailed && !autosaveWarnEl) {
      const bar = document.createElement("div");
      bar.className = "es-warning";
      bar.textContent =
        "この端末に自動保存できていません(容量・設定を確認してください)。画面を閉じる前に、下書き保存してください。";
      notices.insertBefore(bar, notices.firstChild);
      autosaveWarnEl = bar;
    } else if (!backupFailed && autosaveWarnEl) {
      autosaveWarnEl.remove();
      autosaveWarnEl = null;
    }
  }

  function refreshStatusText(): void {
    refreshAutosaveWarning();
    if (backupFailed) {
      autosaveEl.textContent = "この端末に自動保存できません(容量・設定を確認)";
      autosaveEl.classList.add("failed");
      return;
    }
    autosaveEl.classList.remove("failed");
    autosaveEl.textContent = lastSavedAt ? `この端末に自動保存 ${formatTime(lastSavedAt)}` : "";
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
    const first = findStepTarget(-1) == null;
    const last = findStepTarget(1) == null;
    prevBtn.disabled = first;
    mobilePrevBtn.disabled = first;
    nextFieldBtn.disabled = last;
    mobileNextBtn.disabled = last;
  }

  // ---------------------------------------------------------------- 設問の切替
  let focusId: number | null = null;
  let editor: FieldEditorHandle | null = null;

  /** 次の未入力設問を探す。wrapped は「末尾を越えて先頭側へ戻った」かどうか */
  function nextEmptyField(): { id: number; wrapped: boolean } | null {
    const start = focusId != null ? fields.findIndex((f) => f.raw.id === focusId) : -1;
    for (let i = 1; i <= fields.length; i++) {
      const idx = (start + i) % fields.length;
      const field = fields[idx];
      if (isEditable(field) && !isFilledField(field)) return { id: field.raw.id, wrapped: idx <= start };
    }
    return null;
  }

  function nextEmptyId(): number | null {
    return nextEmptyField()?.id ?? null;
  }

  function renderEditor(): void {
    editor?.destroy();
    editorBody.innerHTML = "";
    const field = focusId != null ? fieldById.get(focusId) : undefined;
    if (!field) return;
    // rim の座標系は設問のあるページごとに違いうる
    const answerSize = answerPageSize(report.base_sheet, answerImages, field.raw.page);
    const questionSize = questionPageSize(report.base_sheet, questionImages, field.raw.page);
    editor = createFieldEditor({
      field,
      pageImage: answerImages[pageArrayIndex(answerImages, field.raw.page)] ?? null,
      questionPageImage: questionImages[pageArrayIndex(questionImages, field.raw.page)] ?? null,
      cutMargin,
      sheetWidth: answerSize?.width ?? 0,
      sheetHeight: answerSize?.height ?? 0,
      questionSheetWidth: questionSize?.width ?? 0,
      questionSheetHeight: questionSize?.height ?? 0,
      sheetDpi: report.base_sheet?.dpi,
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
        markDirty();
      },
    });
    editorBody.appendChild(editor.element);
  }

  interface FocusOptions {
    /** タップ・ストリップ選択・「次の未入力へ」など、ユーザーが明示的にその設問へ
     *  向かったときだけ true。テキストエリアへ自動フォーカスするかどうかに使う
     *  (勝手にキーボードを出さない、という既存方針を維持) */
    focusInput?: boolean;
    focusText?: boolean;
  }

  function focusField(id: number, options: FocusOptions = {}): void {
    if (!fieldById.has(id)) return;
    focusId = id;
    renderEditor();
    refreshFieldMeta();
    strip.setActive(id);
    viewer.showField(id);
    if (options.focusText !== false && options.focusInput) {
      editor?.focus();
    }
  }

  /** focusId から delta 方向にある、次に編集できる設問を探す(無ければ null) */
  function findStepTarget(delta: number): EditableField | null {
    if (fields.length === 0) return null;
    const current = focusId != null ? fields.findIndex((f) => f.raw.id === focusId) : -1;
    for (let next = current + delta; next >= 0 && next < fields.length; next += delta) {
      if (isEditable(fields[next])) return fields[next];
    }
    return null;
  }

  function stepField(delta: number): void {
    if (fields.length === 0) return;
    const target = findStepTarget(delta);
    if (target) {
      focusField(target.raw.id, { focusInput: true });
      return;
    }
    // 編集可能な設問がひとつも無いシートでは、従来どおり全件を歩く
    if (!fields.some(isEditable)) {
      const current = focusId != null ? fields.findIndex((f) => f.raw.id === focusId) : -1;
      const next = Math.min(Math.max(current + delta, 0), fields.length - 1);
      focusField(fields[next].raw.id, { focusInput: true });
      return;
    }
    // 端に着いて動けない。キーで押しても何も起きないと壊れたように見えるので告げる
    announce(delta > 0 ? "これが最後の設問です" : "これが最初の設問です");
  }

  // ---------------------------------------------------------------- お知らせ欄
  if (guard.blocked) {
    const warn = document.createElement("div");
    warn.className = "es-warning";
    warn.textContent = guard.reason ?? "";
    notices.appendChild(warn);
  }

  // 下書きの復元。復元バーは起動時に読んだ existingBackup から作り直す(ストレージは読み直さない)
  let restoreBarEl: HTMLElement | null = null;
  /** 提示の説明行。最初の入力で退避したときに文言を更新する */
  let offerNoteEl: HTMLElement | null = null;
  /** 復元した直後だけ、その直前の編集seq。ここから編集が入ると「元に戻す」は無効になる */
  let undoSeq: number | null = null;

  function removeRestoreBar(): void {
    restoreBarEl?.remove();
    restoreBarEl = null;
    undoSeq = null;
    offerNoteEl = null;
    offerPending = false;
    refreshStatusText();
  }

  /**
   * 値を編集中の設問へ書き戻し、表示を組み直す。下書きは書かない(戻す操作で下書きを上書きしないため)。
   * 呼び出し側は、先に removeRestoreBar() で undo 状態を外しておくこと(でないと自分の変更で消える)。
   */
  function applyValues(values: SheetBackup): void {
    for (const field of fields) {
      const entry = values[field.raw.id];
      if (!entry || !isEditable(field)) continue;
      // 選択式は今の選択肢に無い値を戻さない(画面に出せない値を保存してしまうのを防ぐ)
      if (field.isEditableChoice && entry.text !== "" && !field.choices.includes(entry.text)) continue;
      field.text = entry.text;
      field.direction = entry.direction;
      field.fontSize = entry.fontSize;
      field.lineHeight = entry.lineHeight;
      field.color = entry.color;
    }
    // 復元・元に戻した内容はサーバーに無い可能性があるので、保存するまで未保存扱いにする
    markDirty();
    renderEditor();
    refreshProgress();
    strip.refresh();
    viewer.refreshRims();
  }

  function showRestoreOffer(backup: LoadedBackup): void {
    removeRestoreBar();
    const bar = document.createElement("div");
    bar.className = "es-warning";
    const message = document.createElement("div");
    message.textContent = backup.savedAt
      ? `この端末に、${formatDateTime(backup.savedAt)} に入力した下書きが残っています。`
      : "この端末に保存された下書きが残っています。";
    bar.appendChild(message);
    const note = document.createElement("div");
    note.textContent = "入力を始めると、古い下書きは退避してから新しい入力を自動保存します。";
    bar.appendChild(note);
    offerNoteEl = note;
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
    bar.appendChild(actions);
    restoreBtn.addEventListener("click", () => {
      // 復元で今の入力が消えるので、直前の値を控えてから当てる
      const before = collectBackup();
      applyValues(backup.fields);
      // 復元した内容を先に下書きへ書く。古い下書きは、上書きの前に退避される(提示がまだ残っている今のうちに)
      persistNow();
      showRestoredBanner(backup, before);
    });
    discardBtn.addEventListener("click", () => {
      // 破棄すると戻せない。離脱ガードと同じく確認を通す
      if (!window.confirm("この端末に保存された下書きを破棄します。\n破棄すると元に戻せません。よろしいですか?")) return;
      clearBackup(sheet.studentCode, sheet.baseSheetId, sheet.times);
      clearArchive(sheet.studentCode, sheet.baseSheetId, sheet.times);
      removeRestoreBar();
      // 消したあと、今の入力をここで書き直す(提示の後で打った分を残すため)
      if (dirty) persistNow();
    });
    notices.appendChild(bar);
    restoreBarEl = bar;
    offerPending = true;
    refreshStatusText();
  }

  function showRestoredBanner(backup: LoadedBackup, before: SheetBackup): void {
    removeRestoreBar();
    const bar = document.createElement("div");
    bar.className = "es-warning";
    const message = document.createElement("div");
    message.textContent = "下書きを復元しました。内容を確かめ、問題なければ下書き保存してください。";
    bar.appendChild(message);
    const actions = document.createElement("div");
    actions.className = "es-warning-actions";
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.textContent = "元に戻す";
    undoBtn.addEventListener("click", () => {
      // 戻したあとも下書きは残っているので、復元の選択肢をもう一度出す
      removeRestoreBar();
      applyValues(before);
      showRestoreOffer(backup);
    });
    actions.appendChild(undoBtn);
    bar.appendChild(actions);
    notices.appendChild(bar);
    restoreBarEl = bar;
    undoSeq = editSeq;
  }

  const existingBackup = loadBackup(sheet.studentCode, sheet.baseSheetId, sheet.times);
  if (existingBackup) showRestoreOffer(existingBackup);

  // 初回だけ操作の要点を出す。保存できない環境では毎回出て邪魔になるので出さない
  const HINT_KEY = "easysmarky:hint-dismissed";
  let hintDismissed = true;
  try {
    hintDismissed = localStorage.getItem(HINT_KEY) === "1";
  } catch {
    // 読めない環境では出さないままにする
  }
  if (!hintDismissed) {
    const hint = document.createElement("div");
    hint.className = "es-hint";
    const hintText = document.createElement("div");
    hintText.textContent =
      "解答欄(枠)をタップすると入力を始められます。下の設問チップや ◀ ▶ で、ほかの設問へ移動できます。" +
      "スマホでは2本指のピンチで解答用紙を拡大・縮小でき、「読む」で全画面表示にできます。";
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.textContent = "わかった";
    dismissBtn.addEventListener("click", () => {
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        // 保存できなくても、この画面では消すだけにする
      }
      hint.remove();
    });
    hint.appendChild(hintText);
    hint.appendChild(dismissBtn);
    notices.appendChild(hint);
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
      // 押すたびに次の不一致の設問へ回る。件数が1つだけのときは位置を出さない
      let cursor = -1;
      jumpBtn.textContent = "該当の設問を見る";
      jumpBtn.addEventListener("click", () => {
        cursor = (cursor + 1) % mismatchedIds.length;
        focusField(mismatchedIds[cursor], { focusInput: true });
        jumpBtn.textContent =
          mismatchedIds.length > 1
            ? `該当の設問を見る (${cursor + 1}/${mismatchedIds.length})`
            : "該当の設問を見る";
      });
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
    saveNotice?.remove();
    saveNotice = null;
    // 送信の時点で組み立てた内容が保存対象。ここより後の編集は次の保存に回る
    const seqAtStart = editSeq;
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
        // 入力はこの端末に残っている。失敗の理由と、次に何をすればよいかを併せて示す
        let message = result.blockedReason ?? (result.errors ?? ["保存に失敗しました。"]).join("\n");
        if (!result.blockedReason) {
          if (backupFailed) {
            message += "\nこの端末への自動保存もできていないため、画面を閉じないでください。";
          } else if (offerPending) {
            message += "\nこの端末にはまだ自動保存していないため、画面を閉じないでください。";
          } else {
            message += "\n入力内容はこの端末に残っています。";
          }
        }
        setSaveStatus("保存に失敗しました。", "#a02622");
        showSaveNotice(message, []);
      } else if (result.mismatchedFieldIds && result.mismatchedFieldIds.length > 0) {
        // 反映が確認できていないので、未保存扱いのまま離脱時に確認を出す。
        // ステータスは短く、詳細と操作はカードに分けて二重表示を避ける
        dirty = true;
        const count = result.mismatchedFieldIds.length;
        setSaveStatus(`一部の設問の反映を確認できませんでした(${count}件)`, "#a02622");
        showSaveNotice(
          `保存はされましたが、一部の設問(${count}件)の反映が確認できませんでした。「該当の設問を見る」から内容を確かめ、公式画面でもご確認ください。`,
          result.mismatchedFieldIds,
        );
      } else if (!result.verified) {
        // 送信は通ったが照合できなかった。「確認済み」とは言わず、未確認のまま残す
        dirty = true;
        setSaveStatus("反映を確認できませんでした。", "#a02622");
        showSaveNotice("保存は完了しましたが、サーバーで反映を確認できませんでした。公式画面で内容をご確認ください。", []);
      } else {
        serverSavedAt = Date.now();
        dirty = editSeq !== seqAtStart;
        // まだ退避していない古い下書きは、答えるまで残す(保存の副作用で黙って消さない)
        if (!dirty && !offerPending) {
          // サーバー側と揃ったので、この端末のバックアップ・退避・復元バー(元に戻すを含む)はもう不要
          clearBackup(sheet.studentCode, sheet.baseSheetId, sheet.times);
          clearArchive(sheet.studentCode, sheet.baseSheetId, sheet.times);
          removeRestoreBar();
        }
        refreshSaveState();
      }
    } catch {
      const message = "予期せぬエラーが発生しました。通信状況をご確認のうえ再度お試しください。";
      setSaveStatus(message, "#a02622");
      showSaveNotice(message, []);
    } finally {
      saving = false;
      saveBtn.disabled = guard.blocked;
    }
  }

  saveBtn.disabled = guard.blocked;
  saveBtn.addEventListener("click", () => void runSave());

  // ---------------------------------------------------------------- 操作
  prevBtn.addEventListener("click", () => stepField(-1));
  nextFieldBtn.addEventListener("click", () => stepField(1));
  mobilePrevBtn.addEventListener("click", () => stepField(-1));
  mobileNextBtn.addEventListener("click", () => stepField(1));

  function goToNextEmpty(): void {
    const next = nextEmptyField();
    if (!next) {
      // ボタンは無効化されているが、Alt+Enter からは届くので無反応にしない
      announce("未入力の設問はありません。下書き保存できます。");
      return;
    }
    focusField(next.id, { focusInput: true });
    if (next.wrapped) announce("先頭に戻りました(この先に未入力はありません)");
  }
  nextEmptyBtn.addEventListener("click", goToNextEmpty);

  // ショートカットはオーバーレイ全体で効かせたいので window で受ける。
  // 一覧に戻る(form が捨てられる)か、オーバーレイが閉じられたら自分で外れる。
  function onKeyDown(event: KeyboardEvent): void {
    if (!form.isConnected) {
      window.removeEventListener("keydown", onKeyDown, true);
      return;
    }
    if (form.getClientRects().length === 0) return; // オーバーレイ非表示中
    // 読むモード中は、裏の入力欄へのフォーカス移動や保存を起こさない(読んでいる間に回答が変わるのを防ぐ)
    if (reader) return;
    // 日本語入力の変換中のキーは、確定操作として入力欄に任せる
    if (event.isComposing || event.keyCode === 229) return;
    if (event.altKey && event.key === "Enter") {
      event.preventDefault();
      goToNextEmpty();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key === "Enter") {
        event.preventDefault();
        stepField(event.shiftKey ? -1 : 1);
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

  // 未保存のままタブを閉じる・ページを離れるときは、ブラウザの確認を出す。
  // 一覧に戻って form が捨てられたら、次の呼び出しで自分で外れる。
  function onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!form.isConnected) {
      window.removeEventListener("beforeunload", onBeforeUnload);
      return;
    }
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  }
  window.addEventListener("beforeunload", onBeforeUnload);

  // ---------------------------------------------------------------- 初期表示
  const firstEditable = fields.find(isEditable) ?? fields[0];
  if (firstEditable) {
    // 勝手にキーボードを出さないよう、初期表示ではテキストエリアへフォーカスしない
    focusField(firstEditable.raw.id, { focusText: false });
  }
  refreshProgress();
  refreshStatusText();
}
