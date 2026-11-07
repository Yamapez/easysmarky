import { Direction } from "../api/types";
import type { EditableField } from "../model/field";
import { renderedText } from "../model/gridLayout";
import { measureText } from "./measure";
import { renderAnswerText } from "./renderText";

/**
 * 解答欄に描く文字の配置。座標は用紙の絶対座標(rim と同じ base_sheet 座標系)。
 * png は保存されるものと同じ描画結果(base64、"data:image/png;base64," は含まない)。
 */
export interface AnswerTextLayout {
  png: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 設問ごとに直前の結果を覚える。入力のたびに PNG を作り直さないため。件数は上限で打ち切る(複数の回答用紙を開いても膨らまない) */
const lastLayouts = new Map<number, { key: string; layout: AnswerTextLayout }>();
const MAX_CACHED_LAYOUTS = 64;

/**
 * 文字の大きさから、切り出し原点(rim − cut_margin)からの相対位置を出す(中央配置)。
 * 保存時(model/toParam.ts の buildAnswerText)と解答用紙ビューアの両方がこれを使う。
 */
export function stampOffsetInCut(
  rimWidth: number,
  rimHeight: number,
  cutMargin: number,
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: (rimWidth + 2 * cutMargin - size.width) / 2,
    y: (rimHeight + 2 * cutMargin - size.height) / 2,
  };
}

/**
 * マス目に合わせたときの配置。切り出し原点(rim − cut_margin)からの相対位置で返す
 * (stampOffsetInCut と同じ座標系。保存される x,y もこの座標系)。
 * 縦書きは右上のマスから、横書きは左上のマスから文字が始まるように置く。
 * 縦書きは1行目が右端の列に来る(公式の描画順)ので、ブロックの右端を rim の右端に合わせる。
 */
export function gridStampOrigin(
  rim: [number, number, number, number],
  direction: number,
  size: { width: number; height: number },
  cutMargin: number,
): { x: number; y: number } {
  const rimW = rim[2];
  if (direction === Direction.Vertical) {
    return { x: rimW + cutMargin - size.width, y: cutMargin };
  }
  return { x: cutMargin, y: cutMargin };
}

/**
 * 入力テキストを解答欄に置いたときの配置と PNG を返す。
 * 解答用紙プレビュー(fieldEditor)と、解答用紙ビューアの重ね描き(pageViewer)で同じ結果に
 * なるよう、ここを唯一の出所にする。マス目に合わせていない設問は中央に置く(保存時の新規入力と同じ式)。
 * マス目に合わせた設問は gridStampOrigin で置く(保存時の buildAnswerText も同じ関数を使う)。
 * 下書きを再開した設問は、保存時は既存の x,y を引き継ぐので、ここの位置と保存結果が少しずれることがある。
 * 文字が無い・大きさ0のときは null(描かない)。
 */
export function layoutAnswerText(field: EditableField, cutMargin: number): AnswerTextLayout | null {
  const [rimX, rimY, rimW, rimH] = field.raw.rim;
  const text = renderedText(field);
  const key = [
    text,
    field.direction,
    field.fontSize,
    field.lineHeight,
    field.color,
    field.gridPerLine ?? "-",
    cutMargin,
    rimX,
    rimY,
    rimW,
    rimH,
  ].join("\u0000");

  const cached = lastLayouts.get(field.raw.id);
  if (cached && cached.key === key) return cached.layout;

  if (!text.trim()) {
    lastLayouts.delete(field.raw.id);
    return null;
  }
  const size = measureText({
    text,
    fontSize: field.fontSize,
    lineHeight: field.lineHeight,
    direction: field.direction as typeof Direction.Horizon,
  });
  if (size.width <= 0 || size.height <= 0) {
    lastLayouts.delete(field.raw.id);
    return null;
  }

  // 切り出し原点 (rim − cut_margin) からの相対座標を、用紙の絶対座標に直したもの
  const offset = field.gridPerLine != null
    ? gridStampOrigin(field.raw.rim, field.direction, size, cutMargin)
    : stampOffsetInCut(rimW, rimH, cutMargin, size);
  const x = rimX - cutMargin + offset.x;
  const y = rimY - cutMargin + offset.y;
  const png = renderAnswerText({
    text,
    width: size.width,
    height: size.height,
    font_size: field.fontSize,
    line_height: field.lineHeight,
    color: field.color,
    direction: field.direction,
  });
  const layout: AnswerTextLayout = { png, x, y, width: size.width, height: size.height };
  lastLayouts.delete(field.raw.id);
  lastLayouts.set(field.raw.id, { key, layout });
  // Map は挿入順なので、先頭(最も古く触った設問)から捨てる
  while (lastLayouts.size > MAX_CACHED_LAYOUTS) {
    const oldest = lastLayouts.keys().next().value;
    if (oldest === undefined) break;
    lastLayouts.delete(oldest);
  }
  return layout;
}
