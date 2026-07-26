import { Direction, type Direction as DirectionType } from "../api/types";
import { DEFAULT_FONT_FAMILY, LINE_SPACING_FACTOR, type Size } from "./constants";

/**
 * app.js の app と同じ、Smarky公式アプリの改行分割規則(\r\n|\r|\n)。
 */
const NEWLINE_RE = /\r\n|\r|\n/;

export function countLines(text: string): number {
  return text.split(NEWLINE_RE).length;
}

export function maxLineLength(text: string): number {
  return text.split(NEWLINE_RE).reduce((max, line) => (line.length > max ? line.length : max), 0);
}

/**
 * app.js の `ae` 相当。"あ"1文字の TextMetrics を取得し、縦書きの
 * 文字送り幅(fontBoundingBoxAscent)算出に使う。
 */
export function measureSingleChar(fontSize: number, fontFamily: string = DEFAULT_FONT_FAMILY): TextMetrics {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontSize}px ${fontFamily}`;
  return ctx.measureText("あ");
}

export interface MeasureHorizontalParams {
  text: string;
  fontSize: number;
  lineHeight: number;
  fontFamily?: string;
}

/**
 * app.js の `$` 相当。横書きテキストの描画サイズを計測する。
 */
export function measureHorizontal(params: MeasureHorizontalParams): Size {
  const { text, fontSize, lineHeight, fontFamily = DEFAULT_FONT_FAMILY } = params;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontSize}px ${fontFamily}`;

  let width = 0;
  let height = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const measured = ctx.measureText(lines[i]);
    width = measured.width > width ? measured.width : width;
    height += Number(fontSize) * LINE_SPACING_FACTOR;
    height += i === lines.length - 1 ? 0 : Number(lineHeight);
  }
  height += Number(fontSize) * (LINE_SPACING_FACTOR - 1);
  return { width, height };
}

export interface MeasureVerticalParams {
  text: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  fontFamily?: string;
}

/**
 * app.js の `ie` 相当。縦書きテキストの描画サイズを計測する。
 * lineHeight は「列(改行区切り)間の余白」として幅計算に使われる。
 */
export function measureVertical(params: MeasureVerticalParams): Size {
  const {
    text,
    fontSize,
    lineHeight,
    letterSpacing = 0,
    fontFamily = DEFAULT_FONT_FAMILY,
  } = params;
  const charMetrics = measureSingleChar(fontSize, fontFamily);
  const effectiveText = text || "クリックして解答を入力してください。";
  const numLines = countLines(effectiveText);
  const maxLen = maxLineLength(effectiveText);
  const width = (charMetrics.width + lineHeight) * numLines;
  const height = (fontSize + letterSpacing) * maxLen + (fontSize / 32) * 10;
  return { width, height };
}

export interface MeasureTextParams {
  text: string | null;
  fontSize: number;
  lineHeight?: number;
  direction?: DirectionType;
  defaultText?: string;
  fontFamily?: string;
}

/**
 * app.js の `X` 相当。direction に応じて横書き/縦書きの計測関数へ振り分ける。
 */
export function measureText(params: MeasureTextParams): Size {
  const {
    fontSize,
    lineHeight = 0,
    direction = Direction.Horizon,
    defaultText = "テキスト",
    fontFamily = DEFAULT_FONT_FAMILY,
  } = params;
  const text = params.text || defaultText;

  if (direction === Direction.Horizon) {
    return measureHorizontal({ text, fontSize, lineHeight, fontFamily });
  }
  return measureVertical({ text, fontSize, lineHeight, fontFamily });
}
