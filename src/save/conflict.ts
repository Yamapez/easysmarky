import type { BaseSheetField } from "../api/types";

/**
 * 他所での変更(別タブ・別端末・公式画面での保存)を見つけるための比較。
 * サーバーには版番号や更新日時が無いため、設問ごとに「答えの内容」を指紋にして比べる。
 * 位置・色・字の大きさは含めない(サーバーが正規化して返す値で誤検知しないため)。
 */

/** 比較用にテキストを正規化する。null・末尾の空白の揃え違いを同一視する */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? "").trim();
}

/**
 * 答えの指紋。空のテキスト(無回答の空スタンプ)は数えないので、[] と [""] は同じになる。
 * 画像・手書きの有無も含める(増えたら保存ガードが止めるが、指紋の上でも変化として見えるように)。
 */
function fingerprint(texts: string[], images: number, canvas: boolean): string {
  return JSON.stringify([texts.filter((t) => t !== ""), images, canvas]);
}

/** サーバーから届いた設問の指紋 */
export function fingerprintField(raw: BaseSheetField): string {
  const texts = (raw.answer_texts ?? [])
    .slice()
    .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
    .map((t) => normalizeText(t.text));
  return fingerprint(texts, raw.answer_images?.length ?? 0, !!raw.base64_canvas);
}

/**
 * 今の入力を送ったときに、その設問がサーバーに残す答えの指紋。
 * 編集できる設問は入力した1つのテキストと、送り返す画像のメタデータ(件数)になる。
 * canvas は送り返す値に含まれないため、ここでは数えない(サーバーがどう扱うかは実機で未確認)。
 * 編集できない設問は、読み込み時の内容をそのまま送り返すので、呼び出し側は raw の指紋を使う。
 */
export function fingerprintSent(text: string, imageCount = 0): string {
  return fingerprint([normalizeText(text)], imageCount, false);
}

/** 設問ID → 指紋 の対応 */
export function fingerprintsOf(fields: BaseSheetField[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const f of fields) map.set(f.id, fingerprintField(f));
  return map;
}

/**
 * 保存直前の再取得(fresh)と、読み込み時の状態(baseline)、今送ろうとしている内容(local)を比べ、
 * 「他所で変わっていて、かつ送ると他所の内容を置き換えてしまう」設問のIDを返す。
 * - baseline と同じ: 他所では変わっていない → 競合ではない
 * - local と同じ: 送っても内容が変わらない → 競合ではない
 * - local を知らない設問(送らない設問): 競合にしない
 */
export function findConflicts(
  baseline: ReadonlyMap<number, string>,
  fresh: BaseSheetField[],
  local: ReadonlyMap<number, string>,
): number[] {
  const ids: number[] = [];
  for (const f of fresh) {
    const sent = local.get(f.id);
    if (sent === undefined) continue;
    const now = fingerprintField(f);
    if (now === sent) continue;
    if (baseline.get(f.id) === now) continue;
    ids.push(f.id);
  }
  return ids;
}

/**
 * 設問の手書き・画像の中身。件数ではなく、画像の id の集合と canvas の文字列で持つ。
 * 件数だけだと、キャンバスへの筆跡の追加や画像の差し替え(件数が同じ)を取りこぼすため。
 */
export interface BinarySnapshot {
  /**
   * 画像の印。id のある画像は "id:<id>"。id の無い画像は "anon:<順番>:<位置と大きさ>"
   * (null を1つにまとめると増えても見逃すため。位置と大きさを足すと、同じ件数での差し替えも見分けられる)。
   * 注意: id の無い画像は、サーバーが位置・大きさを正規化して返すと、保存のたびに「変わった」と判定されうる。
   * その場合は次の保存が止まる(送らない側に倒れる)。手書きを消す方向には倒れない。
   */
  imageIds: ReadonlySet<string>;
  canvas: string | null;
}

/** 手書き・画像が無い設問は null */
export function binarySnapshotOf(raw: BaseSheetField): BinarySnapshot | null {
  const imageIds = new Set<string>();
  let anon = 0;
  for (const img of raw.answer_images ?? []) {
    if (img.id != null) imageIds.add(`id:${img.id}`);
    else imageIds.add(`anon:${anon++}:${img.x}:${img.y}:${img.width}:${img.height}`);
  }
  const canvas = raw.base64_canvas ?? null;
  if (imageIds.size === 0 && !canvas) return null;
  return { imageIds, canvas };
}

/** 手書き・画像のある設問だけの、設問ID → 中身 の対応 */
export function binarySnapshotsOf(fields: BaseSheetField[]): Map<number, BinarySnapshot> {
  const map = new Map<number, BinarySnapshot>();
  for (const f of fields) {
    const snap = binarySnapshotOf(f);
    if (snap) map.set(f.id, snap);
  }
  return map;
}

/** シート全体の手書き・画像の件数(画像の件数 + canvas の有無)。保存前後の表示に使う */
export function totalBinaryCount(fields: BaseSheetField[]): number {
  return fields.reduce((sum, f) => sum + (f.answer_images?.length ?? 0) + (f.base64_canvas ? 1 : 0), 0);
}

/**
 * 保存の送信の間(保存直前の再取得〜保存後の再取得)に、手書き・画像が増えた設問のID。
 * 送信そのものが、id の無い画像に新しい id を振る・座標を正規化するなどして印を変えうるため、
 * 印の比較は使わず、画像の件数が増えたことと、canvas が新しく現れたことだけを見る。
 * 件数が同じままの差し替えや、既存 canvas の書き換えは、ここでは見分けられない(送信の間に限った限界)。
 */
export function binaryGrownDuringSendIds(
  post: BaseSheetField[],
  atSend: ReadonlyMap<number, BinarySnapshot>,
): number[] {
  const ids: number[] = [];
  for (const f of post) {
    const now = binarySnapshotOf(f);
    if (!now) continue;
    const then = atSend.get(f.id);
    const newImage = now.imageIds.size > (then?.imageIds.size ?? 0);
    const canvasAppeared = now.canvas !== null && (then?.canvas ?? null) === null;
    if (newImage || canvasAppeared) ids.push(f.id);
  }
  return ids;
}

/**
 * 同意したあとに、手書き・画像が増えた、または canvas の中身が変わった設問のID。
 * 同意の時点に無かった画像の id があれば増えた、canvas の文字列が違えば変わった、とみなす。
 * 消えただけ(保存の結果として減った)は止めない。
 */
export function binaryGrownFieldIds(
  fresh: BaseSheetField[],
  consented: ReadonlyMap<number, BinarySnapshot>,
): number[] {
  const ids: number[] = [];
  for (const f of fresh) {
    const now = binarySnapshotOf(f);
    if (!now) continue;
    const then = consented.get(f.id);
    if (!then) {
      ids.push(f.id);
      continue;
    }
    const newImage = [...now.imageIds].some((id) => !then.imageIds.has(id));
    const canvasChanged = now.canvas !== null && now.canvas !== then.canvas;
    if (newImage || canvasChanged) ids.push(f.id);
  }
  return ids;
}
