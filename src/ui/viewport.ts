// ソフトキーボード表示時のレイアウト追従(visualViewport)。
// 見える領域の高さ・上端を .es-root の --es-vvh / --es-vv-top に入れ、キーボードが出ているときは es-kbd を付ける。
// visualViewport が無い環境では何もしない(styles.ts の 100dvh のまま)。
// overlay.ts が表示・非表示に合わせて start()/stop() を呼ぶ。
const KEYBOARD_THRESHOLD_PX = 150;

export interface ViewportSync {
  start(): void;
  stop(): void;
}

export function installViewportSync(root: HTMLElement): ViewportSync {
  /** start() で掴んだ visualViewport。stop() で同じ参照から外す(差し替えられた後も対になるように) */
  let vv: VisualViewport | null = null;

  function apply(): void {
    if (!vv) return;
    root.style.setProperty("--es-vvh", `${vv.height}px`);
    root.style.setProperty("--es-vv-top", `${vv.offsetTop}px`);
    // キーボードが出ると見える領域だけが縮む。innerHeight との差で判定する(閾値は上部バーの伸び縮みを避けるため)
    const hidden = window.innerHeight - vv.height;
    root.classList.toggle("es-kbd", hidden > KEYBOARD_THRESHOLD_PX);
  }

  return {
    start() {
      if (vv) return;
      const view = window.visualViewport;
      if (!view) return;
      vv = view;
      vv.addEventListener("resize", apply);
      vv.addEventListener("scroll", apply);
      apply();
    },
    stop() {
      if (!vv) return;
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      vv = null;
      root.style.removeProperty("--es-vvh");
      root.style.removeProperty("--es-vv-top");
      root.classList.remove("es-kbd");
    },
  };
}
