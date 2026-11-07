import { ApiError, describeApiError, type ApiErrorKind } from "../api/client";
import { fetchDigitalReport, saveDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery, DigitalReportResponse, SaveErrorResponse } from "../api/types";
import { isEditableField, type EditableField } from "../model/field";
import { renderedText } from "../model/gridLayout";
import { buildFieldForSave, checkSaveGuard, type BuiltZipEntry } from "../model/toParam";
import { buildAnswersZip } from "./buildZip";
import { findConflicts, fingerprintField, fingerprintSent, fingerprintsOf } from "./conflict";

export interface SaveDraftParams {
  fields: EditableField[];
  cutMargin: number;
  baseSheetId: number;
  studentCode: string;
  times: number;
  /** 保存後の照合・保存直前の再取得に使う、同じ回を指すクエリ */
  verifyQuery: DigitalReportQuery;
  /** 読み込み時(直近の保存後の照合時)のサーバーの指紋。他所での変更の判定に使う */
  baseline: ReadonlyMap<number, string>;
  /** true なら他所での変更を確かめずに送る。利用者が「上書きして保存」を選んだときだけ */
  overwrite?: boolean;
}

/** 送信した編集可能な設問の値。端末の下書きの基準(base)を、送った内容に合わせ直すために使う */
export interface SentValues {
  text: string;
  direction: number;
  fontSize: number;
  lineHeight: number;
  color: string;
}

export interface SaveDraftResult {
  ok: boolean;
  blockedReason?: string;
  errors?: string[];
  /** ok=false のときの失敗の種類(通信・ログイン切れ・サーバー側など) */
  errorKind?: ApiErrorKind;
  /** 保存直前の再取得で、他所での変更が見つかった設問。送信はしていない */
  conflictFieldIds?: number[];
  /** 保存後の再取得が成功し、照合を実際に行えたか。false なら反映は未確認 */
  verified?: boolean;
  mismatchedFieldIds?: number[];
  /** 次の保存で他所での変更を判定するための指紋(今の状態) */
  nextBaseline?: Map<number, string>;
  /** 送った編集可能な設問の値 */
  sent?: Map<number, SentValues>;
}

/**
 * 下書き保存を実行する。
 * 1. 保存直前にサーバーの最新を取り直し、手書き・画像が増えていないかを確かめる
 * 2. 読み込み後に他所で変わった設問があり、かつ送ると他所の内容を置き換えてしまうなら、送らずに返す
 * 3. 送信し、保存後にサーバーへ再取得して自分が送ったテキストが反映されているかを照合する
 */
export async function saveDraft(params: SaveDraftParams): Promise<SaveDraftResult> {
  const guard = checkSaveGuard(params.fields);
  if (guard.blocked) {
    return { ok: false, blockedReason: guard.reason };
  }

  let latest: DigitalReportResponse;
  try {
    latest = await fetchDigitalReport(params.verifyQuery);
  } catch (e) {
    // 最新を確かめられないまま送らない。送れない原因は保存と同じく通信・ログインなので、同じ案内で足りる
    const described = describeApiError(e);
    return { ok: false, errorKind: described.kind, errors: [described.message] };
  }
  const latestGuard = checkSaveGuard(latest.base_sheet_fields.map((raw) => ({ raw })));
  if (latestGuard.blocked) {
    return { ok: false, blockedReason: latestGuard.reason };
  }

  // 送る内容はここから同期的に組み立てる。取得を待つ間の編集は、この組み立てに入った分だけが送られる
  const zipEntries: BuiltZipEntry[] = [];
  const paramBaseSheetFields = params.fields.map((field) => {
    const { param, zipEntries: entries } = buildFieldForSave(field, params.cutMargin);
    zipEntries.push(...entries);
    return param;
  });
  // 照合は「送った内容」と比べる。保存の送信中に編集が入ると、生きている fields と
  // 食い違って誤って不一致になるため、ここで送信時点の値を控えておく
  const sentTexts = new Map<number, string>();
  const sent = new Map<number, SentValues>();
  // 送ったら、サーバーがこの指紋を持つことになる(他所での変更の判定の基準)
  const local = new Map<number, string>();
  for (const field of params.fields) {
    const id = field.raw.id;
    if (isEditableField(field)) {
      // 送る本文はマス目に合わせた改行を含む(サーバーが持つのも同じ形)。入力欄の text ではなくこちらで比べる
      const body = renderedText(field);
      sentTexts.set(id, body.trim());
      sent.set(id, {
        text: body,
        direction: field.direction,
        fontSize: field.fontSize,
        lineHeight: field.lineHeight,
        color: field.color,
      });
      local.set(id, fingerprintSent(body));
    } else {
      // 編集できない設問は読み込み時の内容をそのまま送り返すので、送るのは raw の指紋
      local.set(id, fingerprintField(field.raw));
    }
  }

  if (!params.overwrite) {
    const conflictFieldIds = findConflicts(params.baseline, latest.base_sheet_fields, local);
    if (conflictFieldIds.length > 0) {
      return { ok: false, conflictFieldIds };
    }
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

  // 保存後にサーバへ再取得し、編集した設問のテキストが反映されているかを照合する
  const mismatchedFieldIds: number[] = [];
  let verified = true;
  let nextBaseline: Map<number, string> = local;
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
    nextBaseline = fingerprintsOf(reFetched.base_sheet_fields);
  } catch {
    // 照合できなかったことは成否とは別に伝える。保存APIは200を返しているので ok は維持する。
    // 「反映を確認した」と言えるのは照合が実際に終わったときだけ。
    // 照合できなければ、次の保存の基準は送った内容にする(自分の保存を他所の変更と誤認しないため)。
    verified = false;
  }

  return { ok: true, verified, mismatchedFieldIds, nextBaseline, sent };
}
