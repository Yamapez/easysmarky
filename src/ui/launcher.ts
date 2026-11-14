// ページに常駐する起動ボタン。ユーザースクリプト版と Android アプリ版が共有する
// (ブックマークレット版は読み込みと同時に開くので使わない)。

const LAUNCHER_ID = "easysmarky-launcher";

export function addLauncher(onClick: () => void): void {
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
  button.addEventListener("click", onClick);
  document.body.appendChild(button);
}
