import { AnswerType, Direction } from "../api/types";
import { isEditableField, type EditableField } from "../model/field";
import { layoutAnswerText } from "../render/answerLayout";
import { measureText } from "../render/measure";
import { drawCropPreview, type CropRect } from "./cropPreview";

export interface FieldEditorOptions {
  field: EditableField;
  /** その設問がある解答用紙ページの画像 */
  pageImage: string | null;
  /** その設問がある問題ページの画像。PC幅でのみ解答欄プレビューの横に表示する */
  questionPageImage: string | null;
  cutMargin: number;
  /**
   * この設問がある解答用紙ページの rim 座標系(base_sheet.correct_image_size 由来)。
   * ページ画像の実解像度と一致しないことがあるので、切り出しの換算に使う。
   * 0 なら換算しない(ページ画像のピクセル = rim 座標 とみなす)
   */
  sheetWidth: number;
  sheetHeight: number;
  /** 同じく問題ページ側(question_image_size 由来)。解答用紙とは別の座標系でありうる */
  questionSheetWidth: number;
  questionSheetHeight: number;
  /** base_sheet.dpi。プレビューに足す余白を実寸(mm)基準で決めるのに使う */
  sheetDpi?: number;
  onChange: (field: EditableField) => void;
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

  if (!isEditableField(field)) {
    const card = document.createElement("div");
    card.className = "es-field-locked";
    const name = document.createElement("div");
    name.className = "es-field-locked-name";
    name.textContent = fieldLabel(field);
    const note = document.createElement("div");
    note.className = "es-field-locked-note";
    const hasOwnEditor = field.isEditableText || field.isEditableChoice;
    note.textContent = hasOwnEditor
      ? "この設問には複数の解答が既に入力されています。現バージョンのeasysmarkyでは編集できません(公式画面をご利用ください)。"
      : field.raw.answer_type === AnswerType.Choice
        ? "この設問は選択肢の一覧が取得できないため、easysmarkyでは編集できません(公式画面をご利用ください)。"
        : "この設問は画像などの解答欄のため、easysmarkyでは編集できません(公式画面をご利用ください)。";
    card.appendChild(name);
    card.appendChild(note);
    el.appendChild(card);
    return { element: el, getField: () => field, focus: () => {}, destroy: () => {} };
  }

  // --- 解答欄プレビュー(切り抜き画像 + 描画されるテキストの重ね合わせ) ---
  const previewHead = document.createElement("div");
  previewHead.className = "es-preview-head";
  const previewChip = document.createElement("span");
  previewChip.className = "es-preview-chip";
  previewChip.textContent = fieldShortLabel(field);
  const previewLabel = document.createElement("span");
  previewLabel.textContent = "の解答欄";
  const previewNote = document.createElement("span");
  previewNote.className = "es-preview-note";
  previewNote.textContent = "枠の内側が解答欄";
  previewHead.appendChild(previewChip);
  previewHead.appendChild(previewLabel);
  previewHead.appendChild(previewNote);
  el.appendChild(previewHead);

  const previewRow = document.createElement("div");
  previewRow.className = "es-preview-row";
  el.appendChild(previewRow);

  // 表示できる幅を測るための枠。**canvas ではなくこれを ResizeObserver で見る。**
  // canvas の表示幅は updatePreview がこの幅から決めるので、canvas 自身を観測すると
  // 「測る → 広げる → また発火」の無限ループになる(styles.ts 側で content が
  // このスロットを押し広げられないようにもしてある)。
  const previewSlot = document.createElement("div");
  previewSlot.className = "es-preview-slot";
  previewRow.appendChild(previewSlot);

  const previewWrap = document.createElement("div");
  previewWrap.className = "es-preview-wrap";
  const cropCanvas = document.createElement("canvas");
  cropCanvas.className = "es-crop";
  const overlayImg = document.createElement("img");
  overlayImg.className = "es-preview-overlay";
  overlayImg.style.display = "none";
  // 保存される範囲(rim)の境界。余白を広げて見せるぶん、どこまでが解答欄かを示す
  const rimGuide = document.createElement("div");
  rimGuide.className = "es-rim-guide";
  rimGuide.style.display = "none";
  previewWrap.appendChild(cropCanvas);
  previewWrap.appendChild(rimGuide);
  previewWrap.appendChild(overlayImg);
  previewSlot.appendChild(previewWrap);

