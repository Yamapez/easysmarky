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
 * 編集できる設問は入力した1つのテキストだけになる。編集できない設問は、読み込み時の内容をそのまま送り返す。
 */
export function fingerprintSent(text: string): string {
  return fingerprint([normalizeText(text)], 0, false);
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
