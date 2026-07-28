const TOAST_ID = "easysmarky-update-toast";
const USERSCRIPT_URL = "https://yamapez.github.io/easysmarky/easysmarky.user.js";

/**
 * 更新トーストを表示する。
 * 「更新する」はTampermonkeyの標準インストール/更新ダイアログを出すため .user.js のURLを新規タブで開く。
 * 「あとで」だけが onDismiss を呼ぶ(=このバージョンを再通知しない)。
 * 「更新する」を押した時点ではdismissしない — 実際に更新が完了したかはこちら側から確認できず、
 * 古いスクリプトが動き続けている限り __EASYSMARKY_VERSION__ が更新されないため、
 * 次回チェック時にまだ古ければ再度通知されるのが正しい挙動。
 */
export function showUpdateToast(latestVersion: string, onDismiss: () => void): void {
  if (document.getElementById(TOAST_ID)) return;

  const box = document.createElement("div");
  box.id = TOAST_ID;
  box.style.cssText = [
    "position: fixed",
    "right: 12px",
    "bottom: 64px",
    "z-index: 2147482500", // 常駐ボタン(2147482000)より上、オーバーレイ(2147483000)より下
    "max-width: 260px",
    "padding: 12px 14px",
    "border-radius: 10px",
    "background: #1d2b33",
    "color: #fff",
    "font-size: 13px",
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif',
    "box-shadow: 0 2px 10px rgba(0,0,0,0.3)",
  ].join(";");

  const message = document.createElement("div");
  message.style.marginBottom = "10px";
  message.textContent = `easysmarky の新しいバージョン(${latestVersion})があります。`;
  box.appendChild(message);

  const row = document.createElement("div");
  row.style.cssText = "display:flex; gap:8px; justify-content:flex-end;";

  const laterBtn = document.createElement("button");
  laterBtn.type = "button";
  laterBtn.textContent = "あとで";
  laterBtn.style.cssText =
    "border:none;background:transparent;color:#cfd8dc;font-size:13px;padding:6px 8px;cursor:pointer;";
  laterBtn.addEventListener("click", () => {
    onDismiss();
    box.remove();
  });

  const updateLink = document.createElement("a");
  updateLink.textContent = "更新する";
  updateLink.href = USERSCRIPT_URL;
  updateLink.target = "_blank";
  updateLink.rel = "noopener";
  updateLink.style.cssText =
    "border:none;background:#2196c9;color:#fff;font-size:13px;padding:6px 10px;border-radius:6px;text-decoration:none;cursor:pointer;";
  updateLink.addEventListener("click", () => box.remove());

  row.appendChild(laterBtn);
  row.appendChild(updateLink);
  box.appendChild(row);

  document.body.appendChild(box);
}
