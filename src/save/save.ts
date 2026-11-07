import { ApiError, describeApiError, type ApiErrorKind } from "../api/client";
import { fetchDigitalReport, saveDigitalReport } from "../api/endpoints";
import type { DigitalReportQuery, DigitalReportResponse, SaveErrorResponse } from "../api/types";
import { isEditableField, type EditableField } from "../model/field";
import { renderedText } from "../model/gridLayout";
import { buildFieldForSave, checkSaveGuard, type BuiltZipEntry } from "../model/toParam";
import { loadPrefs } from "../storage/prefs";
import { buildAnswersZip } from "./buildZip";
import {
  binaryGrownDuringSendIds,
  binaryGrownFieldIds,
  binarySnapshotsOf,
  findConflicts,
  fingerprintField,
  fingerprintSent,
  fingerprintsOf,
  totalBinaryCount,
  type BinarySnapshot,
} from "./conflict";

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
  /**
   * 手書き・画像のある回を保存してよい、という同意があるか。
   * formView は、読み込み時に手書きがある回で、保存ボタンが有効なとき(= 端末共通の設定 easysmarky:prefs で許可済みのとき)だけ true を渡す。
   * 読み込み時に手書きが無かった回は false のままなので、その後に増えた手書きは「同意の外」として止まる。
   */
  allowBinaryLoss?: boolean;
  /**
   * 同意したとき(読み込み時)の、手書き・画像のある設問の中身。
   * 同意のあとにこれより増えた、または中身が変わった手書きがあれば送らない
   */
  consentedBinary?: ReadonlyMap<number, BinarySnapshot>;
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
  /** 手書き・画像の件数。保存直前の再取得(before)と、保存後の再取得(after)。after は再取得できなかったら undefined */
  binaryBefore?: number;
  binaryAfter?: number;
  /** 保存後の再取得で見た、手書き・画像の中身。次の保存の基準になる。照合できなかったら undefined */
  nextBinary?: Map<number, BinarySnapshot>;
  /** 同意のあとに手書き・画像が増えた設問。送信はしていない */
  binaryGrownFieldIds?: number[];
  /**
   * 送信中(保存直前の再取得〜保存後の再取得の間)に手書き・画像が増えた・変わった設問の数。
   * その設問は同意の基準から外すので、次の保存は「増えた」として止まる
   */
  binaryGrownDuringSave?: number;
}

/**
 * 下書き保存を実行する。
 * 1. 保存直前にサーバーの最新を取り直し、手書き・画像が増えていないかを確かめる
 * 2. 読み込み後に他所で変わった設問があり、かつ送ると他所の内容を置き換えてしまうなら、送らずに返す
 * 3. 送信し、保存後にサーバーへ再取得して自分が送ったテキストが反映されているかを照合する
 */
export async function saveDraft(params: SaveDraftParams): Promise<SaveDraftResult> {
  const guard = checkSaveGuard(params.fields, { allowBinaryLoss: params.allowBinaryLoss });
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
  const binaryBefore = totalBinaryCount(latest.base_sheet_fields);
  // 送信の直前の手書きの中身。保存後の再取得と比べ、送信の間に増えた・変わった設問を見つけるために使う
  const binaryAtSend = binarySnapshotsOf(latest.base_sheet_fields);
  if (params.allowBinaryLoss) {
    // 同意は読み込み時の手書きに対するもの。同意のあとに手書きが増えた(または中身が変わった)なら送らない
    const grown = binaryGrownFieldIds(latest.base_sheet_fields, params.consentedBinary ?? new Map());
    if (grown.length > 0) {
      return {
        ok: false,
        binaryGrownFieldIds: grown,
        blockedReason:
          `同意のあとに、サーバー側で手書き・画像の解答が増えた(または変わった)設問が${grown.length}件あるため、送っていません。この画面を閉じて開き直し、もう一度内容を確かめてください。`,
      };
    }
  } else {
    const latestGuard = checkSaveGuard(latest.base_sheet_fields.map((raw) => ({ raw })));
    if (latestGuard.blocked) {
      // 設定で許可済みなのに止まったのは、読み込み時には手書きが無く、今の画面では許可を選べないため。
      // 「設定で許可」は案内にならないので、開き直しを案内する
      const reason = loadPrefs().allowBinaryLoss
        ? "保存の前に、サーバー側で手書き・画像の解答が増えていたため、送っていません。この画面を閉じて開き直し、内容を確かめてください。"
        : latestGuard.reason;
      return { ok: false, blockedReason: reason };
    }
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
      // 送り返す画像のメタデータの件数を、送ったあとの指紋に含める(含めないと、照合できなかった保存のあとに誤った競合になる)
      local.set(id, fingerprintSent(body, field.raw.answer_images?.length ?? 0));
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

  // 送信の直前に、手書きを送る許可を読み直す。許可を確かめたあと(取得の待ち時間)に設定がオフにされていたら送らない
  if (params.allowBinaryLoss && binaryBefore > 0 && !loadPrefs().allowBinaryLoss) {
    return {
      ok: false,
      blockedReason: "手書き・画像のある回の保存が、送る直前に設定でオフにされたため、送っていません。",
    };
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
  let binaryAfter: number | undefined;
  let nextBinary: Map<number, BinarySnapshot> | undefined;
  let grownDuringSave: number[] = [];
  try {
    const reFetched = await fetchDigitalReport(params.verifyQuery);
    binaryAfter = totalBinaryCount(reFetched.base_sheet_fields);
    nextBinary = binarySnapshotsOf(reFetched.base_sheet_fields);
    // 送信の間に増えた・変わった手書きは、利用者が見ていない内容。次の保存の基準(同意)に入れない。
    // 基準から外すと、次の保存は「同意のあとに増えた」として止まり、開き直しを求められる
    grownDuringSave = binaryGrownDuringSendIds(reFetched.base_sheet_fields, binaryAtSend);
    for (const id of grownDuringSave) nextBinary.delete(id);
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

  return {
    ok: true,
    verified,
    mismatchedFieldIds,
    nextBaseline,
    sent,
    binaryBefore,
    binaryAfter,
    nextBinary,
    binaryGrownDuringSave: grownDuringSave.length > 0 ? grownDuringSave.length : undefined,
  };
}
