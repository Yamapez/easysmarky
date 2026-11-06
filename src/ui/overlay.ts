import { OVERLAY_STYLES } from "./styles";
import { renderSheetPicker, type SelectedSheet } from "./sheetPicker";
import { renderFormView } from "./formView";
import { describeApiError } from "../api/client";

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

/**
 * ヘッダは画面ごとに中身が変わる(一覧では easysmarky、フォームでは科目名・進捗)ため、
 * 各ビューから差し替えられるようにスロットとして渡す。
 */
export interface HeaderHandle {
  /** 左端の戻るボタン。null で消す */
  setBack: (handler: (() => void) | null, label?: string) => void;
  setTitle: (main: string, sub?: string) => void;
  /** 「閉じる」の左に置く任意のDOM(進捗バーなど)。null で消す */
  setStatus: (el: HTMLElement | null) => void;
  /**
   * 画面を離れる前(閉じる・戻る・Esc・再押下)に呼ばれる。false を返すと離れない。
   * 未保存の入力がある画面が、確認なしで捨てられないようにするため。null で解除。
   */
  setLeaveGuard: (guard: (() => boolean) | null) => void;
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
  box.textContent = `読み込めませんでした。\n${describeApiError(err).message}`;
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
  let header: HeaderHandle;
  let scrollLockBackup: { html: string; body: string } | null = null;
  let leaveGuard: (() => boolean) | null = null;

  /** 画面を離れてよいか。未保存の確認で「やめる」が選ばれたら false */
  function canLeave(): boolean {
    return leaveGuard ? leaveGuard() : true;
  }

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
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "es-panel";

    const headerEl = document.createElement("div");
    headerEl.className = "es-header";

    const headerMain = document.createElement("div");
    headerMain.className = "es-header-main";
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "es-header-back";
    backBtn.style.display = "none";
    const titleEl = document.createElement("span");
    titleEl.className = "es-title";
    titleEl.textContent = "easysmarky";
    const subEl = document.createElement("span");
    subEl.className = "es-header-sub";
    headerMain.appendChild(backBtn);
    headerMain.appendChild(titleEl);
    headerMain.appendChild(subEl);
    headerEl.appendChild(headerMain);

    const headerRight = document.createElement("div");
    headerRight.className = "es-header-right";
    const statusSlot = document.createElement("div");
    statusSlot.className = "es-header-status";
    headerRight.appendChild(statusSlot);

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
    closeBtn.addEventListener("click", () => {
      if (canLeave()) setVisible(false);
    });
    actions.appendChild(closeBtn);

    headerRight.appendChild(actions);
    headerEl.appendChild(headerRight);
    panel.appendChild(headerEl);

    let backHandler: (() => void) | null = null;
    backBtn.addEventListener("click", () => {
      if (canLeave()) backHandler?.();
    });
    header = {
      setLeaveGuard(guard) {
        leaveGuard = guard;
      },
      setBack(handler, label = "← 科目一覧") {
        backHandler = handler;
        backBtn.textContent = label;
        backBtn.style.display = handler ? "inline-block" : "none";
      },
      setTitle(main, sub = "") {
        titleEl.textContent = main;
        subEl.textContent = sub;
      },
      setStatus(el) {
        statusSlot.innerHTML = "";
        if (el) statusSlot.appendChild(el);
      },
    };

    content = document.createElement("div");
    content.className = "es-content";
    panel.appendChild(content);

    root.appendChild(panel);
    shadow.appendChild(root);

    // Esc で閉じる。1回目は入力欄からフォーカスを外すだけにして誤爆(入力中に閉じてしまう)を防ぐ
    window.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        if (!host || host.style.display === "none") return;
        // 読むモードが開いている間は、Esc をそちら(formView の読むモード)に任せる
        if (shadow.querySelector(".es-reader")) return;
        // IME確定のキャンセルでも Escape が飛んでくるブラウザがあるため無視する
        if (event.isComposing || event.keyCode === 229) return;
        const active = shadow.activeElement;
        if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
          active.blur();
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (canLeave()) setVisible(false);
      },
      true,
    );
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

  function resetHeader(): void {
    header.setBack(null);
    header.setTitle("easysmarky");
    header.setStatus(null);
    header.setLeaveGuard(null);
  }

  function showSheetPicker(): void {
    content.innerHTML = "";
    resetHeader();
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
    resetHeader();
    renderFormView(content, { sheet, header, onBack: showSheetPicker }).catch((err) => {
      resetHeader();
      showError(content, err, () => showFormView(sheet));
    });
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
      // 表示中にもう一度押されたら閉じる扱いになるので、未保存の確認を通す
      if (isVisible && !canLeave()) return;
      setVisible(!isVisible);
    },
  };
}