  // drawCropPreview が実際に切り出した矩形(base_sheet座標)。オーバーレイのスケールと
  // 位置は必ずこれを基準に計算する。null の間はまだ描く準備ができていない。
  let crop: CropRect | null = null;

  /**
   * プレビューだけに足す余白。cut_margin は実機で 200dpi の 20px(約2.5mm)しかなく、
   * rim と印字された解答欄がわずかにずれているだけで枠の縁が切れて見える。
   * ズレはスキャンの位置合わせ由来で解答欄の大きさには比例しないので、
   * 用紙上の実寸(片側2mm)で足す。dpi が分からなければ cut_margin と同じだけ広げる。
   */
  const extraPadding = opts.sheetDpi && opts.sheetDpi > 0
    ? Math.round((opts.sheetDpi / 25.4) * 2)
    : cutMargin;

  if (opts.pageImage) {
    drawCropPreview({
      canvas: cropCanvas,
      pageImage: opts.pageImage,
      rim: field.raw.rim,
      cutMargin,
      sheetWidth: opts.sheetWidth,
      sheetHeight: opts.sheetHeight,
      extraPadding,
    })
      .then((rect) => {
        crop = rect;
        // rim の境界は切り出し矩形に対する百分率で置く。表示サイズが変わっても
        // 追従するので、ここで一度置けばよい。
        if (rect.width > 0 && rect.height > 0) {
          const [rx, ry, rw, rh] = field.raw.rim;
          rimGuide.style.left = `${((rx - rect.x) / rect.width) * 100}%`;
          rimGuide.style.top = `${((ry - rect.y) / rect.height) * 100}%`;
          rimGuide.style.width = `${(rw / rect.width) * 100}%`;
          rimGuide.style.height = `${(rh / rect.height) * 100}%`;
          rimGuide.style.display = "block";
        }
        // 切り出しが確定してはじめて正しいスケールが出せる。ここで初回描画を試みる
        // (非表示中なら updatePreview は何もせず、後で ResizeObserver が呼び直す)
        window.requestAnimationFrame(updatePreview);
      })
      .catch(() => {
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

    // 問題ページは解答用紙とさらに別の解像度でありうるが、換算は画像ごとの
    // naturalWidth/Height を見るので個別に正しく効く
    drawCropPreview({
      canvas: questionCanvas,
      pageImage: opts.questionPageImage,
      rim: field.raw.rim,
      cutMargin,
      sheetWidth: opts.questionSheetWidth,
      sheetHeight: opts.questionSheetHeight,
      // 余白は解答用紙の座標系で出した値。問題ページの座標系が別だと厳密には
      // 実寸が変わるが、これは「目安」表示なので揃えるだけで足りる
      extraPadding,
    }).catch(() => {
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

  /**
   * canvas に効いている max-height を px で読む。高さの上限の唯一の出所は
   * styles.ts 側の `max-height` 宣言で、メディアクエリ・vh・min() の解決は
   * ブラウザに任せて使用値を受け取る(ここにブレークポイントを複製しない)。
   * 絶対長に解決されない場合(none / % など)は「上限なし」として扱う。
   */
  function cropMaxHeight(): number {
    const raw = getComputedStyle(cropCanvas).maxHeight;
    if (!raw || raw === "none") return Infinity;
    const px = parseFloat(raw);
    return raw.endsWith("px") && Number.isFinite(px) && px > 0 ? px : Infinity;
  }

  function updatePreview(): void {
    // 切り出しが終わるまでは正しいスケールを出せない(canvas の width 属性は
    // 既定の 300 が入っているだけなので、それを基準にしてはいけない)。
    const rect = crop;
    if (!opts.pageImage || !rect || rect.width <= 0 || rect.height <= 0) return;
    // 非表示の間は表示サイズが0になり、正しいスケールを出せない。
    // 再表示されたら下の ResizeObserver が呼び直す。
    const avail = previewSlot.getBoundingClientRect().width;
    if (avail <= 0) return;
    // 解答欄の大きさは設問ごとに桁違い(実機では 78x130 と 665x76 が同居する)。
    // canvas の内部解像度のまま置くと表示が実質1:1になり、小さい解答欄は極端に
    // 小さく出る。そこで使える幅いっぱいに広げ、縦長のものは高さで頭打ちにする。
    //
    // **幅だけ指定して height:auto に任せてはいけない。** CSS が intrinsic ratio を
    // 保つのは width と height が両方 auto のときだけ(CSS 2.1 §10.4 の制約表)で、
    // 幅を明示した状態で max-height が当たると高さだけが潰れ、横に引き伸ばされた絵に
    // なる。実機(幅393px)で縦長の解答欄が 382x96 に伸び、丸囲みの ⓐⓑⓒ が楕円に、
    // 罫線が太い帯になっていた原因がこれ(v0.8.0)。幅と高さの両方をここで決める。
    //
    // 枠(.es-preview-wrap)の左右ボーダーぶんを引く。引かないと canvas の
    // max-width:100% に当たって、枠がスロットより2px狭くなる
    const wrapBorder = previewWrap.offsetWidth - previewWrap.clientWidth;
    const availW = Math.max(1, avail - wrapBorder);
    // 縦横比の真値は canvas の内部解像度(= 切り出したページ画像のピクセル数)。
    // rect は base_sheet 座標なので、解像度が非等方なときズレる
    const ratio = cropCanvas.width / cropCanvas.height;
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    const maxH = cropMaxHeight();
    let dispW = availW;
    let dispH = dispW / ratio;
    if (dispH > maxH) {
      // 縦長の解答欄。高さで頭打ちにして、幅は縦横比に合わせて縮める
      // (.es-preview-wrap は width:fit-content + margin:0 auto なので枠ごと中央に寄る)
      dispH = maxH;
      dispW = maxH * ratio;
    }
    const wPx = `${Math.max(1, dispW)}px`;
    const hPx = `${Math.max(1, dispH)}px`;
    // 同じ値の再代入でもレイアウトを触らない(ResizeObserver を無駄に起こさない)
    if (cropCanvas.style.width !== wPx || cropCanvas.style.height !== hPx) {
      cropCanvas.style.width = wPx;
      cropCanvas.style.height = hPx;
    }
    // 以降は「実際に画面に出ている箱」を基準にする。想定外の CSS が当たっても
    // オーバーレイと rim ガイドが表示と食い違わない
    const box = cropCanvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    // 「base_sheet(rim)座標 → CSSピクセル」の倍率。cropCanvas の内部解像度は
    // ページ画像のピクセル数なので、そこからスケールを出してはいけない。
    const scaleX = box.width / rect.width;
    const scaleY = box.height / rect.height;
    const key = [
      field.text,
      field.direction,
      field.fontSize,
      field.lineHeight,
      field.color,
      scaleX,
      scaleY,
    ].join(" ");
    if (key === lastRendered) return;

    // 配置と PNG は解答用紙ビューアと共通(render/answerLayout.ts)。ここでは切り出し原点を引き、表示倍率を掛けるだけ
    const layout = layoutAnswerText(field, cutMargin);
    if (!layout) {
      overlayImg.style.display = "none";
      lastRendered = null;
      return;
    }
    overlayImg.src = `data:image/png;base64,${layout.png}`;
    overlayImg.style.left = `${(layout.x - rect.x) * scaleX}px`;
    overlayImg.style.top = `${(layout.y - rect.y) * scaleY}px`;
    overlayImg.style.width = `${layout.width * scaleX}px`;
    overlayImg.style.height = `${layout.height * scaleY}px`;
    overlayImg.style.display = "block";
    lastRendered = key;
  }

  // --- 選択式: テキスト入力の代わりに選択肢を並べる(公式の生徒画面と同じ、無回答を含む一覧) ---
  // 選ぶと text に選択肢の文字が入る。書字方向・文字サイズは公式どおり(選択時は 32pt・行送り 0)
  if (field.isEditableChoice) {
    const choiceTools = document.createElement("div");
    choiceTools.className = "es-editor-tools";
    const choiceName = document.createElement("span");
    choiceName.className = "es-field-name";
    choiceName.textContent = fieldLabel(field);
    choiceTools.appendChild(choiceName);
    el.appendChild(choiceTools);

    const list = document.createElement("div");
    list.className = "es-choice-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "選択肢");
    el.appendChild(list);

    // 無回答("")を先頭に、選択肢を続けた順で巡回する(公式の ←→ と同じ並び)
    const states: string[] = ["", ...field.choices];
    const buttons = new Map<string, HTMLButtonElement>();
    for (const value of states) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "es-choice-btn";
      btn.textContent = value === "" ? "無回答" : value;
      btn.addEventListener("click", () => pickChoice(value));
      list.appendChild(btn);
      buttons.set(value, btn);
    }

    const refreshChoice = (): void => {
      for (const [value, btn] of buttons) {
        const active = value === field.text;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      }
    };

    const pickChoice = (value: string): void => {
      if (value === field.text) return; // 同じものを押し直しただけなら変更ではない
      field.text = value;
      field.choiceEdited = true; // 選び直したので、保存時は中央へ置き直す
      if (value !== "") {
        field.fontSize = 32;
        field.lineHeight = 0;
      }
      refreshChoice();
      updatePreview();
      opts.onChange(field);
    };

    // ←→ で前後の選択肢へ(公式と同じ。無回答を挟んで端で巡回する)
    list.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      // Alt・Ctrl・Cmd・Shift との組み合わせはブラウザの操作(戻る・単語移動など)に任せる
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      const current = states.indexOf(field.text);
      const from = current < 0 ? 0 : current;
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = (from + step + states.length) % states.length;
      pickChoice(states[next]);
      buttons.get(states[next])?.focus();
    });

    refreshChoice();
    window.setTimeout(updatePreview, 50);
    const choiceObserver = new ResizeObserver(() => updatePreview());
    choiceObserver.observe(previewSlot);

    const choiceHints = document.createElement("div");
    choiceHints.className = "es-key-hints";
    choiceHints.innerHTML =
      "<span><kbd>←</kbd><kbd>→</kbd>選択肢を移動</span>" +
      "<span><kbd>Ctrl</kbd>+<kbd>↵</kbd>次の設問</span>" +
      "<span><kbd>Alt</kbd>+<kbd>↵</kbd>次の未入力</span>" +
      "<span><kbd>Alt</kbd>+<kbd>↑↓</kbd>ページ送り</span>" +
      "<span><kbd>Ctrl</kbd>+<kbd>S</kbd>下書き保存</span>" +
      "<span><kbd>Esc</kbd>閉じる</span>";
    el.appendChild(choiceHints);

    return {
      element: el,
      getField: () => field,
      focus: () => (buttons.get(field.text) ?? buttons.get(""))?.focus(),
      destroy: () => choiceObserver.disconnect(),
    };
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
    "<span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↵</kbd>前の設問</span>" +
    "<span><kbd>Alt</kbd>+<kbd>↵</kbd>次の未入力</span>" +
    "<span><kbd>Alt</kbd>+<kbd>↑↓</kbd>ページ送り</span>" +
    "<span><kbd>Ctrl</kbd>+<kbd>S</kbd>下書き保存</span>" +
    "<span><kbd>Esc</kbd>閉じる</span>";
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

  // 今の向きを押し直しただけなら変更ではない(未保存の表示や離脱の確認を誤って出さないため)
  horizBtn.addEventListener("click", () => {
    if (field.direction === Direction.Horizon) return;
    field.direction = Direction.Horizon;
    onEdited();
  });
  vertBtn.addEventListener("click", () => {
    if (field.direction === Direction.Vertical) return;
    field.direction = Direction.Vertical;
    onEdited();
  });
  textarea.addEventListener("input", () => {
    field.text = textarea.value;
    onEdited();
  });

  // 初期プレビューは上の drawCropPreview().then() が描く。ここは、そちらより先に
  // レイアウトが落ち着いた場合の保険(切り出し未完了なら updatePreview は何もしない)。
  window.setTimeout(updatePreview, 50);

  // 2カラム化・編集モードへの切替・ウィンドウリサイズ・画面回転で表示幅が変わると
  // オーバーレイ画像の位置がずれるため、幅の変化を見て描き直す。
  // 観測するのは canvas ではなくスロット(上のコメント参照。canvas を観測すると
  // updatePreview が canvas を広げるので無限ループになる)。
  // スマホは入力ペインが display:none で始まるため、初回描画もこの経路に頼っている。
  const resizeObserver = new ResizeObserver(() => updatePreview());
  resizeObserver.observe(previewSlot);

  return {
    element: el,
    getField: () => field,
    focus: () => textarea.focus(),
    destroy: () => resizeObserver.disconnect(),
  };
}
