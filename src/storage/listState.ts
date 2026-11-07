// 一覧の「続きから」用に、前回開いた回を端末に残す。キー easysmarky:last:{studentCode}。
// 生徒ごとのキーにして、共有端末で別の生徒の回が出ないようにする。
// 読み書きはどちらも例外を握りつぶす。保存できない環境では「続きから」が出ないだけで、一覧は止めない。

const KEY_PREFIX = "easysmarky:last:";

export interface LastSheet {
  v: 1;
  baseSheetId: number;
  /** 保存時の値。一覧で再開するときは一覧APIの値を優先する(ここは表示にだけ使わない) */
  times: number;
  subjectCode: string;
  subjectName: string;
  nendo: number;
  reportNo: number;
  openedAt: number;
}

/** 保存に必要な項目だけ。SelectedSheet をそのまま渡せる */
export interface LastSheetInput {
  baseSheetId: number;
  times: number;
  subjectCode: string;
  subjectName: string;
  nendo: number;
  reportNo: number;
}

function keyFor(studentCode: string): string {
  return `${KEY_PREFIX}${studentCode}`;
}

function isLastSheet(value: unknown): value is LastSheet {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<LastSheet>;
  return (
    v.v === 1 &&
    typeof v.baseSheetId === "number" &&
    typeof v.times === "number" &&
    typeof v.subjectCode === "string" &&
    typeof v.subjectName === "string" &&
    typeof v.nendo === "number" &&
    typeof v.reportNo === "number"
  );
}

export function loadLastSheet(studentCode: string): LastSheet | null {
  try {
    const raw = localStorage.getItem(keyFor(studentCode));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isLastSheet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLastSheet(studentCode: string, sheet: LastSheetInput): void {
  try {
    const record: LastSheet = {
      v: 1,
      baseSheetId: sheet.baseSheetId,
      times: sheet.times,
      subjectCode: sheet.subjectCode,
      subjectName: sheet.subjectName,
      nendo: sheet.nendo,
      reportNo: sheet.reportNo,
      openedAt: Date.now(),
    };
    localStorage.setItem(keyFor(studentCode), JSON.stringify(record));
  } catch {
    // 保存できない環境では「続きから」が出ないだけ
  }
}
