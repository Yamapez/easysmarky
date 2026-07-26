import { Direction, type AnswerText } from "../api/types";
import { DEFAULT_COLOR, DEFAULT_FONT_SIZE, DEFAULT_LINE_HEIGHT } from "../render/constants";

/**
 * 新規テキスト解答(既存の下書きが無い設問にユーザーが初めて入力する場合)の
 * 既定値。app.js の新規スタンプ作成(関数 N)のデフォルトに合わせる。
 */
export function defaultAnswerTextValues() {
  return {
    fontSize: DEFAULT_FONT_SIZE,
    lineHeight: DEFAULT_LINE_HEIGHT,
    color: DEFAULT_COLOR,
    direction: Direction.Horizon,
  };
}

export function firstAnswerText(texts: AnswerText[] | undefined): AnswerText | undefined {
  return texts && texts.length > 0 ? texts[0] : undefined;
}
