// 設定ダイアログ(端末共通の設定)。ヘッダの「設定」から開く。shadow DOM の中に置き、オーバーレイの外へは出さない。
// 変更は押した時点で updatePrefs に保存する(「保存」ボタンは置かない)。
import { loadPrefs, updatePrefs } from "../storage/prefs";

export interface SettingsDialog {
  /** 開く。すでに開いていれば何もしない */
  open(): void;
  /** 閉じる。開いていなければ何もしない */
  close(): void;
  isOpen(): boolean;
}

/**
 * 設定ダイアログを作る。shadow は overlay の ShadowRoot。
 * 中身は初回に開いたときに作り、チェックの初期値は開くたびに prefs から読み直す。
 */
export function createSettingsDialog(shadow: ShadowRoot): SettingsDialog {
  let el: HTMLElement | null = null;
  let checkbox: HTMLInputElement | null = null;

  function build(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "es-settings";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "設定");

    const box = document.createElement("div");
    box.className = "es-settings-box";

    const title = document.createElement("div");
    title.className = "es-settings-title";
    title.textContent = "設定";

    const row = document.createElement("label");
    row.className = "es-settings-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    const error = document.createElement("p");
    error.className = "es-settings-error";
    error.style.cssText = "margin:8px 0 0;font-size:13px;color:#a02622;";
    error.setAttribute("role", "alert");
    input.addEventListener("change", () => {
      const ok = updatePrefs({ allowBinaryLoss: input.checked });
      if (ok) {
        error.textContent = "";
        return;
      }
      // 書けなかった設定は効かない。表示を元に戻し、理由を出す(オンと見せたまま保存できない状態にしない)
      input.checked = !input.checked;
      error.textContent = "この端末に設定を保存できなかったため、変更されませんでした。";
    });
    checkbox = input;
    const label = document.createElement("span");
    label.textContent = "手書き・画像のある回でも保存できるようにする";
    row.append(input, label);

    const note = document.createElement("p");
    note.className = "es-settings-note";
    note.textContent =
      "オンにすると、手書き・画像の解答がある回でも下書き保存できます。保存すると、その回の手書き・画像の解答が消えるおそれがあります(元に戻せません)。送るのは開いている1回だけで、保存の直前に手書きが増えていた場合は送りません。この設定はこの端末に残り、共有の端末では次の人にも効きます。";

    const actions = document.createElement("div");
    actions.className = "es-settings-actions";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "閉じる";
    closeBtn.addEventListener("click", () => close());
    actions.appendChild(closeBtn);

    // 白い箱の外(背景)を押したときも閉じる。箱の中の操作は閉じない
    wrap.addEventListener("click", (event) => {
      if (event.target === wrap) close();
    });

    box.append(title, row, note, error, actions);
    wrap.appendChild(box);
    return wrap;
  }

  function open(): void {
    if (isOpen()) return;
    if (!el) {
      el = build();
      shadow.appendChild(el);
    }
    if (checkbox) checkbox.checked = loadPrefs().allowBinaryLoss;
    el.style.display = "flex";
    checkbox?.focus();
  }

  function close(): void {
    if (!el || !isOpen()) return;
    el.style.display = "none";
  }

  function isOpen(): boolean {
    return !!el && el.style.display === "flex";
  }

  return { open, close, isOpen };
}
