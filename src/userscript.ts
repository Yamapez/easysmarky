// ユーザースクリプト版エントリ。ページ読み込み時に起動ボタンだけを常駐させ、
// オーバーレイはボタンが押されるまで開かない(ブックマークレット版 main.ts は即起動)。
import {
  AUTOSTART_KEY,
  AUTOSTART_TTL_MS,
  createOverlay,
  type EasySmarkyController,
} from "./ui/overlay";

declare global {
  interface Window {
    __easysmarky?: EasySmarkyController;
  }
}

const LAUNCHER_ID = "easysmarky-launcher";

function launch(): void {
  window.__easysmarky = createOverlay({ canOpenInNewTab: true });
  window.__easysmarky.start();
}

/**
 * ヘッダーの「別タブで開く」から開かれたタブか。
 * sessionStorage は window.open 先へ複製されない(Chrome/Safari)ため localStorage を使い、
 * 放置されたフラグが後から誤発火しないよう発行時刻でTTLを見る。
 */
function consumeAutostartFlag(): boolean {
  try {
    const stamp = Number(localStorage.getItem(AUTOSTART_KEY) ?? 0);
    if (!stamp || Date.now() - stamp > AUTOSTART_TTL_MS) return false;
    localStorage.removeItem(AUTOSTART_KEY);
    return true;
  } catch {
    return false;
  }
}

function addLauncher(): void {
  if (document.getElementById(LAUNCHER_ID)) return;

  const button = document.createElement("button");
  button.id = LAUNCHER_ID;
  button.type = "button";
  button.textContent = "easysmarky";
  button.style.cssText = [
    "position: fixed",
    "right: 12px",
    "bottom: 12px",
    "z-index: 2147482000", // オーバーレイ(.es-root: 2147483000)より下
    "padding: 10px 14px",
    "min-height: 44px",
    "border: none",
    "border-radius: 22px",
    "background: #2196c9",
    "color: #fff",
    "font-size: 13px",
    "font-weight: bold",
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif',
    "box-shadow: 0 2px 10px rgba(0,0,0,0.3)",
    "cursor: pointer",
  ].join(";");
  button.addEventListener("click", () => {
    if (!window.__easysmarky) {
      launch();
      return;
    }
    window.__easysmarky.toggle();
  });
  document.body.appendChild(button);
}

addLauncher();

if (consumeAutostartFlag()) launch();
