import { DEFAULT_FONT_FAMILY, LINE_SPACING_FACTOR } from "./constants";

export interface HorizontalTextInput {
  text: string | null;
  width: number;
  height: number;
  font_size: number;
  line_height: number;
  color: string;
  font_family?: string;
}

/**
 * app.js の `te` 相当。横書きテキストを canvas に描画し、
 * "data:image/png;base64," を除いた base64 文字列を返す。
 */
export function renderHorizontalText(field: HorizontalTextInput, defaultText = "テキスト"): string {
  const text = field.text ? field.text : defaultText;
  const canvas = document.createElement("canvas");
  canvas.width = field.width;
  canvas.height = field.height;
  const ctx = canvas.getContext("2d")!;
  const fontFamily = field.font_family || DEFAULT_FONT_FAMILY;
  ctx.font = `${field.font_size}px ${fontFamily}`;
  ctx.fillStyle = field.color;

  let baseline = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    baseline += i === 0 ? Number(field.font_size) : Number(field.font_size) * LINE_SPACING_FACTOR;
    ctx.fillText(lines[i], 0, baseline);
    baseline += Number(field.line_height);
  }
  return canvas.toDataURL("image/png").replace("data:image/png;base64,", "");
}
