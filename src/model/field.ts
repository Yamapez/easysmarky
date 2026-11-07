import { AnswerType, type BaseSheetField } from "../api/types";
import { defaultAnswerTextValues, firstAnswerText } from "./answerText";

export interface EditableField {
  raw: BaseSheetField;
  /** kind===0(通常設問) かつ answer_type===Text の、easysmarkyでテキスト編集可能な設問か */
  isEditableText: boolean;
  /** kind===0 かつ answer_type===Choice(記号などの選択式)。選択肢が1つ以上あれば編集できる */
  isEditableChoice: boolean;
  /** 選択肢の一覧(normalizeChoices で正規化済み。選択式でなければ空) */
  choices: string[];
  /** 選択肢を選び直したか。選び直したら、保存時に既存の位置を使わず中央へ置き直す(公式の選択処理と同じ) */
  choiceEdited: boolean;
  /** 複数のテキストスタンプが既に存在する設問か(idx>=1が存在)。MVPでは追加編集はしない */
  hasExtraStamps: boolean;
  text: string;
  direction: number;
  fontSize: number;
  lineHeight: number;
  color: string;
}

/**
 * 選択肢を配列にそろえる。公式の生徒画面と同じく、文字列なら1文字ずつ回す。
 * 空の選択肢と重複は落とす(ボタンの対応づけを一意にするため。「無回答」は別に出す)。
 */
export function normalizeChoices(raw: BaseSheetField["choice_texts"] | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw.map((c) => String(c)) : typeof raw === "string" ? Array.from(raw) : [];
  return [...new Set(list.filter((c) => c !== ""))];
}

/**
 * easysmarkyで答えを入力できる設問か。テキスト設問、または選択肢のある選択式で、
 * かつ複数スタンプが無いもの。ここを唯一の判定にして、編集・進捗・照合・保存をそろえる。
 */
export function isEditableField(field: EditableField): boolean {
  return (field.isEditableText || field.isEditableChoice) && !field.hasExtraStamps;
}

export function createEditableField(raw: BaseSheetField): EditableField {
  const texts = raw.answer_texts ?? [];
  const primary = firstAnswerText(texts);
  const defaults = defaultAnswerTextValues();
  const choices = normalizeChoices(raw.choice_texts);

  return {
    raw,
    isEditableText: raw.kind === 0 && raw.answer_type === AnswerType.Text,
    isEditableChoice: raw.kind === 0 && raw.answer_type === AnswerType.Choice && choices.length > 0,
    choices,
    choiceEdited: false,
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
