// 端末共通の表示設定(ビューアの倍率・書字方向の既定値)。キー easysmarky:prefs。
// 生徒ごとの情報は入れない(共有端末で別の生徒の設定が混ざらないように)。
// 読み書きはどちらも例外を握りつぶす。保存できない環境では記憶しないだけで、表示は止めない。
import type { Direction } from "../api/types";

const KEY = "easysmarky:prefs";

export interface Prefs {
  v: 1;
  /** 手動で選んだ解答用紙ビューアの倍率。null は「記憶なし」(従来の自動の初期値を使う) */
  zoom: number | null;
  /** 手動で選んだ書字方向。答えが無い設問の既定値に使う。null は「記憶なし」 */
  direction: Direction | null;
  /**
   * 手書き・画像の解答がある回でも下書き保存してよいか(設定の項目)。既定は false(保存をブロック)。
   * 保存すると、その回の手書き・画像の解答が消えるおそれがある。端末共通なので、共有端末では次の人にも効く。
   */
  allowBinaryLoss: boolean;
}

/** 記憶してよい倍率の範囲(ビューアの ZOOM_STEPS の最小〜最大に合わせる) */
export const PREF_ZOOM_MIN = 1;
export const PREF_ZOOM_MAX = 4;

const DEFAULT_PREFS: Prefs = { v: 1, zoom: null, direction: null, allowBinaryLoss: false };

function sanitize(parsed: Partial<Prefs>): Prefs {
  const zoom =
    typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)
      && parsed.zoom >= PREF_ZOOM_MIN && parsed.zoom <= PREF_ZOOM_MAX
      ? parsed.zoom
      : null;
  const direction = parsed.direction === 1 || parsed.direction === 2 ? parsed.direction : null;
  // 古い版の値(項目なし)は false として読む。許可は明示的に true のときだけ効く
  const allowBinaryLoss = parsed.allowBinaryLoss === true;
  return { v: 1, zoom, direction, allowBinaryLoss };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return { ...DEFAULT_PREFS };
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

const listeners = new Set<() => void>();

/** 設定が変わったことを知らせる購読。戻り値の関数で外す。開いている画面が、設定の変更をその場で反映するために使う */
export function onPrefsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 指定した項目だけ書き換える。他の項目は保つ。null を渡すとその項目の記憶を消す。
 * 戻り値は書けたかどうか。書けなければ、購読には知らせない(表示が「変わった」と誤認させないため)。
 */
export function updatePrefs(patch: Partial<Pick<Prefs, "zoom" | "direction" | "allowBinaryLoss">>): boolean {
  try {
    const next = sanitize({ ...loadPrefs(), ...patch });
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* 1つの購読の失敗で、他の画面への通知を止めない */
    }
  }
  return true;
}
