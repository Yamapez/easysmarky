import {
  Direction,
  type AnswerText,
  type ParamAnswerText,
  type ParamBaseSheetField,
} from "../api/types";
import { measureText } from "../render/measure";
import { renderAnswerText } from "../render/renderText";
import { fieldHasBinaryContent, type EditableField } from "./field";

export interface SaveGuardResult {
  blocked: boolean;
  reason?: string;
}

/**
 * 手書き・画像解答(answer_images / base64_canvas)がシート内に1つでも存在する場合は
 * 保存をブロックする。GET APIがこれらの画像バイナリを再取得可能な形で返すかどうかを
 * 実機で確認できていないため、誤って消してしまうリスクを避けるための安全策。
 */
export function checkSaveGuard(fields: { raw: EditableField["raw"] }[]): SaveGuardResult {
  const hasBinaryContent = fields.some((f) => fieldHasBinaryContent(f.raw));
  if (hasBinaryContent) {
    return {
      blocked: true,
      reason:
        "この回答用紙には手書き・画像の解答が含まれています。現バージョンのeasysmarkyは、それらの解答が消えてしまう事故を防ぐため保存を無効化しています。お手数ですが公式のSmarky画面から保存してください。",
    };
  }
  return { blocked: false };
}

export interface BuiltZipEntry {
  filename: string;
  /** "data:image/png;base64," を含まない base64 文字列 */
  base64: string;
}

export interface BuildFieldResult {
  param: ParamBaseSheetField;
  zipEntries: BuiltZipEntry[];
}

interface AnswerTextDraft {
  id: number | null;
  idx: number;
  text: string;
  fontSize: number;
  lineHeight: number;
  color: string;
  direction: number;
  /** 既存のx,y(移動させない)。未指定(新規)ならフィールド中央に配置する */
  existingX?: number | null;
  existingY?: number | null;
}

function buildAnswerText(
  draft: AnswerTextDraft,
  fieldId: number,
  rimWidth: number,
  rimHeight: number,
  cutMargin: number,
): { meta: ParamAnswerText; zipEntry: BuiltZipEntry | null } {
  const size = measureText({
    text: draft.text,
    fontSize: draft.fontSize,
    lineHeight: draft.lineHeight,
    direction: draft.direction as typeof Direction.Horizon,
  });

  const hasExistingPosition = draft.existingX != null && draft.existingY != null;
  const x = hasExistingPosition ? (draft.existingX as number) : (rimWidth + 2 * cutMargin - size.width) / 2;
  const y = hasExistingPosition ? (draft.existingY as number) : (rimHeight + 2 * cutMargin - size.height) / 2;

  const meta: ParamAnswerText = {
    id: draft.id,
    base_sheet_field_id: fieldId,
    text: draft.text,
    idx: draft.idx,
    font_size: draft.fontSize,
    line_height: draft.lineHeight,
    color: draft.color,
    x,
    y,
    width: size.width,
    height: size.height,
    direction: draft.direction as typeof Direction.Horizon,
  };

  const trimmed = draft.text.trim();
  let zipEntry: BuiltZipEntry | null = null;
  if (trimmed && size.width > 0 && size.height > 0) {
    const png = renderAnswerText({
      text: draft.text,
      width: size.width,
      height: size.height,
      font_size: draft.fontSize,
      line_height: draft.lineHeight,
      color: draft.color,
      direction: draft.direction,
    });
    zipEntry = { filename: `answer_text_${fieldId}_${draft.idx}.png`, base64: png };
  }

  return { meta, zipEntry };
}

/**
 * app.js の `Do`/`ye` 相当。編集済みフィールドを保存用の param 構造体 + ZIPエントリに変換する。
 * 既存の answer_texts はライブ編集していないものも含め、格納済みメタデータから
 * 都度PNGを再レンダリングして再送する(公式アプリと同じ「保存の度に再生成」方式)。
 */
export function buildFieldForSave(field: EditableField, cutMargin: number): BuildFieldResult {
  const raw = field.raw;
  const rimWidth = raw.rim[2];
  const rimHeight = raw.rim[3];
  const existingTexts: AnswerText[] = raw.answer_texts ?? [];

  const zipEntries: BuiltZipEntry[] = [];
  const answerTexts: ParamAnswerText[] = [];

  existingTexts.forEach((t, i) => {
    const isPrimaryEditable = i === 0 && field.isEditableText;
    const draft: AnswerTextDraft = isPrimaryEditable
      ? {
          id: t.id,
          idx: t.idx ?? 0,
          text: field.text,
          fontSize: field.fontSize,
          lineHeight: field.lineHeight,
          color: field.color,
          direction: field.direction,
          existingX: t.x,
          existingY: t.y,
        }
      : {
          id: t.id,
          idx: t.idx ?? i,
          text: t.text ?? "",
          fontSize: t.font_size ?? field.fontSize,
          lineHeight: t.line_height ?? field.lineHeight,
          color: t.color ?? field.color,
          direction: t.direction ?? Direction.Horizon,
          existingX: t.x,
          existingY: t.y,
        };

    const { meta, zipEntry } = buildAnswerText(draft, raw.id, rimWidth, rimHeight, cutMargin);
    answerTexts.push(meta);
    if (zipEntry) zipEntries.push(zipEntry);
  });

  // 元々テキストが存在しなかった設問に、ユーザーが新規入力した場合
  if (field.isEditableText && existingTexts.length === 0 && field.text.trim()) {
    const draft: AnswerTextDraft = {
      id: null,
      idx: 0,
      text: field.text,
      fontSize: field.fontSize,
      lineHeight: field.lineHeight,
      color: field.color,
      direction: field.direction,
    };
    const { meta, zipEntry } = buildAnswerText(draft, raw.id, rimWidth, rimHeight, cutMargin);
    answerTexts.push(meta);
    if (zipEntry) zipEntries.push(zipEntry);
  }

  const param: ParamBaseSheetField = {
    id: raw.id,
    page: raw.page,
    kind: raw.kind,
    field_name: raw.field_name,
    rim: raw.rim,
    correct_state: raw.correct_state,
    answer_texts: answerTexts,
    answer_images: (raw.answer_images ?? []).map((img) => ({
      id: img.id,
      base_sheet_field_id: img.base_sheet_field_id,
      idx: img.idx,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
    })),
  };

  return { param, zipEntries };
}
