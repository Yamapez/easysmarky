import { ApiError } from "../api/client";
import { fetchDigitalReport, saveDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery, SaveErrorResponse } from "../api/types";
import type { EditableField } from "../model/field";
import { buildFieldForSave, checkSaveGuard, type BuiltZipEntry } from "../model/toParam";
import { buildAnswersZip } from "./buildZip";

export interface SaveDraftParams {
  fields: EditableField[];
  cutMargin: number;
  baseSheetId: number;
  studentCode: string;
  times: number;
  /** 保存後の照合用に、保存直前と同じ条件で再取得するためのクエリ */
  verifyQuery: DigitalReportQuery;
}

export interface SaveDraftResult {
  ok: boolean;
  blockedReason?: string;
  errors?: string[];
  mismatchedFieldIds?: number[];
}

/**
 * 下書き保存を実行し、保存後にサーバへ再取得して自分が送ったテキストが
 * 反映されているかを照合する。手書き・画像を含むシートは保存自体をブロックする。
 */
export async function saveDraft(params: SaveDraftParams): Promise<SaveDraftResult> {
  const guard = checkSaveGuard(params.fields);
  if (guard.blocked) {
    return { ok: false, blockedReason: guard.reason };
  }

  const zipEntries: BuiltZipEntry[] = [];
  const paramBaseSheetFields = params.fields.map((field) => {
    const { param, zipEntries: entries } = buildFieldForSave(field, params.cutMargin);
    zipEntries.push(...entries);
    return param;
  });

  const zipBlob = buildAnswersZip(zipEntries);

  try {
    await saveDigitalReport({
      file: zipBlob,
      baseSheetId: params.baseSheetId,
      studentCode: params.studentCode,
      times: params.times,
      paramBaseSheetFields,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      const body = e.body as SaveErrorResponse;
      return { ok: false, errors: body?.errors ?? ["保存に失敗しました。"] };
    }
    return { ok: false, errors: ["予期せぬ通信エラーが発生しました。"] };
  }

  // 保存後にサーバへ再取得し、編集した設問のテキストが反映されているか照合する
  const mismatchedFieldIds: number[] = [];
  try {
    const reFetched = await fetchDigitalReport(params.verifyQuery);
    const byId = new Map(reFetched.base_sheet_fields.map((f) => [f.id, f]));
    for (const field of params.fields) {
      if (!field.isEditableText) continue;
      const expected = field.text.trim();
      const serverField = byId.get(field.raw.id);
      const serverText = serverField?.answer_texts?.[0]?.text?.trim() ?? "";
      if (expected !== serverText) {
        mismatchedFieldIds.push(field.raw.id);
      }
    }
  } catch {
    // 照合自体の失敗は保存の成否とは分離して扱う(保存APIは200を返しているため成功とみなす)
  }

  return { ok: true, mismatchedFieldIds };
}
