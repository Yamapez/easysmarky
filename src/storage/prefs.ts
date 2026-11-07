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
}

/** 記憶してよい倍率の範囲(ビューアの ZOOM_STEPS の最小〜最大に合わせる) */
export const PREF_ZOOM_MIN = 1;
export const PREF_ZOOM_MAX = 4;

const DEFAULT_PREFS: Prefs = { v: 1, zoom: null, direction: null };

function sanitize(parsed: Partial<Prefs>): Prefs {
  const zoom =
    typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)
      && parsed.zoom >= PREF_ZOOM_MIN && parsed.zoom <= PREF_ZOOM_MAX
      ? parsed.zoom
      : null;
  const direction = parsed.direction === 1 || parsed.direction === 2 ? parsed.direction : null;
  return { v: 1, zoom, direction };
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

/** 指定した項目だけ書き換える。他の項目は保つ。null を渡すとその項目の記憶を消す */
export function updatePrefs(patch: Partial<Pick<Prefs, "zoom" | "direction">>): void {
  try {
    const next = sanitize({ ...loadPrefs(), ...patch });
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 保存できない環境では記憶しないだけ */
  }
}
