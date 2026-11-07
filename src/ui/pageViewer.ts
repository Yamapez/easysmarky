import { toImageSrc } from "./cropPreview";
import { loadPrefs, updatePrefs } from "../storage/prefs";
import type { AnswerTextLayout } from "../render/answerLayout";
import type { SheetRect } from "../model/readingWindow";
import type { SheetSize } from "../model/sheetGeometry";

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
  /**
   * 入力した文字を枠の上に重ねて見せる(保存される画像と同じ描画。位置は解答欄の中央)。
   * 文字が無い設問は null。座標は用紙の絶対座標(rim と同じ)。
   * 下書きを再開した設問は保存時に既存の位置を引き継ぐため、保存結果とずれることがある。
   */
  text?: (fieldId: number) => AnswerTextLayout | null;
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
  /**
   * true のとき、手動で選んだ倍率(＋/−・ピンチ)を easysmarky:prefs に記憶し、次回の初期値にする。
   * 記憶した倍率は自動ズームの「下限」になる(設問を選んだときの自動拡大は、それより小さくしない)。
   * 「全体」で記憶を消し、従来どおりの自動ズームに戻る。読むモードは記憶しない(拡大率の既定が別のため)。
   */
  zoomMemory?: boolean;
  /** 指定があると「読む」ボタンを出す(全画面の読むモードを開く)。読むモードには渡さない */
  onOpenReader?: () => void;
  /** 最初に表示する種別・ページ。既定は問題ページがあれば問題の先頭、無ければ解答用紙の先頭 */
  initialSource?: PageSource;
  initialIndex?: number;
  /** 最初に見せたい位置(画像に対する割合。x は水平中心、y は上端)。読み込み後にスクロールする */
  focus?: { x: number; y: number };
  /**
   * 指定すると、ページごとに「ここだけ見せる」窓を返す(読むモードの設問まわり表示)。
   * rect は解答用紙の座標系、sheet はその用紙の大きさ。null を返したページは全体を表示する。
   * 窓は表示だけの切り出しで、保存される画像や座標には影響しない。
   */
  cropTo?: (source: PageSource, index: number) => { rect: SheetRect; sheet: SheetSize } | null;
  /** 窓表示の初期状態。既定は on(cropTo があるときだけ効く) */
  cropOn?: boolean;
  /** 描画のたびに、いま表示している種別・ページを知らせる(窓ボタンの押下状態を実際の表示に合わせるため) */
  onRender?: (state: { source: PageSource; index: number }) => void;
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
  /** 記憶していた倍率(zoomMemory のときだけ)。自動ズームの下限にも使う */
  const remembered = opts.zoomMemory ? loadPrefs().zoom : null;
  /** ズーム倍率。1 = ペイン幅にフィット。設問を切り替えても保持する(手動で拡大した状態を壊さない) */
  let zoomScale = opts.initialZoom ?? remembered ?? 1;
  /** 自動ズームの下限。記憶した倍率が無ければ 1(従来どおり) */
  const zoomFloor = remembered ?? 1;
  /** ＋/−/ピンチで手動に変えたら true。「全体」を押すまで、設問へのジャンプで自動ズームしない */
  let userZoomed = opts.initialZoom != null;
  let activeFieldId: number | null = null;
  /** showField() が要求した「まだ見せられていない」設問。画像の読み込み完了後にパンする */
  let pendingFocusId: number | null = null;
  /** 窓表示のON/OFF。cropTo が無ければ常に全体。切り替えは組み直し(呼び出し側)で行う */
  const cropOn = opts.cropOn ?? true;

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
  /** 入力文字の画像。枠の子にはしない(枠の opacity に引きずられず、枠の上に出すため兄弟にする) */
  const textEls = new Map<number, HTMLImageElement>();

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
    textEls.clear();
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

      // 文字の画像は枠より後に足す(上に重なる)。位置と中身は paintRims で決める
      if (rims.text) {
        const textEl = document.createElement("img");
        textEl.className = "es-rim-text";
        textEl.dataset.fieldId = String(field.id);
        textEl.alt = "";
        textEl.style.display = "none";
        rimLayer.appendChild(textEl);
        textEls.set(field.id, textEl);
      }
    }
    paintRims();
  }

  /** 入力された文字を、用紙座標のまま枠と同じ百分率で置く。文字が無ければ隠す */
  function paintTexts(sheet: { width: number; height: number } | null): void {
    if (!rims?.text) return;
    for (const [fieldId, textEl] of textEls) {
      const layout = sheet ? rims.text(fieldId) : null;
      if (!sheet || !layout) {
        textEl.style.display = "none";
        continue;
      }
      const src = `data:image/png;base64,${layout.png}`;
      // 同じ画像の再代入でもレイアウトを触らないよう、差があるときだけ書く
      if (textEl.getAttribute("src") !== src) textEl.setAttribute("src", src);
      textEl.style.left = `${(layout.x / sheet.width) * 100}%`;
      textEl.style.top = `${(layout.y / sheet.height) * 100}%`;
      textEl.style.width = `${(layout.width / sheet.width) * 100}%`;
      textEl.style.height = `${(layout.height / sheet.height) * 100}%`;
      textEl.style.display = "block";
    }
  }

  function paintRims(): void {
    if (!rims) return;
    paintTexts(currentSheetSize());
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

    if (hasImages) {
      const nextSrc = toImageSrc(images[index]);
      // 同じページの再描画で読み込みが走らないようにする
      if (img.src !== nextSrc) img.src = nextSrc;
    } else {
      img.removeAttribute("src");
    }
    applyCrop();
    applyCanvasWidth();
    renderRims();
    opts.onRender?.({ source, index });
  }

  /** 窓表示(切り出し)中の矩形。null なら全体表示 */
  let activeCrop: { rect: SheetRect } | null = null;

  /**
   * canvas の幅を倍率から決める。render() とピンチ中の更新の両方がこれを通るので、
   * 窓表示の式と全体表示の式がずれない。
   */
  function applyCanvasWidth(): void {
    if (activeCrop) {
      const { rect } = activeCrop;
      // 窓は縦横どちらも画面に収める(縦長の窓が画面の高さを超えないように)。
      // 倍率1は「窓が画面に収まる最大」で、そこから拡大すると scroll する。
      // 高さの基準は .es-reader の scroll に container-type: size を当てた cqh(style.css 側)
      // 倍率1で「幅・高さの両方に収まる最大」になり、倍率を上げるとその分だけ大きくなる
      canvas.style.width = `calc(${zoomScale} * min(100cqw, ${(rect.width / rect.height) * 100}cqh))`;
    } else {
      canvas.style.width = `${zoomScale * 100}%`;
    }
  }

  /**
   * 窓表示のとき、画像のうち切り出し範囲だけが canvas いっぱいに来るよう配置する。
   * 範囲の比率を canvas の縦横比にし、画像は用紙の大きさに対する百分率で絶対配置する
   * (枠と同じ考え方なので、ズームしてもずれない)。画像は引き伸ばしだけで、保存には関係しない。
   */
  function applyCrop(): void {
    const crop = cropOn && opts.cropTo ? opts.cropTo(source, index) : null;
    if (!crop || crop.rect.width <= 0 || crop.rect.height <= 0) {
      activeCrop = null;
      canvas.classList.remove("is-cropped");
      canvas.style.aspectRatio = "";
      img.style.cssText = "";
      return;
    }
    const { rect, sheet } = crop;
    activeCrop = { rect };
    canvas.classList.add("is-cropped");
    canvas.style.aspectRatio = `${rect.width} / ${rect.height}`;
    img.style.position = "absolute";
    img.style.maxWidth = "none";
    img.style.width = `${(sheet.width / rect.width) * 100}%`;
    img.style.height = `${(sheet.height / rect.height) * 100}%`;
    img.style.left = `${-(rect.x / rect.width) * 100}%`;
    img.style.top = `${-(rect.y / rect.height) * 100}%`;
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
      // 記憶した倍率(zoomFloor)より小さくはしない。記憶が無いときは従来どおり 1 以上
      const nextScale = Math.max(zoomFloor, Math.min(maxZoom, Math.max(1, 1 / contextFrac)));
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
    rememberZoom(zoomScale);
    render();
  });
  zoomOutBtn.addEventListener("click", () => {
    userZoomed = true;
    zoomScale = [...ZOOM_STEPS].reverse().find((s) => s < zoomScale - 0.01) ?? ZOOM_STEPS[0];
    rememberZoom(zoomScale);
    render();
  });
  zoomFitBtn.addEventListener("click", () => {
    zoomScale = 1;
    userZoomed = false;
    // 「全体」は記憶も消す(次回から従来どおりの自動ズームに戻る)
    rememberZoom(null);
    scroll.scrollTo(0, 0);
    render();
  });

  // --- ピンチズーム(2本指のときだけ処理する。1本指のパン・タップはブラウザと枠の click に任せる) ---
  // touch-action を pan-x pan-y にして、ブラウザ側のピンチ拡大を止める(ページ全体が拡大するのを防ぐ)
  scroll.style.touchAction = "pan-x pan-y";
  /** 押されている指の位置(pointerId → clientX/Y)。離れたら消す */
  const pointers = new Map<number, { x: number; y: number }>();
  /** ピンチ開始時の状態。開始距離・開始倍率と、開始時の中心点(canvas の割合座標) */
  let pinch: { startDist: number; startZoom: number; fracX: number; fracY: number } | null = null;
  /** ピンチ中と離した直後は、枠の click を捨てる(2本指で枠を触っても入力に入らないように) */
  let suppressClicks = false;
  let suppressTimer: number | null = null;
  /** 離してからこの時間が過ぎたら click の抑止を解く */
  const CLICK_RELEASE_MS = 350;

  function rememberZoom(value: number | null): void {
    if (!opts.zoomMemory) return;
    updatePrefs({ zoom: value });
  }

  function clampZoom(value: number): number {
    return Math.min(Math.max(value, ZOOM_STEPS[0]), ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  }

  function twoPointers(): [{ x: number; y: number }, { x: number; y: number }] | null {
    if (pointers.size < 2) return null;
    const [a, b] = [...pointers.values()];
    return [a, b];
  }

  /** 中心点(クライアント座標)を、スクロール領域の左上からの位置で返す */
  function centerInScroll(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
    const rect = scroll.getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
  }

  function startPinch(): void {
    const pair = twoPointers();
    if (!pair) return;
    const [a, b] = pair;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const center = centerInScroll(a, b);
    // 中心点が画像のどこ(canvas の割合)を指しているかを覚えておき、拡大・縮小の間も同じ点を指すようにする
    const canvasW = Math.max(canvas.offsetWidth, 1);
    const canvasH = Math.max(canvas.offsetHeight, 1);
    pinch = {
      startDist: Math.max(dist, 1),
      startZoom: zoomScale,
      fracX: (scroll.scrollLeft + center.x) / canvasW,
      fracY: (scroll.scrollTop + center.y) / canvasH,
    };
    suppressClicks = true;
    if (suppressTimer != null) {
      window.clearTimeout(suppressTimer);
      suppressTimer = null;
    }
    // 2本とも離さず追えるように捕まえる(片方が枠の上で始まっても、ピンチは scroll 領域で受ける)
    for (const id of pointers.keys()) {
      try {
        scroll.setPointerCapture(id);
      } catch {
        /* 捕まえられない環境でも、bubble で届く分だけで動く */
      }
    }
  }

  /** ピンチ中は canvas の幅だけを変える。renderRims() は毎回 DOM を作り直すので呼ばない(離したときに render する) */
  function updatePinch(): void {
    const pair = twoPointers();
    if (!pinch || !pair) return;
    const [a, b] = pair;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    zoomScale = clampZoom(pinch.startZoom * (dist / pinch.startDist));
    userZoomed = true;
    applyCanvasWidth();
    // 同じ画像上の点が、指の中心に留まるようにスクロールを補正する
    const center = centerInScroll(a, b);
    scroll.scrollLeft = pinch.fracX * canvas.offsetWidth - center.x;
    scroll.scrollTop = pinch.fracY * canvas.offsetHeight - center.y;
  }

  function finishPinch(): void {
    if (!pinch) return;
    const changed = Math.abs(zoomScale - pinch.startZoom) > 0.01;
    pinch = null;
    if (changed) rememberZoom(zoomScale);
    // ボタンの有効・無効や枠の位置を、離した時点の倍率で一度だけ揃える
    render();
  }

  function scheduleClickRelease(): void {
    if (suppressTimer != null) window.clearTimeout(suppressTimer);
    suppressTimer = window.setTimeout(() => {
      suppressClicks = false;
      suppressTimer = null;
    }, CLICK_RELEASE_MS);
  }

  scroll.addEventListener("pointerdown", (event: PointerEvent) => {
    // 前の操作の取り残し(離した通知が来なかった指)を捨て、今の指だけで数え直す
    if (pointers.size === 0 && suppressTimer == null) suppressClicks = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) startPinch();
  });
  scroll.addEventListener("pointermove", (event: PointerEvent) => {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX;
    p.y = event.clientY;
    if (pinch) updatePinch();
  });
  const endPointer = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    if (pinch && pointers.size < 2) finishPinch();
    if (pointers.size === 0) scheduleClickRelease();
  };
  scroll.addEventListener("pointerup", endPointer);
  scroll.addEventListener("pointercancel", endPointer);
  // ピンチ中に離れた click を、枠より先(capture)で止める
  scroll.addEventListener(
    "click",
    (event: MouseEvent) => {
      if (!suppressClicks) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

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
