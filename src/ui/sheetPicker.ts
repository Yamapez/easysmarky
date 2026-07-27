import { fetchCurrentUser, fetchStudentSheetList, studentCodeFromLoginId } from "../api/endpoints";
import type { BaseSheetSummary, StudentSheetSummary, StudentSubjectRow } from "../api/types";
import { loadSheetSummaries, sheetSummaryId, type SheetSummaries, type SheetSummary } from "../storage/backup";

export interface SelectedSheet {
  studentCode: string;
  subjectCode: string;
  subjectName: string;
  nendo: number;
  reportNo: number;
  baseSheetId: number;
  times: number;
  /** 一覧APIが返す提出期限。フォームのヘッダに出す */
  stdDeadlineAt: string | null;
}

export interface SheetPickerOptions {
  onSelect: (sheet: SelectedSheet) => void;
}

interface SheetEntry {
  base: BaseSheetSummary;
  sheetSummary: StudentSheetSummary | null;
  deadline: number;
}

/** 締切の比較用。未設定の回は末尾に送る */
function deadlineValue(base: BaseSheetSummary): number {
  const at = base.std_deadline_at ?? base.final_deadline_at;
  const t = at ? new Date(at).getTime() : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function formatDeadline(base: BaseSheetSummary): string {
  const at = base.std_deadline_at;
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const label = `締切 ${d.getMonth() + 1}/${d.getDate()}`;
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return label;
  if (days === 0) return `${label} ・ 本日まで`;
  return `${label} ・ あと${days}日`;
}

function statusLabel(
  sheetSummary: StudentSheetSummary | null,
  cached: SheetSummary | undefined,
): { text: string; cls: string } {
  if (cached?.blocked) return { text: "手書きあり・保存不可", cls: "locked" };
  if (!sheetSummary) return { text: "未着手", cls: "idle" };
  if (sheetSummary.submitted_at) return { text: "提出済み", cls: "done" };
  return { text: "下書きあり", cls: "" };
}

/** 「3/8」と進捗バー。一度も開いていない回は数字を出せないので「—」にする */
function progressElement(cached: SheetSummary | undefined, submitted: boolean): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "es-list-progress";
  if (!cached || cached.total === 0) {
    wrap.textContent = "—";
    return wrap;
  }
  const count = document.createElement("span");
  count.textContent = `${cached.filled}/${cached.total}`;
  const bar = document.createElement("span");
  bar.className = "es-progress-bar";
  const fill = document.createElement("span");
  fill.className = "es-progress-fill";
  const done = cached.filled >= cached.total;
  if (done || submitted) fill.classList.add("done");
  fill.style.width = `${Math.round((cached.filled / cached.total) * 100)}%`;
  bar.appendChild(fill);
  wrap.appendChild(count);
  wrap.appendChild(bar);
  return wrap;
}

/** 公開済みの回だけを、締切が近い順に並べて取り出す */
function publishedSheets(row: StudentSubjectRow): SheetEntry[] {
  const entries: SheetEntry[] = [];
  row.base_sheets.forEach((base, i) => {
    if (!base || !base.is_published) return;
    entries.push({ base, sheetSummary: row.student_sheets[i] ?? null, deadline: deadlineValue(base) });
  });
  return entries.sort((a, b) => a.deadline - b.deadline || a.base.report_no - b.base.report_no);
}

export async function renderSheetPicker(container: HTMLElement, opts: SheetPickerOptions): Promise<void> {
  container.innerHTML = '<div class="es-loading">読み込み中...</div>';

  const currentUser = await fetchCurrentUser();
  const studentCode = studentCodeFromLoginId(currentUser.user.login_id);
  const list = await fetchStudentSheetList(studentCode);
  const summaries: SheetSummaries = loadSheetSummaries(studentCode);

  container.innerHTML = "";

  if (list.student_subject_rows.length === 0) {
    container.innerHTML = '<div class="es-loading">提出対象のレポートが見つかりませんでした。</div>';
    return;
  }

  const note = document.createElement("div");
  note.className = "es-list-note";
  note.innerHTML =
    '<span>締切が近い順</span><span class="es-list-note-sub">下書きは自動でこの端末に保存されます</span>';
  container.appendChild(note);

  // 科目も「いちばん近い締切」の順に並べる
  const rows = list.student_subject_rows
    .map((row) => ({ row, sheets: publishedSheets(row) }))
    .filter((entry) => entry.sheets.length > 0)
    .sort((a, b) => a.sheets[0].deadline - b.sheets[0].deadline);

  for (const { row, sheets } of rows) {
    const subject = row.student_subject;
    const heading = document.createElement("div");
    heading.className = "es-list-heading";
    heading.textContent = subject.subject_name;
    container.appendChild(heading);

    for (const { base, sheetSummary } of sheets) {
      const times = sheetSummary ? sheetSummary.times : 1;
      const cached = summaries[sheetSummaryId(base.id, times)];
      const status = statusLabel(sheetSummary, cached);
      const submitted = !!sheetSummary?.submitted_at;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "es-list-item";
      // 下書き途中の回は目に留まるようにする
      if (!submitted && (cached || sheetSummary)) btn.classList.add("current");

      const main = document.createElement("span");
      main.className = "es-list-main";
      const title = document.createElement("span");
      title.className = "es-list-title";
      const no = document.createElement("span");
      no.textContent = `第${base.report_no}回`;
      const badge = document.createElement("span");
      badge.className = `es-badge ${status.cls}`.trim();
      badge.textContent = status.text;
      title.appendChild(no);
      title.appendChild(badge);
      main.appendChild(title);

      const sub = document.createElement("span");
      sub.className = "es-sub";
      sub.style.display = "block";
      const deadlineText = formatDeadline(base);
      sub.textContent = cached?.blocked
        ? [deadlineText, "公式画面をご利用ください"].filter(Boolean).join(" ・ ")
        : deadlineText;
      main.appendChild(sub);
      btn.appendChild(main);

      // 保存不可の回は進捗を出しても意味がないので「—」にする
      btn.appendChild(progressElement(cached?.blocked ? undefined : cached, submitted));

      btn.addEventListener("click", () => {
        opts.onSelect({
          studentCode,
          subjectCode: subject.subject_code,
          subjectName: subject.subject_name,
          nendo: subject.nendo,
          reportNo: base.report_no,
          baseSheetId: base.id,
          times,
          stdDeadlineAt: base.std_deadline_at,
        });
      });
      container.appendChild(btn);
    }
  }
}
