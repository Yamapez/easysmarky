import { Direction } from "../api/types";
import type { EditableField } from "../model/field";
import { measureText } from "../render/measure";
import { renderAnswerText } from "../render/renderText";
import { drawCropPreview, toImageSrc } from "./cropPreview";

export interface FieldEditorOptions {
  field: EditableField;
  /** その設問がある解答用紙ページの画像 */
  pageImage: string | null;
  /** その設問がある問題ページの画像。PC幅でのみ解答欄プレビューの横に表示する */
  questionPageImage: string | null;
  cutMargin: number;
  onChange: (field: EditableField) => void;
  /** 問題ビューアをこの設問のページへ送る(編集不可の設問から使う) */
  onShowPage?: (page: number) => void;
}

export interface FieldEditorHandle {
  element: HTMLElement;
  getField: () => EditableField;
  /** テキスト入力にフォーカスする。編集できない設問では何もしない */
  focus: () => void;
  /** 作り直す前に呼ぶ。ResizeObserver を切る */
  destroy: () => void;
}

/** 「問1 (2)」のような設問名。枠のラベルやストリップのチップに使う */
export function fieldShortLabel(field: EditableField): string {
  const raw = field.raw;
  const parts = [raw.part1, raw.part2, raw.part3].filter((p) => p != null && p !== "");
  return parts.length > 0 ? parts.join(" ") : `設問(id:${raw.id})`;
}

/** 「問1 (2)(10点)」のような、配点つきの設問名 */
export function fieldLabel(field: EditableField): string {
  const label = fieldShortLabel(field);
  return field.raw.allot != null ? `${label}(${field.raw.allot}点)` : label;
}

/** 改行を除いた文字数(サロゲートペアを1文字と数える) */
function charCount(text: string): number {
  return [...text.replace(/\r\n|\r|\n/g, "")].length;
}

