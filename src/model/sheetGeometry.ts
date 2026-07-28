import type { BaseSheet } from "../api/types";
import { pageArrayIndex } from "../ui/pageViewer";

/** rim の座標系のサイズ。1ページぶん */
export interface SheetSize {
  width: number;
  height: number;
}

/**
 * `[w1,h1,w2,h2,...]` のフラット配列から、添字 index のページのサイズを取り出す。
 * 値が無い・0以下なら null(呼び出し側は「座標系が分からない」として扱う)。
 */
function sizeAt(flat: number[] | null | undefined, index: number): SheetSize | null {
  if (!flat) return null;
  const width = flat[index * 2];
  const height = flat[index * 2 + 1];
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/**
 * base_sheet_field.page に対応する解答用紙ページの座標系サイズ。
 *
 * ページ番号が0始まりか1始まりかは実機で確認できていないため、画像配列に対する
 * 解決規則(pageArrayIndex)をそのまま使う。座標系のページ数と画像のページ数は
 * 一致する前提(実機では correct_image_size の要素数 = page_count × 2 だった)。
 */
export function answerPageSize(
  sheet: BaseSheet | null | undefined,
  answerImages: string[],
  page: number,
): SheetSize | null {
  if (!sheet) return null;
  return sizeAt(sheet.correct_image_size, pageArrayIndex(answerImages, page));
}

/** 問題ページ側。実機では問題ページ画像を持つレポートが1件も無く、未確認 */
export function questionPageSize(
  sheet: BaseSheet | null | undefined,
  questionImages: string[],
  page: number,
): SheetSize | null {
  if (!sheet) return null;
  return sizeAt(sheet.question_image_size, pageArrayIndex(questionImages, page));
}

/** 画像配列の添字から直接引く(ビューアのように「いま何ページ目か」で持つ側から使う) */
export function answerPageSizeByIndex(
  sheet: BaseSheet | null | undefined,
  index: number,
): SheetSize | null {
  if (!sheet) return null;
  return sizeAt(sheet.correct_image_size, index);
}
