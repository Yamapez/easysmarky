import type { CropRect } from "../ui/cropPreview";

/**
 * 解答欄(rim)の中に印字されたマス目の数。rows は縦方向(行の並び)、cols は横方向の本数。
 * 検出できなかった方向は null。両方 null なら「マス目なし」。
 * ピッチ(マスの大きさ)は rim の寸法を個数で割って決める(model/gridLayout.ts)。
 */
export interface RimGridCounts {
  rows: number | null;
  cols: number | null;
}

/** 暗い画素とみなす輝度の上限(0〜255) */
const DARK_LUMA = 140;
/** 罫線とみなす、その行(列)の暗い画素の割合。文字の列では届かない高さに置く */
const LINE_COVERAGE = 0.6;
/** 解答欄の縁(印字された外枠)を除く幅(px)。縁は罫線に数えない */
const EDGE_SKIP = 3;
/** 罫線の間隔の最小(px)。これより狭い間隔はノイズとみなす */
const MIN_PITCH_PX = 6;
/** 等間隔とみなす誤差(中央値に対する割合) */
const PITCH_TOLERANCE = 0.15;
/** 等間隔の判定に使う区間の割合。外れる区間がこれより多ければマス目なし */
const CONSISTENT_RATIO = 0.8;
/** 行方向は、外枠の内側に等間隔の罫線が最低この本数必要(偶然の一本線で誤検出しないため) */
const MIN_ROW_LINES = 3;
/** 列方向は、縦の仕切りが1本あれば認める(2列の解答欄など) */
const MIN_COL_LINES = 1;

/**
 * 解答欄の画素から、罫線で区切られたマス目の数を数える。純関数(テスト・検証しやすいよう DOM に依存しない)。
 * data は RGBA の並び。w, h は rim の内側を切り出した画素数。
 */
export function detectGridCounts(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
): RimGridCounts | null {
  if (w <= 2 * EDGE_SKIP + MIN_PITCH_PX || h <= 2 * EDGE_SKIP + MIN_PITCH_PX) return null;

  // 暗い画素の位置(縁の内側だけ)
  const dark = new Uint8Array(w * h);
  for (let y = EDGE_SKIP; y < h - EDGE_SKIP; y++) {
    for (let x = EDGE_SKIP; x < w - EDGE_SKIP; x++) {
      const i = (y * w + x) * 4;
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luma < DARK_LUMA) dark[y * w + x] = 1;
    }
  }

  // 縦の仕切りは全高で見る(2列の解答欄などの区切り)
  const colLines = lineCenters(colCoverage(dark, w, EDGE_SKIP, h - EDGE_SKIP));
  const cols = axisCount(colLines, w, MIN_COL_LINES);

  // 横罫は、縦の仕切りで区切った帯ごとに数え、罫線がいちばんそろっている帯の結果を使う。
  // 実際の解答欄は、上の段は左右に罫があっても下の段は右の列にしか罫が無いことがある
  // (全幅で数えると被覆率が届かず、行が取れない)。
  const dividers = colLines.filter((c) => c > EDGE_SKIP && c < w - EDGE_SKIP);
  const bounds = [0, ...dividers, w];
  let rows: number | null = null;
  let bestInterior = -1;
  for (let s = 0; s + 1 < bounds.length; s++) {
    // 罫線の中心は小数(74.5 など)なので、画素の添字に使えるよう整数にそろえる
    const a = Math.ceil(bounds[s] + EDGE_SKIP);
    const b = Math.floor(bounds[s + 1] - EDGE_SKIP);
    if (b - a < MIN_PITCH_PX) continue;
    const lines = lineCenters(rowCoverage(dark, w, h, a, b));
    const interior = lines.filter((c) => c > EDGE_SKIP && c < h - EDGE_SKIP).length;
    const count = axisCount(lines, h, MIN_ROW_LINES);
    if (count != null && interior > bestInterior) {
      bestInterior = interior;
      rows = count;
    }
  }

  if (rows == null && cols == null) return null;
  return { rows, cols };
}

/** 列 x ごとに、y0〜y1 の中で暗い画素の割合 */
function colCoverage(dark: Uint8Array, w: number, y0: number, y1: number): number[] {
  const span = y1 - y0;
  const out = new Array<number>(w).fill(0);
  if (span <= 0) return out;
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = y0; y < y1; y++) n += dark[y * w + x];
    out[x] = n / span;
  }
  return out;
}

/** 行 y ごとに、x0〜x1 の中で暗い画素の割合 */
function rowCoverage(dark: Uint8Array, w: number, h: number, x0: number, x1: number): number[] {
  const span = x1 - x0;
  const out = new Array<number>(h).fill(0);
  if (span <= 0) return out;
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) n += dark[y * w + x];
    out[y] = n / span;
  }
  return out;
}

/** 連続して罫線とみなされた行(列)の中央位置を返す */
function lineCenters(coverage: number[]): number[] {
  const centers: number[] = [];
  let runStart = -1;
  for (let i = 0; i <= coverage.length; i++) {
    const on = i < coverage.length && coverage[i] >= LINE_COVERAGE;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      centers.push((runStart + i - 1) / 2);
      runStart = -1;
    }
  }
  return centers;
}

/**
 * 罫線の位置から、その方向のマスの数を出す。
 * 縁(0 と extent)を境界に含めて区間を作り、区間がそろっていれば(中央値の±15%に8割以上が入る)
 * extent を中央値で割った数を返す。足りなければ null。
 */
function axisCount(lines: number[], extent: number, minLines: number): number | null {
  const interior = lines.filter((c) => c > EDGE_SKIP && c < extent - EDGE_SKIP);
  if (interior.length < minLines) return null;
  const bounds = [0, ...interior, extent];
  const gaps: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) gaps.push(bounds[i + 1] - bounds[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (median < MIN_PITCH_PX) return null;
  const consistent = gaps.filter((g) => Math.abs(g - median) <= median * PITCH_TOLERANCE).length;
  if (consistent < Math.ceil(gaps.length * CONSISTENT_RATIO)) return null;
  return Math.max(1, Math.round(extent / median));
}

/**
 * 切り出し済みの解答用紙 canvas(drawCropPreview の結果)から、rim の内側のマス目を数える。
 * canvas の画素と rim の座標系は rect(実際に切り出した矩形)経由で換算する。
 * 読めない・範囲が無いときは null(マス目なし)。
 */
export function detectRimGrid(
  canvas: HTMLCanvasElement,
  rect: CropRect,
  rim: [number, number, number, number],
): RimGridCounts | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const [rx, ry, rw, rh] = rim;
  const x0 = Math.max(0, Math.round((rx - rect.x) * sx));
  const y0 = Math.max(0, Math.round((ry - rect.y) * sy));
  const x1 = Math.min(canvas.width, Math.round((rx + rw - rect.x) * sx));
  const y1 = Math.min(canvas.height, Math.round((ry + rh - rect.y) * sy));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    const image = ctx.getImageData(x0, y0, w, h);
    return detectGridCounts(image.data, w, h);
  } catch {
    // 画素が読めない環境ではマス目なしとして扱う(従来どおり 32・中央)
    return null;
  }
}
