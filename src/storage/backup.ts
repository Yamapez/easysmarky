export interface FieldBackup {
  text: string;
  direction: number;
  fontSize: number;
  lineHeight: number;
  color: string;
}

export type SheetBackup = Record<number, FieldBackup>;

/** localStorage から読んだ下書き。savedAt は旧形式(v0.5.0以前)には無いので null になりうる */
export interface LoadedBackup {
  fields: SheetBackup;
  savedAt: number | null;
}

/** 一覧画面で「3/8」「手書きあり・保存不可」を出すための、一度開いたことのある回の要約 */
export interface SheetSummary {
  /** easysmarkyで扱う設問数 */
  total: number;
  /** 入力済みの設問数 */
  filled: number;
  /** checkSaveGuard が保存をブロックする回か */
  blocked: boolean;
  savedAt: number;
}

export type SheetSummaries = Record<string, SheetSummary>;

interface StoredBackupV2 {
  v: 2;
  savedAt: number;
  fields: SheetBackup;
}

function backupKey(studentCode: string, baseSheetId: number, times: number): string {
  return `easysmarky:${studentCode}:${baseSheetId}:${times}`;
}

function summaryKey(studentCode: string): string {
  return `easysmarky:summary:${studentCode}`;
}

/** 一覧のサマリを引くキー。baseSheetId と times の組で1回分を指す */
export function sheetSummaryId(baseSheetId: number, times: number): string {
  return `${baseSheetId}:${times}`;
}

export function loadBackup(studentCode: string, baseSheetId: number, times: number): LoadedBackup | null {
  try {
    const raw = localStorage.getItem(backupKey(studentCode, baseSheetId, times));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredBackupV2 | SheetBackup;
    if (!parsed || typeof parsed !== "object") return null;
    // v0.5.0 以前は { [fieldId]: FieldBackup } を直接入れていた。保存日時は分からない
    if ((parsed as StoredBackupV2).v === 2) {
      const stored = parsed as StoredBackupV2;
      return { fields: stored.fields ?? {}, savedAt: stored.savedAt ?? null };
    }
    return { fields: parsed as SheetBackup, savedAt: null };
  } catch {
    return null;
  }
}

/** 書けたら true。false なら呼び出し側がこの端末に残っていないことを利用者に伝える */
export function saveBackup(
  studentCode: string,
  baseSheetId: number,
  times: number,
  data: SheetBackup,
  savedAt: number = Date.now(),
): boolean {
  try {
    const stored: StoredBackupV2 = { v: 2, savedAt, fields: data };
    localStorage.setItem(backupKey(studentCode, baseSheetId, times), JSON.stringify(stored));
    return true;
  } catch {
    // localStorageが使えない環境(プライベートモード・容量超過など)。黙って失敗させず false を返す
    return false;
  }
}

export function clearBackup(studentCode: string, baseSheetId: number, times: number): void {
  try {
    localStorage.removeItem(backupKey(studentCode, baseSheetId, times));
  } catch {
    // 消せなくても実害は無い(復元バーが出なくなるだけ)
  }
}

/** 復元の提示が残っている古い下書きを退避しておくキー。下書きとは別で、自動保存の対象にしない */
function archiveKey(studentCode: string, baseSheetId: number, times: number): string {
  return `easysmarky:archive:${studentCode}:${baseSheetId}:${times}`;
}

/**
 * 古い下書きを、上書きされる前に退避する。退避先が既にあれば残す(最初の古い下書きを優先する)。
 * 退避できなければ false。呼び出し側は、退避できないうちは下書きを上書きしない。
 */
export function archiveBackupOnce(studentCode: string, baseSheetId: number, times: number): boolean {
  try {
    const current = localStorage.getItem(backupKey(studentCode, baseSheetId, times));
    if (current === null) return true; // 退避するものが無い
    const key = archiveKey(studentCode, baseSheetId, times);
    if (localStorage.getItem(key) === null) localStorage.setItem(key, current);
    return true;
  } catch {
    return false;
  }
}

export function clearArchive(studentCode: string, baseSheetId: number, times: number): void {
  try {
    localStorage.removeItem(archiveKey(studentCode, baseSheetId, times));
  } catch {
    // 消せなくても実害は無い
  }
}

/**
 * 一覧に出す進捗の元データ。
 * 一覧APIは設問を返さないため、一度開いた回の要約をここに残しておき、次からの一覧に出す。
 */
export function loadSheetSummaries(studentCode: string): SheetSummaries {
  try {
    const raw = localStorage.getItem(summaryKey(studentCode));
    const parsed = raw ? (JSON.parse(raw) as SheetSummaries) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 書けたら true。起動直後の書き込み可否の確認にも使う(下書きは書かずに済ませるため) */
export function saveSheetSummary(
  studentCode: string,
  baseSheetId: number,
  times: number,
  summary: SheetSummary,
): boolean {
  try {
    const all = loadSheetSummaries(studentCode);
    all[sheetSummaryId(baseSheetId, times)] = summary;
    localStorage.setItem(summaryKey(studentCode), JSON.stringify(all));
    return true;
  } catch {
    // 進捗表示が出なくなるだけ。呼び出し側は、書けなかったことを警告の判断材料にする
    return false;
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
