/** APIが返す base64(またはdata URL)を <img>/Image に渡せる src に整える */
export function toImageSrc(base64OrDataUrl: string): string {
  return base64OrDataUrl.startsWith("data:") ? base64OrDataUrl : `data:image/jpeg;base64,${base64OrDataUrl}`;
}

/** 実際に切り出した矩形。base_sheet(rim)の座標系。用紙の端では要求より小さくなる */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropPreviewOptions {
  canvas: HTMLCanvasElement;
  /** base64_answer_images[page] または base64_question_images[page] */
  pageImage: string;
  /** [x, y, width, height]。base_sheet の座標系 */
  rim: [number, number, number, number];
  cutMargin: number;
  /**
   * rim の座標系のサイズ(base_sheet.width / height)。
   * 0 や未指定なら「ページ画像のピクセル = rim の座標」とみなす。
   */
  sheetWidth?: number;
  sheetHeight?: number;
}

/**
 * ページ背景画像(base64_answer_images[page])から、rim + cut_margin の範囲を
 * canvas に切り出して描画する。教員が見る解答欄の見た目を再現するプレビュー用。
 *
 * 重要: rim と cut_margin は base_sheet の座標系であって、ページ画像のピクセルではない。
 * ページ画像の解像度が base_sheet.width/height と一致するとは限らないので、
 * naturalWidth/Height との比で必ず換算する。換算を忘れると切り出し範囲が
 * (naturalWidth / base_sheet.width) 倍だけズレる。
 *
 * 戻り値は「実際に切り出した矩形」を base_sheet 座標系で返す。用紙の端では要求した
 * (rim − cut_margin) から縮むので、上に重ねる文字の位置は必ずこの値を基準に計算すること。
 */
export function drawCropPreview(opts: CropPreviewOptions): Promise<CropRect> {
  const { canvas, pageImage, rim, cutMargin } = opts;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [rimX, rimY, rimW, rimH] = rim;
      const naturalW = img.naturalWidth || 0;
      const naturalH = img.naturalHeight || 0;
      // 用紙(rim座標系)のサイズ。分からなければ画像ピクセルをそのまま用紙とみなす
      const sheetW = opts.sheetWidth && opts.sheetWidth > 0 ? opts.sheetWidth : naturalW;
      const sheetH = opts.sheetHeight && opts.sheetHeight > 0 ? opts.sheetHeight : naturalH;
      // base_sheet 座標 → ページ画像ピクセル の倍率。用紙と画像の縦横比が厳密に
      // 一致する保証がないため、X と Y で別々に持つ
      const fx = sheetW > 0 && naturalW > 0 ? naturalW / sheetW : 1;
      const fy = sheetH > 0 && naturalH > 0 ? naturalH / sheetH : 1;

      // 切り出し範囲(base_sheet座標)。用紙の外へ出る分は上下左右それぞれで詰める
      const left = Math.max(0, rimX - cutMargin);
      const top = Math.max(0, rimY - cutMargin);
      const right = sheetW > 0 ? Math.min(sheetW, rimX + rimW + cutMargin) : rimX + rimW + cutMargin;
      const bottom = sheetH > 0 ? Math.min(sheetH, rimY + rimH + cutMargin) : rimY + rimH + cutMargin;
      const cropW = Math.max(0, right - left);
      const cropH = Math.max(0, bottom - top);

      canvas.width = Math.max(1, Math.round(cropW * fx));
      canvas.height = Math.max(1, Math.round(cropH * fy));
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (cropW > 0 && cropH > 0) {
        ctx.drawImage(img, left * fx, top * fy, cropW * fx, cropH * fy, 0, 0, canvas.width, canvas.height);
      }
      resolve({ x: left, y: top, width: cropW, height: cropH });
    };
    img.onerror = () => reject(new Error("解答欄画像の読み込みに失敗しました"));
    img.src = toImageSrc(pageImage);
  });
}
