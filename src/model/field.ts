import { AnswerType, type BaseSheetField } from "../api/types";
import { defaultAnswerTextValues, firstAnswerText } from "./answerText";

export interface EditableField {
  raw: BaseSheetField;
  /** kind===0(通常設問) かつ answer_type===Text の、easysmarkyでテキスト編集可能な設問か */
  isEditableText: boolean;
  /** 複数のテキストスタンプが既に存在する設問か(idx>=1が存在)。MVPでは追加編集はしない */
  hasExtraStamps: boolean;
  text: string;
  direction: number;
  fontSize: number;
  lineHeight: number;
  color: string;
}

export function createEditableField(raw: BaseSheetField): EditableField {
  const texts = raw.answer_texts ?? [];
  const primary = firstAnswerText(texts);
  const defaults = defaultAnswerTextValues();

  return {
    raw,
    isEditableText: raw.kind === 0 && raw.answer_type === AnswerType.Text,
    hasExtraStamps: texts.length > 1,
    text: primary?.text ?? "",
    direction: primary?.direction ?? defaults.direction,
    fontSize: primary?.font_size ?? defaults.fontSize,
    lineHeight: primary?.line_height ?? defaults.lineHeight,
    color: primary?.color ?? defaults.color,
  };
}

/**
 * このフィールドの解答欄に既に手書き・画像データが存在するか。
 * 存在する場合、easysmarkyはこのシート全体の保存をブロックする(データ消失防止)。
 */
export function fieldHasBinaryContent(raw: BaseSheetField): boolean {
  return (raw.answer_images && raw.answer_images.length > 0) || !!raw.base64_canvas;
}
