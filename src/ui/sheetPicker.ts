import { fetchCurrentUser, fetchStudentSheetList, studentCodeFromLoginId } from "../api/endpoints";
import type { BaseSheetSummary, StudentSheetSummary, StudentSubjectRow } from "../api/types";
import { loadSheetSummaries, sheetSummaryId, type SheetSummaries, type SheetSummary } from "../storage/backup";
import { loadLastSheet } from "../storage/listState";

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
  /** 取得・描画に失敗したときに呼ぶ。renderSheetPicker 自体は reject しない */
  onError: (err: unknown) => void;
  /** 描画後にこの位置までスクロールする(戻る・更新で元の位置を保つため) */
  restoreScrollTop?: number;
}

interface SheetEntry {
  base: BaseSheetSummary;
  sheetSummary: StudentSheetSummary | null;
  deadline: number;
  submitted: boolean;
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

/** 締切を過ぎたかどうか。日時が無い・読めないときは過ぎていないとみなす */
function passed(at: string | null, now: number): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  return !Number.isNaN(t) && t < now;
}

/**
 * 未提出の回の締切超過の段階。final(最終締切)を過ぎていれば強い警告(final)、
 * std(標準締切)だけを過ぎていれば注意(std)。final が無いときは std だけで判定する。
 */
function overdueLevel(base: BaseSheetSummary, now: number): "std" | "final" | null {
  if (passed(base.final_deadline_at, now)) return "final";
  if (passed(base.std_deadline_at, now)) return "std";
  return null;
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

/**
 * 公開済みの回を取り出す。並びは「未提出が先、提出済みが後ろ」で、
 * その中を締切が近い順にする(提出済みは締切を見ても強調しない)。
 * student_sheets[i] と base_sheets[i] の対応はこの時点で SheetEntry に束ねる。
 */
function publishedSheets(row: StudentSubjectRow): SheetEntry[] {
  const entries: SheetEntry[] = [];
  row.base_sheets.forEach((base, i) => {
    if (!base || !base.is_published) return;
    const sheetSummary = row.student_sheets[i] ?? null;
    entries.push({
      base,
      sheetSummary,
      deadline: deadlineValue(base),
      submitted: !!sheetSummary?.submitted_at,
    });
  });
  return entries.sort(
    (a, b) =>
      Number(a.submitted) - Number(b.submitted) ||
      a.deadline - b.deadline ||
      a.base.report_no - b.base.report_no,
  );
}

interface SubjectGroup {
  row: StudentSubjectRow;
  sheets: SheetEntry[];
}

/** 科目も「未提出の中でいちばん近い締切」の順。並べ替え後の先頭(sheets[0])で決める */
function groupSubjects(list: StudentSubjectRow[]): SubjectGroup[] {
  return list
    .map((row) => ({ row, sheets: publishedSheets(row) }))
    .filter((group) => group.sheets.length > 0)
    .sort((a, b) => a.sheets[0].deadline - b.sheets[0].deadline);
}

function selectionOf(studentCode: string, row: StudentSubjectRow, entry: SheetEntry): SelectedSheet {
  const subject = row.student_subject;
  return {
    studentCode,
    subjectCode: subject.subject_code,
    subjectName: subject.subject_name,
    nendo: subject.nendo,
    reportNo: entry.base.report_no,
    baseSheetId: entry.base.id,
    // 回の再開は一覧APIの値を優先する(保存されていた値は使わない)
    times: entry.sheetSummary ? entry.sheetSummary.times : 1,
    stdDeadlineAt: entry.base.std_deadline_at,
  };
}

export async function renderSheetPicker(container: HTMLElement, opts: SheetPickerOptions): Promise<void> {
  // 取得の前に位置を控える。読み込み中は高さが無く scrollTop が 0 に丸められるため
  const keepTop = opts.restoreScrollTop ?? 0;
  container.innerHTML = '<div class="es-loading" role="status">読み込み中...</div>';

  try {
    const currentUser = await fetchCurrentUser();
    const studentCode = studentCodeFromLoginId(currentUser.user.login_id);
    const list = await fetchStudentSheetList(studentCode);
    const summaries: SheetSummaries = loadSheetSummaries(studentCode);
    const last = loadLastSheet(studentCode);

    container.innerHTML = "";

    if (list.student_subject_rows.length === 0) {
      container.innerHTML = '<div class="es-loading">提出対象のレポートが見つかりませんでした。</div>';
      return;
    }

    const select = (row: StudentSubjectRow, entry: SheetEntry): void => {
      opts.onSelect(selectionOf(studentCode, row, entry));
    };

    const groups = groupSubjects(list.student_subject_rows);
    const now = Date.now();

    // 前回開いた回が、今の一覧(公開済み)にあるときだけ先頭に出す
    if (last) {
      for (const { row, sheets } of groups) {
        const entry = sheets.find((s) => s.base.id === last.baseSheetId);
        if (!entry) continue;
        const resume = document.createElement("button");
        resume.type = "button";
        resume.className = "es-resume";
        resume.dataset.baseSheetId = String(entry.base.id);
        resume.textContent = `続きから: ${row.student_subject.subject_name} 第${entry.base.report_no}回`;
        resume.addEventListener("click", () => select(row, entry));
        container.appendChild(resume);
        break;
      }
    }

    const note = document.createElement("div");
    note.className = "es-list-note";
    const noteLabel = document.createElement("span");
    noteLabel.textContent = "締切が近い順・提出済みは後ろ";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "es-list-refresh";
    refreshBtn.textContent = "更新";
    refreshBtn.addEventListener("click", () => {
      // 押した直後に描き直して要素ごと消えるが、念のため連打を止めておく
      refreshBtn.disabled = true;
      void renderSheetPicker(container, { ...opts, restoreScrollTop: container.scrollTop });
    });
    const noteSub = document.createElement("span");
    noteSub.className = "es-list-note-sub";
    noteSub.textContent = "下書きは自動でこの端末に保存されます";
    note.appendChild(noteLabel);
    note.appendChild(refreshBtn);
    note.appendChild(noteSub);
    container.appendChild(note);

    for (const { row, sheets } of groups) {
      const subject = row.student_subject;
      const heading = document.createElement("div");
      heading.className = "es-list-heading";
      heading.textContent = subject.subject_name;
      container.appendChild(heading);

      for (const entry of sheets) {
        const { base, sheetSummary, submitted } = entry;
        const times = sheetSummary ? sheetSummary.times : 1;
        const cached = summaries[sheetSummaryId(base.id, times)];
        const status = statusLabel(sheetSummary, cached);
        const overdue = submitted ? null : overdueLevel(base, now);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "es-list-item";
        btn.dataset.baseSheetId = String(base.id);
        // 下書き途中の回は目に留まるようにする
        if (!submitted && (cached || sheetSummary)) btn.classList.add("current");
        if (overdue === "final") btn.classList.add("overdue-final");
        else if (overdue === "std") btn.classList.add("overdue");

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
        if (overdue) {
          // 事実だけを書く。final が無い回は std の文言だけになる
          const overdueBadge = document.createElement("span");
          overdueBadge.className = `es-badge ${overdue === "final" ? "overdue-final" : "overdue"}`;
          overdueBadge.textContent =
            overdue === "final" ? "最終締切を過ぎています" : "標準締切を過ぎています";
          title.appendChild(overdueBadge);
        }
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

        btn.addEventListener("click", () => select(row, entry));
        container.appendChild(btn);
      }
    }

    container.scrollTop = keepTop;
  } catch (err) {
    opts.onError(err);
  }
}
