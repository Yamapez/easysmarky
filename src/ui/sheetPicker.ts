import { fetchCurrentUser, fetchStudentSheetList, studentCodeFromLoginId } from "../api/endpoints";
import type { BaseSheetSummary, StudentSheetSummary } from "../api/types";

export interface SelectedSheet {
  studentCode: string;
  subjectCode: string;
  nendo: number;
  reportNo: number;
  baseSheetId: number;
  times: number;
}

export interface SheetPickerOptions {
  onSelect: (sheet: SelectedSheet) => void;
}

function statusLabel(sheetSummary: StudentSheetSummary | null): { text: string; cls: string } {
  if (!sheetSummary) return { text: "未着手", cls: "" };
  if (sheetSummary.submitted_at) return { text: "提出済み", cls: "done" };
  return { text: "下書きあり", cls: "" };
}

function formatDeadline(base: BaseSheetSummary): string {
  if (!base.std_deadline_at) return "";
  const d = new Date(base.std_deadline_at);
  return `締切 ${d.getMonth() + 1}/${d.getDate()}`;
}

export async function renderSheetPicker(container: HTMLElement, opts: SheetPickerOptions): Promise<void> {
  container.innerHTML = '<div class="es-loading">読み込み中...</div>';

  const currentUser = await fetchCurrentUser();
  const studentCode = studentCodeFromLoginId(currentUser.user.login_id);
  const list = await fetchStudentSheetList(studentCode);

  container.innerHTML = "";

  if (list.student_subject_rows.length === 0) {
    container.innerHTML = '<div class="es-loading">提出対象のレポートが見つかりませんでした。</div>';
    return;
  }

  for (const row of list.student_subject_rows) {
    const subject = row.student_subject;
    const heading = document.createElement("div");
    heading.style.fontWeight = "bold";
    heading.style.fontSize = "14px";
    heading.style.margin = "14px 0 6px";
    heading.textContent = subject.subject_name;
    container.appendChild(heading);

    row.base_sheets.forEach((base, i) => {
      if (!base || !base.is_published) return;
      const sheetSummary = row.student_sheets[i] ?? null;
      const status = statusLabel(sheetSummary);
      const times = sheetSummary ? sheetSummary.times : 1;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "es-list-item";
      btn.innerHTML = `第${base.report_no}回<span class="es-badge ${status.cls}">${status.text}</span><div class="es-sub">${formatDeadline(base)}</div>`;
      btn.addEventListener("click", () => {
        opts.onSelect({
          studentCode,
          subjectCode: subject.subject_code,
          nendo: subject.nendo,
          reportNo: base.report_no,
          baseSheetId: base.id,
          times,
        });
      });
      container.appendChild(btn);
    });
  }
}
