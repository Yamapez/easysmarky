import {
  Direction,
  type AnswerText,
  type ParamAnswerText,
  type ParamBaseSheetField,
} from "../api/types";
import { gridStampOrigin, stampOffsetInCut } from "../render/answerLayout";
import { measureText } from "../render/measure";
import { renderAnswerText } from "../render/renderText";
import { renderedText } from "./gridLayout";
import { fieldHasBinaryContent, isEditableField, type EditableField } from "./field";

export interface SaveGuardResult {
  blocked: boolean;
  reason?: string;
}

export interface SaveGuardOptions {
  /**
   * 利用者が「この回の手書き・画像の解答が保存で消えてもよい」と明示的に同意したとき true。
   * 既定は false(従来どおりブロック)。値は端末共通の設定(easysmarky:prefs)から来る。
   * その設定は保存され、次に開く画面や共有端末の次の利用者にも効く。
   */
  allowBinaryLoss?: boolean;
}

/**
 * 手書き・画像解答(answer_images / base64_canvas)がシート内に1つでも存在する場合は
 * 保存をブロックする。GET APIがこれらの画像バイナリを再取得可能な形で返すかどうかを
 * 実機で確認できていないため、誤って消してしまうリスクを避けるための安全策。
 * 既定はブロックのまま。利用者の同意(allowBinaryLoss)があるときだけ通すが、
 * 送る直前に手書きが増えていないかは save/save.ts で別に確かめる。
 */
export function checkSaveGuard(
  fields: { raw: EditableField["raw"] }[],
  opts: SaveGuardOptions = {},
): SaveGuardResult {
  const hasBinary = fields.some((f) => fieldHasBinaryContent(f.raw));
  if (!hasBinary || opts.allowBinaryLoss) {
    return { blocked: false };
  }
  return {
    blocked: true,
    reason:
      "この回答用紙には手書き・画像の解答が含まれています。現バージョンのeasysmarkyは、それらの解答が消えてしまう事故を防ぐため保存を無効化しています。右上の「設定」で許可すると保存できます(手書き・画像の解答が消えるおそれがあります)。公式のSmarky画面から保存することもできます。",
  };
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
  /**
   * 選択式の「無回答」(text が空)。公式 app.js の選択処理と同じく、1x1 のスタンプとして送り、
   * PNG は既定の「テキスト」を使わず空文字で描く(公式の ce(n,"") に相当)
   */
  blankChoice?: boolean;
  /** マス目に合わせて置く(新規のみ。既存の x,y は引き継がない) */
  alignToGrid?: boolean;
}

function buildAnswerText(
  draft: AnswerTextDraft,
  fieldId: number,
  rim: [number, number, number, number],
  cutMargin: number,
): { meta: ParamAnswerText; zipEntry: BuiltZipEntry | null } {
  // measureText は空文字を「テキスト」として計測するので、無回答は 1x1 を直接使う
  const size = draft.blankChoice
    ? { width: 1, height: 1 }
    : measureText({
        text: draft.text,
        fontSize: draft.fontSize,
        lineHeight: draft.lineHeight,
        direction: draft.direction as typeof Direction.Horizon,
      });

  const hasExistingPosition = draft.existingX != null && draft.existingY != null;
  let x: number;
  let y: number;
  if (draft.alignToGrid) {
    // 解答欄プレビューと同じ配置(answerLayout.gridStampOrigin)。切り出し原点からの相対座標
    const origin = gridStampOrigin(rim, draft.direction, size, cutMargin);
    x = origin.x;
    y = origin.y;
  } else {
    const centered = stampOffsetInCut(rim[2], rim[3], cutMargin, size);
    x = hasExistingPosition ? (draft.existingX as number) : centered.x;
    y = hasExistingPosition ? (draft.existingY as number) : centered.y;
  }

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
  if (draft.blankChoice) {
    // 無回答でも ZIP には入れる。以前の選択の PNG が残らないよう、空の画像で上書きする
    const png = renderAnswerText(
      {
        text: "",
        width: size.width,
        height: size.height,
        font_size: draft.fontSize,
        line_height: draft.lineHeight,
        color: draft.color,
        direction: draft.direction,
      },
      "",
    );
    zipEntry = { filename: `answer_text_${fieldId}_${draft.idx}.png`, base64: png };
  } else if (trimmed && size.width > 0 && size.height > 0) {
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
  const existingTexts: AnswerText[] = raw.answer_texts ?? [];
  // マス目に合わせた改行を入れた本文(入力欄の text は変えない)。マス目が無ければ text そのもの
  const text = renderedText(field);

  const zipEntries: BuiltZipEntry[] = [];
  const answerTexts: ParamAnswerText[] = [];

  // 選択式は、編集可能なとき(複数スタンプでない)だけ選択として扱う。複数スタンプの設問は既存のまま送る
  const choiceEditable = field.isEditableChoice && isEditableField(field);

  existingTexts.forEach((t, i) => {
    const isPrimaryEditable = i === 0 && (field.isEditableText || choiceEditable);
    // 選択式は、選び直したとき(または文字が変わったとき)だけ中央に置き直す(公式の選択処理と同じ)。
    // 触っていなければ既存の位置・大きさをそのまま送る
    const choiceChanged = choiceEditable && (field.choiceEdited || field.text !== (t.text ?? ""));
    const draft: AnswerTextDraft = isPrimaryEditable
      ? {
          id: t.id,
          idx: t.idx ?? 0,
          text,
          fontSize: field.fontSize,
          lineHeight: field.lineHeight,
          color: field.color,
          direction: field.direction,
          existingX: choiceChanged ? null : t.x,
          existingY: choiceChanged ? null : t.y,
          blankChoice: choiceEditable && field.text === "",
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

    const { meta, zipEntry } = buildAnswerText(draft, raw.id, raw.rim, cutMargin);
    answerTexts.push(meta);
    if (zipEntry) zipEntries.push(zipEntry);
  });

  // 元々テキストが存在しなかった設問に、ユーザーが新規入力した場合(選択式は選んだときだけ作る)
  if ((field.isEditableText || field.isEditableChoice) && existingTexts.length === 0 && text.trim()) {
    const draft: AnswerTextDraft = {
      id: null,
      idx: 0,
      text,
      fontSize: field.fontSize,
      lineHeight: field.lineHeight,
      color: field.color,
      direction: field.direction,
      alignToGrid: field.gridPerLine != null,
    };
    const { meta, zipEntry } = buildAnswerText(draft, raw.id, raw.rim, cutMargin);
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
