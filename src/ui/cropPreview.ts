function toImageSrc(base64OrDataUrl: string): string {
  return base64OrDataUrl.startsWith("data:") ? base64OrDataUrl : `data:image/jpeg;base64,${base64OrDataUrl}`;
}

/**
 * ページ背景画像(base64_answer_images[page])から、rim + cut_margin の範囲を
 * canvas に切り出して描画する。教員が見る解答欄の見た目を再現するプレビュー用。
 */
export function drawCropPreview(
  canvas: HTMLCanvasElement,
  pageImage: string,
  rim: [number, number, number, number],
  cutMargin: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [x, y, w, h] = rim;
      const sx = Math.max(0, x - cutMargin);
      const sy = Math.max(0, y - cutMargin);
      const sw = Math.min(w + 2 * cutMargin, img.naturalWidth - sx);
      const sh = Math.min(h + 2 * cutMargin, img.naturalHeight - sy);
      canvas.width = Math.max(1, Math.round(sw));
      canvas.height = Math.max(1, Math.round(sh));
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = () => reject(new Error("解答欄画像の読み込みに失敗しました"));
    img.src = toImageSrc(pageImage);
  });
}