export function createFieldEditor(opts: FieldEditorOptions): FieldEditorHandle {
  const { cutMargin } = opts;
  const field: EditableField = { ...opts.field };

  const el = document.createElement("div");
  el.className = "es-field-editor";

  if (!field.isEditableText || field.hasExtraStamps) {
    const card = document.createElement("div");
    card.className = "es-field-locked";
    const name = document.createElement("div");
    name.className = "es-field-locked-name";
    name.textContent = fieldLabel(field);
    const note = document.createElement("div");
    note.className = "es-field-locked-note";
    note.textContent = field.isEditableText
      ? "この設問には複数の解答が既に入力されています。現バージョンのeasysmarkyでは編集できません(公式画面をご利用ください)。"
      : "この設問は選択肢・画像などの解答欄のため、easysmarkyでは編集できません(公式画面をご利用ください)。";
    card.appendChild(name);
    card.appendChild(note);
    const onShowPage = opts.onShowPage;
    if (onShowPage) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "es-field-pagelink";
      link.textContent = "解答用紙の該当ページを見る";
      link.addEventListener("click", () => onShowPage(field.raw.page));
      card.appendChild(link);
    }
    el.appendChild(card);
    return { element: el, getField: () => field, focus: () => {}, destroy: () => {} };
  }

  // --- 解答欄プレビュー(切り抜き画像 + 描画されるテキストの重ね合わせ) ---
  const previewHead = document.createElement("div");
  previewHead.className = "es-preview-head";
  previewHead.innerHTML =
    "<span>解答欄プレビュー</span><span class=\"es-preview-note\">保存後の見た目と同じ</span>";
  el.appendChild(previewHead);

  const previewRow = document.createElement("div");
  previewRow.className = "es-preview-row";
  el.appendChild(previewRow);

  const previewWrap = document.createElement("div");
  previewWrap.className = "es-preview-wrap";
  const cropCanvas = document.createElement("canvas");
  cropCanvas.className = "es-crop";
  const overlayImg = document.createElement("img");
  overlayImg.className = "es-preview-overlay";
  overlayImg.style.display = "none";
  previewWrap.appendChild(cropCanvas);
  previewWrap.appendChild(overlayImg);
  previewRow.appendChild(previewWrap);

  if (opts.pageImage) {
    drawCropPreview(cropCanvas, opts.pageImage, field.raw.rim, cutMargin).catch(() => {
      /* プレビュー画像が読めない場合はテキスト入力のみ提供する */
    });
  }

  // --- 問題プレビュー(解答欄と同じ範囲を問題ページから切り出したもの。PCのみ表示) ---
  // rim は解答用紙の座標系なので、問題ページ側で同じ範囲が正しく対応する保証はない(実機未確認)。
  // そのため「目安」であることをラベルで明示する。
  if (opts.questionPageImage) {
    const questionPreview = document.createElement("div");
    questionPreview.className = "es-question-preview";
    const questionHead = document.createElement("div");
    questionHead.className = "es-question-preview-head";
    questionHead.textContent = "問題(目安・ズレる場合があります)";
    const questionCanvas = document.createElement("canvas");
    questionCanvas.className = "es-crop es-crop-question";
    questionPreview.appendChild(questionHead);
    questionPreview.appendChild(questionCanvas);
    previewRow.appendChild(questionPreview);

    drawCropPreview(questionCanvas, opts.questionPageImage, field.raw.rim, cutMargin).catch(() => {
      /* 問題ページ側の切り出しが読めない場合は非表示のままにする */
    });
  }

  // 直前に描画した内容。ResizeObserver はリサイズ中に連続発火するが、
  // renderAnswerText() は毎回 canvas を作って PNG をエンコードするため、
  // 同じ結果になる呼び出しは捨てる。
  // 注意: 実際に描画したときだけ更新すること。早期returnの分岐で更新すると、
  // スマホで編集モードに入ったときの発火が「前回と同じ」と誤判定され、
  // 非表示中は描けないプレビューが永久に描かれなくなる。
  let lastRendered: string | null = null;

  function updatePreview(): void {
    if (!opts.pageImage || !cropCanvas.width) return;
    // 非表示の間は表示幅が0になり、正しいスケールを出せない。
    // 再表示されたら下の ResizeObserver が呼び直す。
    const renderedWidth = cropCanvas.getBoundingClientRect().width;
    if (renderedWidth <= 0) return;
    const trimmed = field.text.trim();
    if (!trimmed) {
      overlayImg.style.display = "none";
      lastRendered = null;
      return;
    }
    const scale = renderedWidth / cropCanvas.width;
    const key = [
      field.text,
      field.direction,
      field.fontSize,
      field.lineHeight,
      field.color,
      scale,
    ].join(" ");
    if (key === lastRendered) return;

    const size = measureText({
      text: field.text,
      fontSize: field.fontSize,
      lineHeight: field.lineHeight,
      direction: field.direction as typeof Direction.Horizon,
    });
    if (size.width <= 0 || size.height <= 0) {
      overlayImg.style.display = "none";
      lastRendered = null;
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
    overlayImg.src = `data:image/png;base64,${png}`;
    overlayImg.style.left = `${x * scale}px`;
    overlayImg.style.top = `${y * scale}px`;
    overlayImg.style.width = `${size.width * scale}px`;
    overlayImg.style.height = `${size.height * scale}px`;
    overlayImg.style.display = "block";
    lastRendered = key;
  }

  // --- 設問名(スマホのみ表示) + 縦横トグル + 文字数 ---
  const tools = document.createElement("div");
  tools.className = "es-editor-tools";
  const nameEl = document.createElement("span");
  nameEl.className = "es-field-name";
  nameEl.textContent = fieldLabel(field);
  tools.appendChild(nameEl);

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
  tools.appendChild(toggleWrap);

  const fitEl = document.createElement("span");
  fitEl.className = "es-fit";
  tools.appendChild(fitEl);
  el.appendChild(tools);

  // --- テキスト入力 ---
  const textarea = document.createElement("textarea");
  textarea.className = "es-textarea";
  textarea.value = field.text;
  textarea.placeholder = "ここに解答を入力";
  el.appendChild(textarea);

  // はみ出しの注意書き。公式の挙動を変えないため、保存は止めない
  const fitWarning = document.createElement("div");
  fitWarning.className = "es-warning";
  fitWarning.style.display = "none";
  fitWarning.style.margin = "10px 0 0";
  fitWarning.textContent =
    "このままでも保存できますが、解答用紙では文字が枠の外にはみ出して表示されます。文字数を減らすか、縦書きに変えるとおさまることがあります。";
  el.appendChild(fitWarning);

  const hints = document.createElement("div");
  hints.className = "es-key-hints";
  hints.innerHTML =
    "<span><kbd>Ctrl</kbd>+<kbd>↵</kbd>次の設問</span>" +
    "<span><kbd>Alt</kbd>+<kbd>↑↓</kbd>ページ送り</span>" +
    "<span><kbd>Ctrl</kbd>+<kbd>S</kbd>下書き保存</span>";
  el.appendChild(hints);

  function refreshToggle(): void {
    horizBtn.classList.toggle("active", field.direction === Direction.Horizon);
    vertBtn.classList.toggle("active", field.direction === Direction.Vertical);
  }

  /** 入力したテキストが解答欄(rim)に収まるかを、保存時と同じ計測式で判定する */
  function refreshFit(): void {
    const count = charCount(field.text);
    if (!field.text.trim()) {
      fitEl.textContent = "";
      fitEl.classList.remove("over");
      fitWarning.style.display = "none";
      return;
    }
    const size = measureText({
      text: field.text,
      fontSize: field.fontSize,
      lineHeight: field.lineHeight,
      direction: field.direction as typeof Direction.Horizon,
    });
    const over = size.width > field.raw.rim[2] || size.height > field.raw.rim[3];
    fitEl.textContent = over ? `${count}字 ／ 解答欄からはみ出します` : `${count}字 ／ 収まります`;
    fitEl.classList.toggle("over", over);
    fitWarning.style.display = over ? "block" : "none";
  }

  function onEdited(): void {
    refreshToggle();
    refreshFit();
    updatePreview();
    opts.onChange(field);
  }

  refreshToggle();
  refreshFit();

  horizBtn.addEventListener("click", () => {
    field.direction = Direction.Horizon;
    onEdited();
  });
  vertBtn.addEventListener("click", () => {
    field.direction = Direction.Vertical;
    onEdited();
  });
  textarea.addEventListener("input", () => {
    field.text = textarea.value;
    onEdited();
  });

  // 画像読み込み後に初期プレビューを描画
  if (opts.pageImage) {
    const img = new Image();
    img.onload = () => window.requestAnimationFrame(updatePreview);
    img.src = toImageSrc(opts.pageImage);
  }
  window.setTimeout(updatePreview, 50);

  // 2カラム化・編集モードへの切替・ウィンドウリサイズ・画面回転で表示幅が変わると
  // オーバーレイ画像の位置がずれるため、幅の変化を見て描き直す。
  const resizeObserver = new ResizeObserver(() => updatePreview());
  resizeObserver.observe(cropCanvas);

  return {
    element: el,
    getField: () => field,
    focus: () => textarea.focus(),
    destroy: () => resizeObserver.disconnect(),
  };
}
