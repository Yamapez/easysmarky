import { fetchDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery } from "../api/types";
import { createEditableField } from "../model/field";
import { checkSaveGuard } from "../model/toParam";
import { saveDraft } from "../save/save";
import { debounce, loadBackup, saveBackup, type SheetBackup } from "../storage/backup";
import { createFieldRow, type FieldRowHandle } from "./fieldRow";
import type { SelectedSheet } from "./sheetPicker";

export interface FormViewOptions {
  sheet: SelectedSheet;
  onBack: () => void;
}

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

  container.innerHTML = "";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "es-back";
  backBtn.textContent = "← 科目一覧に戻る";
  backBtn.addEventListener("click", opts.onBack);
  container.appendChild(backBtn);

  const subjectTitle = document.createElement("div");
  subjectTitle.style.fontWeight = "bold";
  subjectTitle.style.marginBottom = "10px";
  subjectTitle.textContent = report.subject_name;
  container.appendChild(subjectTitle);

  const fields = (report.base_sheet_fields ?? [])
    .slice()
    .sort((a, b) => (a.page - b.page) || (a.id - b.id))
    .map(createEditableField);

  const guard = checkSaveGuard(fields);
  if (guard.blocked) {
    const warn = document.createElement("div");
    warn.className = "es-warning";
    warn.textContent = guard.reason ?? "";
    container.appendChild(warn);
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
    container.appendChild(restoreBar);
  }

  const fieldsContainer = document.createElement("div");
  container.appendChild(fieldsContainer);

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
    fieldsContainer.innerHTML = "";
    handles.length = 0;
    for (const field of fields) {
      const handle = createFieldRow({
        field,
        pageImage: pageImages[field.raw.page - 1] ?? pageImages[field.raw.page] ?? null,
        cutMargin,
        onChange: () => persistBackup(),
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
  container.appendChild(saveBar);

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
