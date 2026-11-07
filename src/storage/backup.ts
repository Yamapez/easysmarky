import type { RimGridCounts } from "../render/gridDetect";

/** 設問の編集できる値(テキストと書式) */
export interface FieldValues {
  text: string;
  direction: number;
  fontSize: number;
  lineHeight: number;
  color: string;
}

export interface FieldBackup extends FieldValues {
  /**
   * 下書きを書いた時点でサーバーが持っていた値(読み込み時、または直近の保存で送った値)。
   * 復元のとき「この端末で実際に触った設問」を見分けるのに使う。無いのは base を導入する前に書いた下書き。
   * v:2 のまま任意項目として足している(古い版が読んでも、この項目を無視するだけで壊れない)。
   */
  base?: FieldValues;
  /**
   * 解答欄のマス目の検出結果(v0.12.0 以降)。無い古い下書きは null 扱い。
   * 文字サイズ・改行はこれから決め直すので、ここだけ残せば復元後も同じ配置になる
   */
  grid?: RimGridCounts | null;
}

export type SheetBackup = Record<number, FieldBackup>;

/** localStorage から読んだ下書き。savedAt は旧形式(v0.5.0以前)には無いので null になりうる */
export interface LoadedBackup {
  fields: SheetBackup;
  savedAt: number | null;
}

/**
 * 要約の集計規則の版。何で「編集できる設問」と数えるかを変えたら上げる。
 * 版が違う要約は一覧に出さない(古い数字で「全設問入力済み」に見えるのを防ぐ。開き直すまで「—」)。
 * 1: 旧定義(answer_type の値がずれていたころ)。2: answer_type を公式どおりに数える。
 */
export const SUMMARY_RULES = 2;

/** 一覧画面で「3/8」「手書きあり・保存不可」を出すための、一度開いたことのある回の要約 */
export interface SheetSummary {
  /** 集計規則の版(SUMMARY_RULES)。省略された古い要約は読まない */
  rules: number;
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

/** 1回ぶんの下書きのキー。別タブで同じ回が書かれたかを見分けるため、外からも使えるように export する */
export function backupKey(studentCode: string, baseSheetId: number, times: number): string {
  return `easysmarky:${studentCode}:${baseSheetId}:${times}`;
}

/** 設問の値が、base(サーバーが持っていた値)から変わっているか。base が無ければ判断できないので false */
export function changedFromBase(entry: FieldBackup): boolean {
  const base = entry.base;
  if (!base) return false;
  return (
    entry.text !== base.text ||
    entry.direction !== base.direction ||
    entry.fontSize !== base.fontSize ||
    entry.lineHeight !== base.lineHeight ||
    entry.color !== base.color
  );
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
 * 上書きされる直前の下書きを退避する。退避先は、その時点の下書きで置き換える(画面に出ていた内容を残すため)。
 * 退避できなければ false。呼び出し側は、退避できないうちは下書きを上書きしない。
 */
export function archiveBackup(studentCode: string, baseSheetId: number, times: number): boolean {
  try {
    const current = localStorage.getItem(backupKey(studentCode, baseSheetId, times));
    if (current === null) return true; // 退避するものが無い
    localStorage.setItem(archiveKey(studentCode, baseSheetId, times), current);
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
    if (!parsed || typeof parsed !== "object") return {};
    // 版が違う(または版の無い)要約は捨てる。開き直すと新しい規則で書き直される
    const current: SheetSummaries = {};
    for (const [id, s] of Object.entries(parsed)) {
      if (s && s.rules === SUMMARY_RULES) current[id] = s;
    }
    return current;
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
): ((...args: Args) => void) & { cancel: () => void } {
  let timer: number | undefined;
  const run = (...args: Args) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };
  // 保留中の呼び出しを捨てる。保存が済んで下書きを消したあとに、古い内容で書き戻されないため
  run.cancel = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };
  return run;
}
