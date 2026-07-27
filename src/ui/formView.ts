import { fetchDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery } from "../api/types";
import { createEditableField } from "../model/field";
import { checkSaveGuard } from "../model/toParam";
import { saveDraft } from "../save/save";
import { debounce, loadBackup, saveBackup, type SheetBackup } from "../storage/backup";
import { createFieldRow, type FieldRowHandle } from "./fieldRow";
import { createPageViewer, pageArrayIndex } from "./pageViewer";
import type { SelectedSheet } from "./sheetPicker";

export interface FormViewOptions {
  sheet: SelectedSheet;
  onBack: () => void;
}

/** 2ペインが横並びになる幅。styles.ts の @media (min-width: 900px) と一致させること */
const TWO_PANE_MIN_WIDTH = 900;

export async function renderFormView(container: HTMLElement, opts: FormViewOptions): Promise<void> {
  container.innerHTML = '<div class="es-loading">読み込み中...</div>';

  const query: DigitalReportQuery = {
    subject_code: opts.sheet.subjectCode,
    nendo: opts.sheet.nendo,
    report_no: opts.sheet.reportNo,
    student_code: opts.sheet.studentCode,
    is_preview_mode: false,
    times: opts.sheet.times,
  };

  const report = await fetchDigitalReport(query);
  const cutMargin = report.cut_margin;
  const pageImages = report.base64_answer_images ?? [];
  const questionImages = report.base64_question_images ?? [];

  container.innerHTML = "";

  // 左(PC)/「問題」タブ(スマホ) = 問題ページビューア、右/「解答」タブ = 入力フォーム
  const layout = document.createElement("div");
  layout.className = "es-form-layout";
  container.appendChild(layout);

  // スマホ用の表示切替タブ。PCではCSSで隠され、2カラムで両方表示される
  const tabs = document.createElement("div");
  tabs.className = "es-pane-tabs";
  const questionTabBtn = document.createElement("button");
  questionTabBtn.type = "button";
  questionTabBtn.textContent = "問題";
  const formTabBtn = document.createElement("button");
  formTabBtn.type = "button";
  formTabBtn.textContent = "解答";
  tabs.appendChild(questionTabBtn);
  tabs.appendChild(formTabBtn);
  layout.appendChild(tabs);

  function showPane(pane: "question" | "form"): void {
    layout.dataset.pane = pane;
    questionTabBtn.classList.toggle("active", pane === "question");
    formTabBtn.classList.toggle("active", pane === "form");
  }

  const questionPane = document.createElement("div");
  questionPane.className = "es-pane-question";
  const viewer = createPageViewer({ questionImages, answerImages: pageImages });
  questionPane.appendChild(viewer.element);
  layout.appendChild(questionPane);

  const formPane = document.createElement("div");
  formPane.className = "es-pane-form";
  layout.appendChild(formPane);

  // スマホでは問題文が見えないまま解答を求められるのを避けるため「問題」から始める。
  // PCではメディアクエリが両ペインを表示するので、この値は見た目に影響しない。
  showPane("question");

  questionTabBtn.addEventListener("click", () => showPane("question"));
  formTabBtn.addEventListener("click", () => showPane("form"));

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "es-back";
  backBtn.textContent = "← 科目一覧に戻る";
  backBtn.addEventListener("click", opts.onBack);
  formPane.appendChild(backBtn);

  const subjectTitle = document.createElement("div");
  subjectTitle.style.fontWeight = "bold";
  subjectTitle.style.marginBottom = "10px";
  subjectTitle.textContent = report.subject_name;
  formPane.appendChild(subjectTitle);

  const fields = (report.base_sheet_fields ?? [])
    .slice()
    .sort((a, b) => (a.page - b.page) || (a.id - b.id))
    .map(createEditableField);

  const guard = checkSaveGuard(fields);
  if (guard.blocked) {
    const warn = document.createElement("div");
    warn.className = "es-warning";
    warn.textContent = guard.reason ?? "";
    formPane.appendChild(warn);
  }

  const backupKeyId = { studentCode: opts.sheet.studentCode, baseSheetId: opts.sheet.baseSheetId, times: opts.sheet.times };
  const existingBackup = loadBackup(backupKeyId.studentCode, backupKeyId.baseSheetId, backupKeyId.times);
  if (existingBackup) {
    const restoreBar = document.createElement("div");
    restoreBar.className = "es-warning";
    restoreBar.innerHTML =
      'この回にはブラウザに保存されたローカル下書きがあります。 <button type="button" class="es-list-item" style="margin-top:6px;">ローカル下書きを復元する</button>';
    const restoreBtn = restoreBar.querySelector("button")!;
    restoreBtn.addEventListener("click", () => {
      applyBackup(existingBackup);
      restoreBar.remove();
    });
    formPane.appendChild(restoreBar);
  }

  const fieldsContainer = document.createElement("div");
  formPane.appendChild(fieldsContainer);

  const handles: FieldRowHandle[] = [];

  const persistBackup = debounce(() => {
    const backup: SheetBackup = {};
    for (const h of handles) {
      const f = h.getField();
      if (!f.isEditableText) continue;
      backup[f.raw.id] = {
        text: f.text,
        direction: f.direction,
        fontSize: f.fontSize,
        lineHeight: f.lineHeight,
        color: f.color,
      };
    }
    saveBackup(backupKeyId.studentCode, backupKeyId.baseSheetId, backupKeyId.times, backup);
  }, 500);

  function applyBackup(backup: SheetBackup): void {
    for (const h of handles) {
      const f = h.getField();
      const entry = backup[f.raw.id];
      if (!entry) continue;
      f.text = entry.text;
      f.direction = entry.direction;
      f.fontSize = entry.fontSize;
      f.lineHeight = entry.lineHeight;
      f.color = entry.color;
    }
    // 表示を作り直す(簡易的に再レンダリング)
    renderFieldRows();
  }

  function renderFieldRows(): void {
    for (const h of handles) h.destroy();
    fieldsContainer.innerHTML = "";
    handles.length = 0;
    for (const field of fields) {
      const handle = createFieldRow({
        field,
        pageImage: pageImages[pageArrayIndex(pageImages, field.raw.page)] ?? null,
        cutMargin,
        onChange: () => persistBackup(),
        onShowPage: (page) => {
          // いま見ている種別(問題/解答用紙)のまま、その設問のページへ送る
          const src = viewer.currentSource();
          const images = src === "question" ? questionImages : pageImages;
          viewer.goTo(src, pageArrayIndex(images, page));
          // スマホでは問題ペインに切り替えないと見えない
          if (window.innerWidth < TWO_PANE_MIN_WIDTH) showPane("question");
        },
      });
      fieldsContainer.appendChild(handle.element);
      handles.push(handle);
    }
  }

  renderFieldRows();

  const saveBar = document.createElement("div");
  saveBar.className = "es-savebar";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "es-save-btn";
  saveBtn.textContent = "下書き保存";
  saveBtn.disabled = guard.blocked;
  const statusEl = document.createElement("div");
  statusEl.className = "es-save-status";
  saveBar.appendChild(saveBtn);
  saveBar.appendChild(statusEl);
  formPane.appendChild(saveBar);

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    statusEl.textContent = "保存中...";
    statusEl.style.color = "#666";
    try {
      const currentFields = handles.map((h) => h.getField());
      const result = await saveDraft({
        fields: currentFields,
        cutMargin,
        baseSheetId: opts.sheet.baseSheetId,
        studentCode: opts.sheet.studentCode,
        times: opts.sheet.times,
        verifyQuery: query,
      });
      if (!result.ok) {
        statusEl.style.color = "#a02622";
        statusEl.textContent = result.blockedReason ?? (result.errors ?? ["保存に失敗しました。"]).join("\n");
      } else if (result.mismatchedFieldIds && result.mismatchedFieldIds.length > 0) {
        statusEl.style.color = "#a02622";
        statusEl.textContent = `保存はされましたが、一部の設問(${result.mismatchedFieldIds.length}件)の反映が確認できませんでした。公式画面で内容をご確認ください。`;
      } else {
        statusEl.style.color = "#2e7d32";
        statusEl.textContent = "保存済み(サーバーで反映を確認しました)。";
      }
    } catch {
      statusEl.style.color = "#a02622";
      statusEl.textContent = "予期せぬエラーが発生しました。通信状況をご確認のうえ再度お試しください。";
    } finally {
      saveBtn.disabled = guard.blocked;
    }
  });
}
