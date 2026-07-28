import { toImageSrc } from "./cropPreview";

/** ビューアに表示するページ画像の種別 */
export type PageSource = "question" | "answer";

/** ページ画像の上に重ねる解答欄の枠 */
export interface RimFieldInfo {
  id: number;
  page: number;
  /** [x, y, width, height]。base_sheet の座標系 */
  rim: [number, number, number, number];
  label: string;
  /** easysmarkyで編集できない設問(選択肢・画像・複数スタンプ) */
  locked: boolean;
}

export interface RimOptions {
  fields: RimFieldInfo[];
  /**
   * 表示中の解答用紙ページの rim 座標系のサイズ(base_sheet.correct_image_size 由来)。
   * ページごとに違いうるので添字で引く。取れなければ null = 枠を出さない。
   */
  pageSize: (index: number) => { width: number; height: number } | null;
  isFilled: (fieldId: number) => boolean;
  onSelect: (fieldId: number) => void;
}

export interface PageViewerOptions {
  /** report.base64_question_images(問題ページ)。無い回もある */
  questionImages: string[];
  /** report.base64_answer_images(解答用紙ページ) */
  answerImages: string[];
  /**
   * 解答欄の枠。rim は解答用紙の座標系なので、枠を出すのは「解答用紙」表示中だけにする。
   * 問題ページ側で同じ座標が通用するかは実機で未確認のため重ねない。
   */
  rims?: RimOptions;
}

export interface PageViewerHandle {
  element: HTMLElement;
  /** 指定した種別・添字(0始まり)のページを表示する */
  goTo(source: PageSource, index: number): void;
  /** いま表示している種別。設問からのジャンプ先を決めるのに使う */
  currentSource(): PageSource;
  /** 前後のページへ送る(キーボードショートカット用) */
  step(delta: number): void;
  /** その設問があるページを(いま見ている種別のまま)開き、枠を選択状態にする */
  showField(fieldId: number): void;
  /** 入力状況が変わったときに枠の色を塗り直す */
  refreshRims(): void;
}

/** ズーム倍率。1 = ペイン幅にフィット */
const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/**
 * base_sheet_field.page を画像配列の添字に変換する。
 * page が 0 始まりか 1 始まりかを実機で確認できていないため、両方を試す。
 */
export function pageArrayIndex(images: string[], page: number): number {
  if (images[page - 1] != null) return page - 1;
  if (images[page] != null) return page;
  return 0;
}

/**
 * 問題ページ/解答用紙ページを閲覧するビューア。
 * 表示中のページだけ img.src を設定する(全ページのbase64 JPEGを一度に抱えるとスマホで重い)。
 */
