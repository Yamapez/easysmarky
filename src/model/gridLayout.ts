import { Direction } from "../api/types";
import { measureSingleChar } from "../render/measure";
import { LINE_SPACING_FACTOR } from "../render/constants";
import type { RimGridCounts } from "../render/gridDetect";
import { defaultAnswerTextValues } from "./answerText";
import type { EditableField } from "./field";

/**
 * マス目に合わせたときの文字の設定。
 * 公式の描画は「文字の送り = fontSize」(縦)・「行送り = Z·fontSize + lineHeight」(横)で、字間は持てない。
 * そのため合わせられるのは fontSize と lineHeight と、1行に入れる文字数(perLine)だけ。
 */
export interface GridStyle {
  fontSize: number;
  lineHeight: number;
  /** 1行(縦書きなら1列)に入れる文字数 = 書字方向のマス数。超えた分は次の列・行へ送る */
  perLine: number;
}

/** 文字サイズの上限。マスが大きすぎる誤検出で極端な文字にならないための安全弁 */
export const MAX_GRID_FONT_SIZE = 96;
/** これより小さいと読めないので、マス目とみなさない */
export const MIN_GRID_FONT_SIZE = 8;

const NEWLINE_RE = /\r\n|\r|\n/;

/**
 * マス目に合わせた文字の設定を出す。マス目が無ければ null(従来どおり 32・中央に置く)。
 * 縦書き: 書字方向の寸法 = rows(行数)、交差方向 = cols(列数)。fontSize は2つのピッチの小さい方。
 *   文字の幅(ほぼ fontSize)が列からはみ出さないよう、列の幅で頭打ちにする。
 * 横書き: 書字方向 = cols、交差方向 = rows。行送りが列の高さに収まるよう、Z で割った値で頭打ちにする。
 * ピッチは rim の寸法を個数で割って決める(罫線の位置の小さなズレを使わず、解答欄の端にそろえる)。
 */
export function gridStyleFor(
  grid: RimGridCounts | null,
  rim: [number, number, number, number],
  direction: number,
): GridStyle | null {
  if (!grid) return null;
  const [, , w, h] = rim;
  if (!(w > 0) || !(h > 0)) return null;
  const vertical = direction === Direction.Vertical;
  const along = vertical ? grid.rows : grid.cols;
  if (along == null || along < 1) return null;
  const cross = (vertical ? grid.cols : grid.rows) ?? 1;
  const alongPitch = (vertical ? h : w) / along;
  const crossPitch = (vertical ? w : h) / cross;

  const fitted = vertical
    ? Math.min(alongPitch, crossPitch)
    : Math.min(alongPitch, crossPitch / LINE_SPACING_FACTOR);
  const fontSize = Math.min(MAX_GRID_FONT_SIZE, Math.floor(fitted));
  if (fontSize < MIN_GRID_FONT_SIZE) return null;

  // 縦書きの列幅は「あ」の幅 + lineHeight。横書きの行送りは Z·fontSize + lineHeight
  const lineHeight = vertical
    ? Math.max(0, crossPitch - measureSingleChar(fontSize).width)
    : Math.max(0, crossPitch - LINE_SPACING_FACTOR * fontSize);
  return {
    fontSize,
    // 切り捨てる(四捨五入すると行送りが行の高さを僅かに超える)
    lineHeight: Math.floor(lineHeight * 100) / 100,
    perLine: along,
  };
}

/**
 * 1行あたりの文字数で改行を入れる。利用者の改行はそのまま残し、各行をさらに区切る。
 * 計測・描画・保存・はみ出し判定はすべてこの結果を使う(入力欄の text は変えない)。
 */
export function wrapForGrid(text: string, perLine: number): string {
  if (!(perLine > 0)) return text;
  return text
    .split(NEWLINE_RE)
    .map((line) => {
      const chars = [...line];
      if (chars.length <= perLine) return line;
      const pieces: string[] = [];
      for (let i = 0; i < chars.length; i += perLine) pieces.push(chars.slice(i, i + perLine).join(""));
      return pieces.join("\n");
    })
    .join("\n");
}

/** 計測・描画・保存に使う、改行を入れた本文 */
export function renderedText(field: EditableField): string {
  return field.gridPerLine != null ? wrapForGrid(field.text, field.gridPerLine) : field.text;
}

/**
 * 検出したマス目を、設問の文字の設定へ反映する。
 * 既にサーバに答えがある設問は、既存の x,y と大きさを保つので触らない。
 * マス目が無くなった(または以前から無い)ときは、以前マス目で決めた値だけを既定に戻す。
 * 利用者が入力した後で既定値に戻すことはしない(gridPerLine が無い = 以前から手動の値)。
 */
export function applyGridStyle(field: EditableField): void {
  const hasServerAnswer = (field.raw.answer_texts ?? []).length > 0;
  if (!field.isEditableText || hasServerAnswer) {
    field.gridPerLine = null;
    return;
  }
  const style = gridStyleFor(field.grid, field.raw.rim, field.direction);
  if (!style) {
    if (field.gridPerLine != null) {
      const defaults = defaultAnswerTextValues();
      field.fontSize = defaults.fontSize;
      field.lineHeight = defaults.lineHeight;
    }
    field.gridPerLine = null;
    return;
  }
  field.fontSize = style.fontSize;
  field.lineHeight = style.lineHeight;
  field.gridPerLine = style.perLine;
}
