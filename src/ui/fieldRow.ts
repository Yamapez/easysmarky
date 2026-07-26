import { Direction } from "../api/types";
import type { EditableField } from "../model/field";
import { measureText } from "../render/measure";
import { renderAnswerText } from "../render/renderText";
import { drawCropPreview, toImageSrc } from "./cropPreview";

export interface FieldRowOptions {
  field: EditableField;
  pageImage: string | null;
  cutMargin: number;
  onChange: (field: EditableField) => void;
  /** 問題ビューアをこの設問のページへ送る */
  onShowPage?: (page: number) => void;
}

export interface FieldRowHandle {
  element: HTMLElement;
  getField: () => EditableField;
  /** 行を作り直す前に呼ぶ。ResizeObserver を切る */
  destroy: () => void;
}

function fieldLabel(field: EditableField): string {
  const raw = field.raw;
  const parts = [raw.part1, raw.part2, raw.part3].filter((p) => p != null && p !== "");
  const label = parts.length > 0 ? parts.join(" ") : `設問(id:${raw.id})`;
  return raw.allot != null ? `${label}(${raw.allot}点)` : label;
}

export function createFieldRow(opts: FieldRowOptions): FieldRowHandle {
  const { cutMargin } = opts;
  const field: EditableField = { ...opts.field };

  const el = document.createElement("div");
  el.className = "es-field";

  const labelEl = document.createElement("div");
  labelEl.className = "es-field-label";
  labelEl.innerHTML = `<span>${fieldLabel(field)}</span>`;
  el.appendChild(labelEl);

  const onShowPage = opts.onShowPage;
  if (onShowPage) {
    const pageLink = document.createElement("button");
    pageLink.type = "button";
    pageLink.className = "es-field-pagelink";
    pageLink.textContent = "この設問のページを見る";
    pageLink.addEventListener("click", () => onShowPage(field.raw.page));
    el.appendChild(pageLink);
  }

  if (!field.isEditableText) {
    const note = document.createElement("div");
    note.className = "es-field-locked";
    note.textContent = "この設問は選択肢・画像などの解答欄のため、easysmarkyでは編集できません(公式画面をご利用ください)。";
    el.appendChild(note);
    return { element: el, getField: () => field, destroy: () => {} };
  }

  if (field.hasExtraStamps) {
    const note = document.createElement("div");
    note.className = "es-field-locked";
    note.textContent = "この設問には複数の解答が既に入力されています。現バージョンのeasysmarkyでは編集できません。";
    el.appendChild(note);
    return { element: el, getField: () => field, destroy: () => {} };
  }

  // 切り抜きプレビュー + テキストプレビューのオーバーレイ
  const previewWrap = document.createElement("div");
  previewWrap.className = "es-preview-wrap";
  const cropCanvas = document.createElement("canvas");
  cropCanvas.className = "es-crop";
  const overlayImg = document.createElement("img");
  overlayImg.className = "es-preview-overlay";
  overlayImg.style.display = "none";
  previewWrap.appendChild(cropCanvas);
  previewWrap.appendChild(overlayImg);
  el.appendChild(previewWrap);

  if (opts.pageImage) {
    drawCropPreview(cropCanvas, opts.pageImage, field.raw.rim, cutMargin).catch(() => {
      /* プレビュー画像が読めない場合はテキスト入力のみ提供する */
    });
  }

  function updatePreview(): void {
    if (!opts.pageImage || !cropCanvas.width) return;
    // タブで非表示の間は表示幅が0になり、正しいスケールを出せない。
    // 再表示されたら下の ResizeObserver が呼び直す。
    const renderedWidth = cropCanvas.getBoundingClientRect().width;
    if (renderedWidth <= 0) return;
    const trimmed = field.text.trim();
    if (!trimmed) {
      overlayImg.style.display = "none";
      return;
    }
    const size = measureText({
      text: field.text,
      fontSize: field.fontSize,
      lineHeight: field.lineHeight,
      direction: field.direction as typeof Direction.Horizon,
    });
    if (size.width <= 0 || size.height <= 0) {
      overlayImg.style.display = "none";
      return;
    }
    const x = (field.raw.rim[2] + 2 * cutMargin - size.width) / 2;
    const y = (field.raw.rim[3] + 2 * cutMargin - size.height) / 2;
    const png = renderAnswerText({
      text: field.text,
      width: size.width,
      height: size.height,
      font_size: field.fontSize,
      line_height: field.lineHeight,
      color: field.color,
      direction: field.direction,
    });
    const scale = renderedWidth / cropCanvas.width;
    overlayImg.src = `data:image/png;base64,${png}`;
    overlayImg.style.left = `${x * scale}px`;
    overlayImg.style.top = `${y * scale}px`;
    overlayImg.style.width = `${size.width * scale}px`;
    overlayImg.style.height = `${size.height * scale}px`;
    overlayImg.style.display = "block";
  }

  // 縦書き/横書きトグル
  const toggleWrap = document.createElement("div");
  toggleWrap.className = "es-direction-toggle";
  const horizBtn = document.createElement("button");
  horizBtn.type = "button";
  horizBtn.textContent = "横書き";
  const vertBtn = document.createElement("button");
  vertBtn.type = "button";
  vertBtn.textContent = "縦書き";
  toggleWrap.appendChild(horizBtn);
  toggleWrap.appendChild(vertBtn);
  el.appendChild(toggleWrap);

  function refreshToggle(): void {
    horizBtn.classList.toggle("active", field.direction === Direction.Horizon);
    vertBtn.classList.toggle("active", field.direction === Direction.Vertical);
  }
  refreshToggle();

  horizBtn.addEventListener("click", () => {
    field.direction = Direction.Horizon;
    refreshToggle();
    updatePreview();
    opts.onChange(field);
  });
  vertBtn.addEventListener("click", () => {
    field.direction = Direction.Vertical;
    refreshToggle();
    updatePreview();
    opts.onChange(field);
  });

  // テキスト入力
  const textarea = document.createElement("textarea");
  textarea.className = "es-textarea";
  textarea.value = field.text;
  textarea.placeholder = "ここに解答を入力";
  el.appendChild(textarea);

  textarea.addEventListener("input", () => {
    field.text = textarea.value;
    updatePreview();
    opts.onChange(field);
  });

  // 画像読み込み後に初期プレビューを描画
  if (opts.pageImage) {
    const img = new Image();
    img.onload = () => window.requestAnimationFrame(updatePreview);
    img.src = toImageSrc(opts.pageImage);
  }
  window.setTimeout(updatePreview, 50);

  // 2カラム化・タブ切替・ウィンドウリサイズ・画面回転で表示幅が変わると
  // オーバーレイ画像の位置がずれるため、幅の変化を見て描き直す。
  const resizeObserver = new ResizeObserver(() => updatePreview());
  resizeObserver.observe(cropCanvas);

  return {
    element: el,
    getField: () => field,
    destroy: () => resizeObserver.disconnect(),
  };
}
