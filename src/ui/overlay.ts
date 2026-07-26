import { OVERLAY_STYLES } from "./styles";
import { renderSheetPicker, type SelectedSheet } from "./sheetPicker";
import { renderFormView } from "./formView";

export interface EasySmarkyController {
  toggle: () => void;
  start: () => void;
}

export interface CreateOverlayOptions {
  /**
   * 新規タブを開いたときに、そこで easysmarky を自動起動できるか。
   * ページに常駐するユーザースクリプト版だけが true。
   * ブックマークレット版は新規タブでもう一度ブックマークレットを押す必要があり、
   * 「別タブで開く」の価値がないためボタン自体を出さない。
   */
  canOpenInNewTab?: boolean;
}

const HOST_ID = "easysmarky-host";

/** 新しく開いたタブに「起動してよい」と伝えるフラグ(値は発行時刻) */
export const AUTOSTART_KEY = "easysmarky:autostart";
/** フラグの有効期限。放置されたフラグが後から誤発火するのを防ぐ */
export const AUTOSTART_TTL_MS = 10_000;

function showError(container: HTMLElement, err: unknown, onRetry: () => void): void {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "es-column";
  const box = document.createElement("div");
  box.className = "es-error";
  const message = err instanceof Error ? err.message : "不明なエラーが発生しました。";
  box.textContent = `エラーが発生しました: ${message}\nSmarkyにログインした状態でお試しください。`;
  wrap.appendChild(box);
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "es-list-item";
  retryBtn.textContent = "やり直す";
  retryBtn.addEventListener("click", onRetry);
  wrap.appendChild(retryBtn);
  container.appendChild(wrap);
}

export function createOverlay(options: CreateOverlayOptions = {}): EasySmarkyController {
  let host: HTMLElement | null = null;
  let shadow: ShadowRoot;
  let content: HTMLElement;
  let scrollLockBackup: { html: string; body: string } | null = null;

  function build(): void {
    // 既存ホストを拾い上げると shadow/content が未代入のまま start() に進んで例外になるため、
    // 残骸があれば捨てて必ず作り直す。
    document.getElementById(HOST_ID)?.remove();

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

    const actions = document.createElement("div");
    actions.className = "es-header-actions";

    if (options.canOpenInNewTab) {
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "es-header-btn";
      openBtn.textContent = "別タブで開く";
      openBtn.addEventListener("click", () => {
        try {
          localStorage.setItem(AUTOSTART_KEY, String(Date.now()));
        } catch {
          // localStorage が使えない場合は自動起動しないだけ(常駐ボタンから開ける)
        }
        // ポップアップブロッカーに阻まれないよう、クリックハンドラ内で同期的に呼ぶ
        window.open(location.href, "_blank");
      });
      actions.appendChild(openBtn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "es-close";
    closeBtn.textContent = "閉じる";
    closeBtn.addEventListener("click", () => setVisible(false));
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    panel.appendChild(header);

    content = document.createElement("div");
    content.className = "es-content";
    panel.appendChild(content);

    root.appendChild(panel);
    shadow.appendChild(root);
  }

  function setVisible(visible: boolean): void {
    if (!host) return;
    host.style.display = visible ? "block" : "none";
    // 全画面オーバーレイの背後でホストページがスクロールしてしまわないようロックする。
    // body だけでは実際にスクロールが止まらないため html 側も一緒に固定する。
    const html = document.documentElement;
    if (visible) {
      if (scrollLockBackup === null) {
        scrollLockBackup = { html: html.style.overflow, body: document.body.style.overflow };
      }
      html.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else if (scrollLockBackup !== null) {
      html.style.overflow = scrollLockBackup.html;
      document.body.style.overflow = scrollLockBackup.body;
      scrollLockBackup = null;
    }
  }

  function showSheetPicker(): void {
    content.innerHTML = "";
    // 一覧は全画面幅だと読みにくいので中央寄せのカラムに収める
    const column = document.createElement("div");
    column.className = "es-column";
    content.appendChild(column);
    renderSheetPicker(column, {
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
