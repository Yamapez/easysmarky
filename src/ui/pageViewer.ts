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
  /** 初期ズーム倍率。指定すると「全体」に戻すまで設問ジャンプで自動ズームしない */
  initialZoom?: number;
  /** 指定があると「読む」ボタンを出す(全画面の読むモードを開く)。読むモードには渡さない */
  onOpenReader?: () => void;
  /** 最初に表示する種別・ページ。既定は問題ページがあれば問題の先頭、無ければ解答用紙の先頭 */
  initialSource?: PageSource;
  initialIndex?: number;
  /** 最初に見せたい位置(画像に対する割合。x は水平中心、y は上端)。読み込み後にスクロールする */
  focus?: { x: number; y: number };
}

export interface PageViewerHandle {
  element: HTMLElement;
  /** 指定した種別・添字(0始まり)のページを表示する */
  goTo(source: PageSource, index: number): void;
  /** いま表示している種別。設問からのジャンプ先を決めるのに使う */
  currentSource(): PageSource;
  /** いま表示しているページの添字(0始まり) */
  currentIndex(): number;
  /** 前後のページへ送る(キーボードショートカット用) */
  step(delta: number): void;
  /** その設問があるページを(いま見ている種別のまま)開き、枠を選択状態にする */
  showField(fieldId: number): void;
  /** 入力状況が変わったときに枠の色を塗り直す */
  refreshRims(): void;
}

