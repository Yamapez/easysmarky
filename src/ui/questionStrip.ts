export interface StripItem {
  id: number;
  page: number;
  label: string;
  /** easysmarkyでは編集できない設問。選べるが入力欄は出ない */
  locked: boolean;
}

export interface QuestionStripOptions {
  items: StripItem[];
  isFilled: (fieldId: number) => boolean;
  onSelect: (fieldId: number) => void;
}

export interface QuestionStripHandle {
  element: HTMLElement;
  /** 選択中の設問を変える。チップが見えるところまで横スクロールする */
  setActive: (fieldId: number | null) => void;
  /** 入力状況が変わったときにドットを塗り直す */
  refresh: () => void;
}

/**
 * 画面下部の設問ストリップ。ページ区切り付きで全設問を並べ、目次と進捗を兼ねる。
 */
export function createQuestionStrip(opts: QuestionStripOptions): QuestionStripHandle {
  const el = document.createElement("div");
  el.className = "es-strip";

  const chips = new Map<number, HTMLButtonElement>();
  let activeId: number | null = null;

  let lastPage: number | null = null;
  for (const item of opts.items) {
    if (item.page !== lastPage) {
      const pageLabel = document.createElement("span");
      pageLabel.className = "es-strip-page";
      pageLabel.textContent = `${item.page}ページ`;
      el.appendChild(pageLabel);
      lastPage = item.page;
    }

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "es-strip-chip";
    chip.dataset.fieldId = String(item.id);
    const dot = document.createElement("span");
    dot.className = "es-strip-dot";
    chip.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = item.locked ? `${item.label} 編集不可` : item.label;
    chip.appendChild(label);
    chip.addEventListener("click", () => opts.onSelect(item.id));
    el.appendChild(chip);
    chips.set(item.id, chip);
  }

  function refresh(): void {
    for (const item of opts.items) {
      const chip = chips.get(item.id);
      if (!chip) continue;
      const dot = chip.querySelector(".es-strip-dot")!;
      const filled = opts.isFilled(item.id);
      chip.classList.toggle("locked", item.locked);
      chip.classList.toggle("active", item.id === activeId);
      dot.classList.toggle("locked", item.locked);
      dot.classList.toggle("filled", filled && !item.locked);
    }
  }

  // 左右キーで隣のチップへフォーカスを移す(Tab で全チップを巡るのは遅いため)。
  // 選択(設問を開く)は Enter / Space に任せる。矢印で即座に開くと入力欄へ飛んでしまう。
  el.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains("es-strip-chip")) return;
    const ordered = [...chips.values()];
    const index = ordered.indexOf(target);
    if (index < 0) return;
    const next = ordered[index + (event.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest", inline: "center" });
  });

  refresh();

  return {
    element: el,
    setActive(fieldId) {
      activeId = fieldId;
      refresh();
      if (fieldId != null) {
        chips.get(fieldId)?.scrollIntoView({ block: "nearest", inline: "center" });
      }
    },
    refresh,
  };
}
