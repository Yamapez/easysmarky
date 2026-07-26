export interface FieldBackup {
  text: string;
  direction: number;
  fontSize: number;
  lineHeight: number;
  color: string;
}

export type SheetBackup = Record<number, FieldBackup>;

function backupKey(studentCode: string, baseSheetId: number, times: number): string {
  return `easysmarky:${studentCode}:${baseSheetId}:${times}`;
}

export function loadBackup(studentCode: string, baseSheetId: number, times: number): SheetBackup | null {
  try {
    const raw = localStorage.getItem(backupKey(studentCode, baseSheetId, times));
    return raw ? (JSON.parse(raw) as SheetBackup) : null;
  } catch {
    return null;
  }
}

export function saveBackup(
  studentCode: string,
  baseSheetId: number,
  times: number,
  data: SheetBackup,
): void {
  try {
    localStorage.setItem(backupKey(studentCode, baseSheetId, times), JSON.stringify(data));
  } catch {
    // localStorageが使えない環境(プライベートモード等の容量制限)は無視する
  }
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let timer: number | undefined;
  return (...args: Args) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), waitMs);
  };
}
