import { ApiError, describeApiError, type ApiErrorKind } from "../api/client";
import { fetchDigitalReport, saveDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery, SaveErrorResponse } from "../api/types";
import { isEditableField, type EditableField } from "../model/field";
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
  /** ok=false のときの失敗の種類(通信・ログイン切れ・サーバー側など) */
  errorKind?: ApiErrorKind;
  /** 保存後の再取得が成功し、照合を実際に行えたか。false なら反映は未確認 */
  verified?: boolean;
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
  // 照合は「送った内容」と比べる。保存の送信中に編集が入ると、生きている fields と
  // 食い違って誤って不一致になるため、ここで送信時点の値を控えておく
  const sentTexts = new Map<number, string>();
  for (const field of params.fields) {
    if (isEditableField(field)) sentTexts.set(field.raw.id, field.text.trim());
  }

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
      return { ok: false, errorKind: "other", errors: body?.errors ?? ["保存に失敗しました。"] };
    }
    const described = describeApiError(e);
    return { ok: false, errorKind: described.kind, errors: [described.message] };
  }

  // 保存後にサーバへ再取得し、編集した設問のテキストが反映されているか照合する
  const mismatchedFieldIds: number[] = [];
  let verified = true;
  try {
    const reFetched = await fetchDigitalReport(params.verifyQuery);
    const byId = new Map(reFetched.base_sheet_fields.map((f) => [f.id, f]));
    for (const [id, expected] of sentTexts) {
      const serverField = byId.get(id);
      const serverText = serverField?.answer_texts?.[0]?.text?.trim() ?? "";
      if (expected !== serverText) {
        mismatchedFieldIds.push(id);
      }
    }
  } catch {
    // 照合できなかったことは成否とは別に伝える。保存APIは200を返しているので ok は維持する。
    // 「反映を確認した」と言えるのは照合が実際に終わったときだけ。
    verified = false;
  }

  return { ok: true, verified, mismatchedFieldIds };
}
