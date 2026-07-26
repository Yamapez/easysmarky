import { DEFAULT_FONT_FAMILY } from "./constants";
import { measureSingleChar, measureVertical } from "./measure";

export interface VerticalTextInput {
  text: string | null;
  font_size: number;
  line_height: number;
  color: string;
  font_family?: string;
}

const NEWLINE_RE = /\r\n|\r|\n/;

// app.js `ne` の記号ごとの回転/オフセット規則をそのまま移植したもの。
// 括弧・記号類は 90度回転して縦書きの向きに合わせる。
const BRACKET_LIKE_RE = /[「『（）＜＞【】〔〕≪≫＜＞～―…：；{}｛｝]/;
const CLOSING_BRACKET_RE = /[」』]/;
const DASH_LIKE_RE = /[-=ー＝]/;
const KUTEN_RE = /[。]/; // 句点
const TOUTEN_RE = /[、]/; // 読点
const HALFWIDTH_ALNUM_KANA_RE = /[A-Za-z0-9ｦ-ｯｱ-ﾝ]/;

/**
 * app.js の `ne` 相当。縦書きテキストを canvas に描画し、
 * "data:image/png;base64," を除いた base64 文字列を返す。
 */
export function renderVerticalText(field: VerticalTextInput, defaultText = "テキスト"): string {
  const text = field.text ? field.text : defaultText;
  const fontFamily = field.font_family || DEFAULT_FONT_FAMILY;
  const fontSize = Number(field.font_size);

  const size = measureVertical({
    text,
    fontSize,
    lineHeight: field.line_height,
    fontFamily,
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size.width);
  canvas.height = Math.ceil(size.height);
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.fillStyle = field.color;

  const lines = text.split(NEWLINE_RE);
  const columnPitch = size.width / lines.length;
  const ascent = measureSingleChar(fontSize, fontFamily).fontBoundingBoxAscent;

  let m = 0;
  for (let f = lines.length - 1; f >= 0; f--, m++) {
    const line = lines[f];
    const g = columnPitch * m; // 列(コラム)のx位置。最終行が右端(mが大きいほどgが大きい=右)。
    for (let v = 0; v < line.length; v++) {
      const ch = line.charAt(v);
      const next = line.charAt(v + 1);
      const w = ascent + fontSize * v; // 列内でのy位置

      if (ch === "！" || ch === "？") {
        if (next === "！" || next === "？") {
          ctx.fillText(ch, g - 0.25 * fontSize, w);
          ctx.fillText(next, g + 0.25 * fontSize, w);
          v += 1;
        } else {
          ctx.fillText(ch, g, w);
        }
      } else if (BRACKET_LIKE_RE.test(ch)) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.fillText(ch, w - 0.75 * fontSize, -g - 0.12 * fontSize);
        ctx.restore();
      } else if (CLOSING_BRACKET_RE.test(ch)) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.fillText(ch, w - 1 * fontSize, -g - 0.12 * fontSize);
        ctx.restore();
      } else if (DASH_LIKE_RE.test(ch)) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.fillText(ch, w - 0.75 * fontSize, -g - 0.2 * fontSize);
        ctx.restore();
      } else if (KUTEN_RE.test(ch)) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.fillText(ch, w - 0.8 * fontSize, -g - 0.75 * fontSize);
        ctx.restore();
      } else if (TOUTEN_RE.test(ch)) {
        ctx.fillText(ch, g + 0.6 * fontSize, w - 0.7 * fontSize);
      } else if (HALFWIDTH_ALNUM_KANA_RE.test(ch)) {
        const charWidth = ctx.measureText(ch).width;
        const centeredX = g + fontSize / 2 - charWidth / 2;
        ctx.fillText(ch, centeredX, w);
      } else {
        ctx.fillText(ch, g, w);
      }
    }
  }

  return canvas.toDataURL("image/png").replace("data:image/png;base64,", "");
}
