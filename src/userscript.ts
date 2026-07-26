// ユーザースクリプト版エントリ。ページ読み込み時に起動ボタンだけを常駐させ、
// オーバーレイはボタンが押されるまで開かない(ブックマークレット版 main.ts は即起動)。
import { createOverlay, type EasySmarkyController } from "./ui/overlay";

declare global {
  interface Window {
    __easysmarky?: EasySmarkyController;
  }
}

const LAUNCHER_ID = "easysmarky-launcher";

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
      window.__easysmarky = createOverlay();
      window.__easysmarky.start();
      return;
    }
    window.__easysmarky.toggle();
  });
  document.body.appendChild(button);
}

addLauncher();
