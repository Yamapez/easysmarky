import { OVERLAY_STYLES } from "./styles";
import { renderSheetPicker, type SelectedSheet } from "./sheetPicker";
import { renderFormView } from "./formView";

export interface EasySmarkyController {
  toggle: () => void;
  start: () => void;
}

const HOST_ID = "easysmarky-host";

function showError(container: HTMLElement, err: unknown, onRetry: () => void): void {
  container.innerHTML = "";
  const box = document.createElement("div");
  box.className = "es-error";
  const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
  box.textContent = `エラーが発生しました: ${message}\nSmarkyにログインした状態でお試しください。`;
  container.appendChild(box);
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "es-list-item";
  retryBtn.textContent = "やり直す";
  retryBtn.addEventListener("click", onRetry);
  container.appendChild(retryBtn);
}

export function createOverlay(): EasySmarkyController {
  let host = document.getElementById(HOST_ID) as HTMLElement | null;
  let shadow: ShadowRoot;
  let content: HTMLElement;

  function build(): void {
    host = document.createElement("div");
    host.id = HOST_ID;
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = OVERLAY_STYLES;
    shadow.appendChild(style);

    const root = document.createElement("div");
    root.className = "es-root";

    const panel = document.createElement("div");
    panel.className = "es-panel";

    const header = document.createElement("div");
    header.className = "es-header";
    header.innerHTML = '<span class="es-title">easysmarky</span>';
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "es-close";
    closeBtn.textContent = "閉じる";
    closeBtn.addEventListener("click", () => setVisible(false));
    header.appendChild(closeBtn);
    panel.appendChild(header);

    content = document.createElement("div");
    panel.appendChild(content);

    root.appendChild(panel);
    root.addEventListener("click", (e) => {
      if (e.target === root) setVisible(false);
    });
    shadow.appendChild(root);
  }

  function setVisible(visible: boolean): void {
    if (!host) return;
    host.style.display = visible ? "block" : "none";
  }

  function showSheetPicker(): void {
    content.innerHTML = "";
    renderSheetPicker(content, {
      onSelect: (sheet: SelectedSheet) => showFormView(sheet),
    }).catch((err) => showError(content, err, showSheetPicker));
  }

  function showFormView(sheet: SelectedSheet): void {
    content.innerHTML = "";
    renderFormView(content, { sheet, onBack: showSheetPicker }).catch((err) =>
      showError(content, err, () => showFormView(sheet)),
    );
  }

  return {
    start(): void {
      if (!host) build();
      setVisible(true);
      showSheetPicker();
    },
    toggle(): void {
      if (!host) {
        build();
        setVisible(true);
        showSheetPicker();
        return;
      }
      const isVisible = host.style.display !== "none";
      setVisible(!isVisible);
    },
  };
}