export function createPageViewer(opts: PageViewerOptions): PageViewerHandle {
  const questionImages = opts.questionImages ?? [];
  const answerImages = opts.answerImages ?? [];
  const rims = opts.rims;

  let source: PageSource = questionImages.length > 0 ? "question" : "answer";
  let index = 0;
  let zoomStep = 0;
  let activeFieldId: number | null = null;

  const el = document.createElement("div");
  el.className = "es-viewer";

  const bar = document.createElement("div");
  bar.className = "es-viewer-bar";
  el.appendChild(bar);

  // --- 種別タブ(問題ページが無い回では出さない) ---
  let questionTab: HTMLButtonElement | null = null;
  let answerTab: HTMLButtonElement | null = null;
  if (questionImages.length > 0) {
    const tabs = document.createElement("div");
    tabs.className = "es-viewer-tabs";
    questionTab = document.createElement("button");
    questionTab.type = "button";
    questionTab.textContent = "問題";
    answerTab = document.createElement("button");
    answerTab.type = "button";
    answerTab.textContent = "解答用紙";
    tabs.appendChild(questionTab);
    tabs.appendChild(answerTab);
    bar.appendChild(tabs);

    questionTab.addEventListener("click", () => goTo("question", 0));
    answerTab.addEventListener("click", () => goTo("answer", 0));
  }

  // --- ページ送り ---
  const pager = document.createElement("div");
  pager.className = "es-viewer-pager";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "◀";
  prevBtn.setAttribute("aria-label", "前のページ");
  const countEl = document.createElement("span");
  countEl.className = "es-viewer-count";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "▶";
  nextBtn.setAttribute("aria-label", "次のページ");
  pager.appendChild(prevBtn);
  pager.appendChild(countEl);
  pager.appendChild(nextBtn);
  bar.appendChild(pager);

  // --- ズーム ---
  const zoom = document.createElement("div");
  zoom.className = "es-viewer-zoom";
  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.type = "button";
  zoomOutBtn.textContent = "−";
  zoomOutBtn.setAttribute("aria-label", "縮小");
  const zoomFitBtn = document.createElement("button");
  zoomFitBtn.type = "button";
  zoomFitBtn.textContent = "全体";
  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.textContent = "＋";
  zoomInBtn.setAttribute("aria-label", "拡大");
  zoom.appendChild(zoomOutBtn);
  zoom.appendChild(zoomFitBtn);
  zoom.appendChild(zoomInBtn);
  bar.appendChild(zoom);

  // --- 画像 + 解答欄の枠 ---
  const body = document.createElement("div");
  body.className = "es-viewer-body";
  const scroll = document.createElement("div");
  scroll.className = "es-viewer-scroll";
  const canvas = document.createElement("div");
  canvas.className = "es-viewer-canvas";
  const img = document.createElement("img");
  img.className = "es-viewer-img";
  img.alt = "";
  img.decoding = "async";
  const rimLayer = document.createElement("div");
  rimLayer.className = "es-viewer-rims";
  canvas.appendChild(img);
  canvas.appendChild(rimLayer);
  scroll.appendChild(canvas);
  body.appendChild(scroll);
  el.appendChild(body);

  const emptyEl = document.createElement("div");
  emptyEl.className = "es-viewer-empty";
  emptyEl.textContent = "表示できるページ画像がありません。";
  emptyEl.style.display = "none";
  scroll.appendChild(emptyEl);

  // --- 凡例(枠を出しているときだけ) ---
  const legend = document.createElement("div");
  legend.className = "es-viewer-legend";
  legend.innerHTML =
    '<span><span class="es-legend-swatch filled"></span>入力済み</span>' +
    '<span><span class="es-legend-swatch active"></span>入力中</span>' +
    '<span><span class="es-legend-swatch empty"></span>未入力</span>';
  legend.style.display = "none";
  body.appendChild(legend);

  const rimEls = new Map<number, HTMLButtonElement>();

  function currentImages(): string[] {
    return source === "question" ? questionImages : answerImages;
  }

  /** いま枠を描いてよいか(解答用紙を表示していて、そのページの座標系が分かっているとき) */
  function currentSheetSize(): { width: number; height: number } | null {
    if (!rims || source !== "answer" || answerImages.length === 0) return null;
    return rims.pageSize(index);
  }

  function renderRims(): void {
    rimEls.clear();
    rimLayer.innerHTML = "";
    const sheet = currentSheetSize();
    if (!rims || !sheet) {
      rimLayer.style.display = "none";
      legend.style.display = "none";
      return;
    }
    rimLayer.style.display = "block";
    legend.style.display = "flex";

    for (const field of rims.fields) {
      if (pageArrayIndex(answerImages, field.page) !== index) continue;
      const [x, y, w, h] = field.rim;
      const box = document.createElement("button");
      box.type = "button";
      box.className = "es-rim";
      box.dataset.fieldId = String(field.id);
      // ズーム段階が変わっても追従するよう、用紙サイズに対する百分率で置く
      box.style.left = `${(x / sheet.width) * 100}%`;
      box.style.top = `${(y / sheet.height) * 100}%`;
      box.style.width = `${(w / sheet.width) * 100}%`;
      box.style.height = `${(h / sheet.height) * 100}%`;

      const label = document.createElement("span");
      label.className = "es-rim-label";
      box.appendChild(label);

      if (field.locked) {
        box.disabled = true;
      } else {
        box.addEventListener("click", () => rims.onSelect(field.id));
      }
      rimLayer.appendChild(box);
      rimEls.set(field.id, box);
    }
    paintRims();
  }

  function paintRims(): void {
    if (!rims) return;
    for (const field of rims.fields) {
      const box = rimEls.get(field.id);
      if (!box) continue;
      const active = field.id === activeFieldId;
      const filled = rims.isFilled(field.id);
      box.classList.toggle("locked", field.locked);
      box.classList.toggle("active", active && !field.locked);
      box.classList.toggle("filled", filled && !active && !field.locked);
      const labelEl = box.querySelector(".es-rim-label");
      if (labelEl) {
        labelEl.textContent = field.locked
          ? `${field.label} — 編集不可`
          : active
            ? `${field.label} — 入力中`
            : filled
              ? field.label
              : `${field.label} — 未入力`;
      }
    }
  }

  function render(): void {
    const images = currentImages();
    const hasImages = images.length > 0;

    questionTab?.classList.toggle("active", source === "question");
    answerTab?.classList.toggle("active", source === "answer");

    canvas.style.display = hasImages ? "block" : "none";
    emptyEl.style.display = hasImages ? "none" : "block";
    countEl.textContent = hasImages ? `${index + 1} / ${images.length}` : "-";
    prevBtn.disabled = !hasImages || index <= 0;
    nextBtn.disabled = !hasImages || index >= images.length - 1;
    zoomOutBtn.disabled = zoomStep <= 0;
    zoomInBtn.disabled = zoomStep >= ZOOM_STEPS.length - 1;

    canvas.style.width = `${ZOOM_STEPS[zoomStep] * 100}%`;
    if (hasImages) {
      const nextSrc = toImageSrc(images[index]);
      // 同じページの再描画で読み込みが走らないようにする
      if (img.src !== nextSrc) img.src = nextSrc;
    } else {
      img.removeAttribute("src");
    }
    renderRims();
  }

  function goTo(nextSource: PageSource, nextIndex: number): void {
    const images = nextSource === "question" ? questionImages : answerImages;
    if (images.length === 0 && nextSource === "question") return;
    source = nextSource;
    index = Math.min(Math.max(nextIndex, 0), Math.max(images.length - 1, 0));
    zoomStep = 0;
    scroll.scrollTo(0, 0);
    render();
  }

  function step(delta: number): void {
    goTo(source, index + delta);
  }

  function showField(fieldId: number): void {
    activeFieldId = fieldId;
    const field = rims?.fields.find((f) => f.id === fieldId);
    const images = currentImages();
    if (!field || images.length === 0) {
      paintRims();
      return;
    }
    // 種別(問題/解答用紙)は変えない。読んでいる途中で勝手に切り替わらないようにする
    const wanted = pageArrayIndex(images, field.page);
    if (index !== wanted) {
      goTo(source, wanted);
    } else {
      paintRims();
    }
    // 拡大中でも選択した枠が見えるように寄せる
    rimEls.get(fieldId)?.scrollIntoView({ block: "center", inline: "center" });
  }

  prevBtn.addEventListener("click", () => goTo(source, index - 1));
  nextBtn.addEventListener("click", () => goTo(source, index + 1));
  zoomInBtn.addEventListener("click", () => {
    zoomStep = Math.min(zoomStep + 1, ZOOM_STEPS.length - 1);
    render();
  });
  zoomOutBtn.addEventListener("click", () => {
    zoomStep = Math.max(zoomStep - 1, 0);
    render();
  });
  zoomFitBtn.addEventListener("click", () => {
    zoomStep = 0;
    scroll.scrollTo(0, 0);
    render();
  });

  render();

  return {
    element: el,
    goTo,
    currentSource: () => source,
    step,
    showField,
    refreshRims: paintRims,
  };
}