/** ズーム倍率。1 = ペイン幅にフィット */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

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

  let source: PageSource = opts.initialSource ?? (questionImages.length > 0 ? "question" : "answer");
  // goTo と同じく範囲内に収める(範囲外の添字では画像が無く、描画で落ちる)
  const initialCount = (source === "question" ? questionImages : answerImages).length;
  let index = Math.min(Math.max(opts.initialIndex ?? 0, 0), Math.max(initialCount - 1, 0));
  /** ズーム倍率。1 = ペイン幅にフィット。設問を切り替えても保持する(手動で拡大した状態を壊さない) */
  let zoomScale = opts.initialZoom ?? 1;
  /** ＋/−で拡大したら true。「全体」を押すまで、設問へのジャンプで自動ズームしない */
  let userZoomed = opts.initialZoom != null;
  let activeFieldId: number | null = null;
  /** showField() が要求した「まだ見せられていない」設問。画像の読み込み完了後にパンする */
  let pendingFocusId: number | null = null;

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

    questionTab.addEventListener("click", () => {
      pendingFocusId = null;
      goTo("question", 0);
    });
    answerTab.addEventListener("click", () => {
      pendingFocusId = null;
      goTo("answer", 0);
    });
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
  if (opts.onOpenReader) {
    const readBtn = document.createElement("button");
    readBtn.type = "button";
    readBtn.textContent = "読む";
    readBtn.setAttribute("aria-label", "ページを全画面で読む");
    readBtn.addEventListener("click", () => opts.onOpenReader?.());
    zoom.appendChild(readBtn);
  }
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
      legend.classList.remove("is-on");
      return;
    }
    rimLayer.style.display = "block";
    // display をインラインで書かない。狭い画面ではメディアクエリで凡例を消すので、
    // インライン指定にすると CSS 側から消せなくなる
    legend.classList.add("is-on");

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
    rimLayer.classList.toggle("has-active", activeFieldId != null && rimEls.has(activeFieldId));
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
    zoomOutBtn.disabled = zoomScale <= ZOOM_STEPS[0] + 0.01;
    zoomInBtn.disabled = zoomScale >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.01;

    canvas.style.width = `${zoomScale * 100}%`;
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
    const clampedIndex = Math.min(Math.max(nextIndex, 0), Math.max(images.length - 1, 0));
    const pageChanged = nextSource !== source || clampedIndex !== index;
    source = nextSource;
    index = clampedIndex;
    // ズームは保持する。ただし showField 経由(pendingFocusId あり)以外でページが変わった
    // ときは、素のページ送りとして新しいページの頭から読めるようスクロールだけ戻す
    if (pageChanged && pendingFocusId == null) {
      scroll.scrollTo(0, 0);
    }
    render();
  }

  function step(delta: number): void {
    pendingFocusId = null;
    goTo(source, index + delta);
  }

  /** 画像の実サイズ(＝レイアウト)が確定してから cb を呼ぶ */
  function whenImageReady(cb: () => void): void {
    if (img.complete && img.naturalWidth > 0) {
      requestAnimationFrame(cb);
    } else {
      img.addEventListener("load", () => requestAnimationFrame(cb), { once: true });
    }
  }

  /** pendingFocusId の設問へ、必要なら自動ズームしたうえで枠が読める位置までパンする */
  function focusActiveRim(): void {
    const fieldId = pendingFocusId;
    if (fieldId == null) return;
    // 消費したら即座にクリアする。積み残った load リスナーからの二重呼び出しを無害化し、
    // 後続のページ送り(step/タブ)が普段どおりスクロールを先頭に戻せるようにする
    pendingFocusId = null;
    const field = rims?.fields.find((f) => f.id === fieldId);
    const sheet = currentSheetSize();
    if (!field || !sheet) return;
    const vw = scroll.clientWidth;
    const vh = scroll.clientHeight;
    // スマホの入力モードなどビューアが display:none のときは何もしない(戻ってきたときに再度呼ばれる)
    if (vw === 0 || vh === 0) return;

    // ビューアが低いとき(常時分割のモバイル)は、同じ倍率・同じオフセットで
    // パンすると枠がビューアの大半を占め、直前の設問文が見えなくなる。
    // 低いほど拡大を抑え、上端を下げて文脈を多く残す。
    const short = vh < 320;

    if (!userZoomed) {
      const rimWidthFrac = field.rim[2] / sheet.width;
      const contextFrac = Math.min(1, rimWidthFrac + 0.3);
      const maxZoom = short ? 2 : 3;
      const nextScale = Math.min(maxZoom, Math.max(1, 1 / contextFrac));
      if (Math.abs(nextScale - zoomScale) > 0.01) {
        zoomScale = nextScale;
        render();
      }
    }

    requestAnimationFrame(() => {
      const box = rimEls.get(fieldId);
      if (!box) return;
      scroll.scrollTo({
        left: box.offsetLeft + box.offsetWidth / 2 - vw / 2,
        // 上端をやや上寄りに置く。枠の直前にある設問文が視界に入るように
        top: box.offsetTop - vh * (short ? 0.55 : 0.35),
      });
    });
  }

  function showField(fieldId: number): void {
    activeFieldId = fieldId;
    const field = rims?.fields.find((f) => f.id === fieldId);
    const images = currentImages();
    if (!field || images.length === 0) {
      pendingFocusId = null;
      paintRims();
      return;
    }
    pendingFocusId = fieldId;
    // 種別(問題/解答用紙)は変えない。読んでいる途中で勝手に切り替わらないようにする
    const wanted = pageArrayIndex(images, field.page);
    if (index !== wanted) {
      goTo(source, wanted);
    } else {
      paintRims();
    }
    whenImageReady(focusActiveRim);
  }

  prevBtn.addEventListener("click", () => {
    pendingFocusId = null;
    goTo(source, index - 1);
  });
  nextBtn.addEventListener("click", () => {
    pendingFocusId = null;
    goTo(source, index + 1);
  });
  zoomInBtn.addEventListener("click", () => {
    userZoomed = true;
    zoomScale = ZOOM_STEPS.find((s) => s > zoomScale + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    render();
  });
  zoomOutBtn.addEventListener("click", () => {
    userZoomed = true;
    zoomScale = [...ZOOM_STEPS].reverse().find((s) => s < zoomScale - 0.01) ?? ZOOM_STEPS[0];
    render();
  });
  zoomFitBtn.addEventListener("click", () => {
    zoomScale = 1;
    userZoomed = false;
    scroll.scrollTo(0, 0);
    render();
  });

  render();

  // 読み込み後に、指定位置(設問の枠など)を見える範囲に入れる。
  // 縦書きは右端から始まるため、既定の左上から読ませると本文を探すのに何画面もスクロールが要る
  if (opts.focus) {
    const focus = opts.focus;
    whenImageReady(() => {
      scroll.scrollTo({
        left: focus.x * canvas.clientWidth - scroll.clientWidth / 2,
        top: focus.y * canvas.clientHeight - scroll.clientHeight * 0.35,
      });
    });
  }

  return {
    element: el,
    goTo,
    currentSource: () => source,
    currentIndex: () => index,
    step,
    showField,
    refreshRims: paintRims,
  };
}
