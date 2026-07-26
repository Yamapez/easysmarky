import { Direction } from "../api/types";
import { renderHorizontalText, type HorizontalTextInput } from "./textHorizontal";
import { renderVerticalText, type VerticalTextInput } from "./textVertical";

export type RenderableAnswerText = HorizontalTextInput &
  VerticalTextInput & {
    direction: number;
  };

/**
 * app.js の `ee` 相当。direction に応じて横書き/縦書きレンダラへ振り分ける。
 * 戻り値は "data:image/png;base64," を含まない base64 文字列。
 */
export function renderAnswerText(field: RenderableAnswerText, defaultText = "テキスト"): string {
  if (field.direction === Direction.Horizon) {
    return renderHorizontalText(field, defaultText);
  }
  return renderVerticalText(field, defaultText);
}
