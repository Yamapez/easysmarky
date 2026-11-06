import type { SheetSize } from "./sheetGeometry";

/** 解答用紙の座標系(rim と同じ)での矩形 */
export interface SheetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 読むモードの窓の余白。用紙の幅(左右)・高さ(上下)に対する割合。
 *
 * 国語の問題文は解答欄の**右側**に縦書きで印字されている(実機で確認)。そのため右を広く取り、
 * 左は次の解答欄に入りやすいので狭くする。値は実機の用紙で確かめながら調整する。
 * 窓が合わないときは「ページ全体」に切り替えられるので、ここは多少ずれても致命的ではない。
 */
export const READING_WINDOW_MARGIN = {
  left: 0.03,
  right: 0.3,
  top: 0.05,
  bottom: 0.05,
} as const;

/**
 * 解答欄(rim)の周りに、読むための窓を切り出す範囲を求める。
 * 用紙の外へ出る分は詰める(クランプ)。戻り値は必ず用紙の内側に収まる。
 */
export function readingWindowRect(rim: [number, number, number, number], sheet: SheetSize): SheetRect {
  const [x, y, w, h] = rim;
  const m = READING_WINDOW_MARGIN;
  const left = Math.max(0, x - m.left * sheet.width);
  const top = Math.max(0, y - m.top * sheet.height);
  const right = Math.min(sheet.width, x + w + m.right * sheet.width);
  const bottom = Math.min(sheet.height, y + h + m.bottom * sheet.height);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
