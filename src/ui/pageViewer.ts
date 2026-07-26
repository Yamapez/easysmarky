import { toImageSrc } from "./cropPreview";

/** ビューアに表示するページ画像の種別 */
export type PageSource = "question" | "answer";

export interface PageViewerOptions {
  /** report.base64_question_images(問題ページ)。無い回もある */
  questionImages: string[];
  /** report.base64_answer_images(解答用紙ページ) */
  answerImages: string[];
}

export interface PageViewerHandle {
  element: HTMLElement;
  /** 指定した種別・添字(0始まり)のページを表示する */
  goTo(source: PageSource, index: number): void;
  /** いま表示している種別。設問からのジャンプ先を決めるのに使う */
  currentSource(): PageSource;
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

  let source: PageSource = questionImages.length > 0 ? "question" : "answer";
  let index = 0;
  let zoomStep = 0;

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

  // --- 画像 ---
  const scroll = document.createElement("div");
  scroll.className = "es-viewer-scroll";
  const img = document.createElement("img");
  img.className = "es-viewer-img";
  img.alt = "";
  img.decoding = "async";
  scroll.appendChild(img);
  el.appendChild(scroll);

  const emptyEl = document.createElement("div");
  emptyEl.className = "es-viewer-empty";
  emptyEl.textContent = "表示できるページ画像がありません。";
  emptyEl.style.display = "none";
  scroll.appendChild(emptyEl);

  function currentImages(): string[] {
    return source === "question" ? questionImages : answerImages;
  }

  function render(): void {
    const images = currentImages();
    const hasImages = images.length > 0;

    questionTab?.classList.toggle("active", source === "question");
    answerTab?.classList.toggle("active", source === "answer");

    img.style.display = hasImages ? "block" : "none";
    emptyEl.style.display = hasImages ? "none" : "block";
    countEl.textContent = hasImages ? `${index + 1} / ${images.length}` : "-";
    prevBtn.disabled = !hasImages || index <= 0;
    nextBtn.disabled = !hasImages || index >= images.length - 1;
    zoomOutBtn.disabled = zoomStep <= 0;
    zoomInBtn.disabled = zoomStep >= ZOOM_STEPS.length - 1;

    img.style.width = `${ZOOM_STEPS[zoomStep] * 100}%`;
    if (hasImages) {
      const nextSrc = toImageSrc(images[index]);
      // 同じページの再描画で読み込みが走らないようにする
      if (img.src !== nextSrc) img.src = nextSrc;
    } else {
      img.removeAttribute("src");
    }
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

  return { element: el, goTo, currentSource: () => source };
}
