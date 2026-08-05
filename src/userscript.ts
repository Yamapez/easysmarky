// ユーザースクリプト版エントリ。ページ読み込み時に起動ボタンだけを常駐させ、
// オーバーレイはボタンが押されるまで開かない(ブックマークレット版 main.ts は即起動)。
import {
  AUTOSTART_KEY,
  AUTOSTART_TTL_MS,
  createOverlay,
  type EasySmarkyController,
} from "./ui/overlay";
import { checkForUpdate } from "./update/checkForUpdate";
import { showUpdateToast } from "./update/toast";
import { dismissVersion } from "./storage/updateState";

declare global {
  interface Window {
    __easysmarky?: EasySmarkyController;
  }
}

const LAUNCHER_ID = "easysmarky-launcher";

/**
 * URLの末尾に付いていたら起動する目印(`https://digi-repo.smarky.jp/...#easysmarky`)。
 * ホーム画面のショートカットやSafariのお気に入りに登録しておけば、
 * 「Smarkyを開く → ボタンを探してタップ」が1タップで済む。
 * ハッシュにしたのはサーバへ送られずSmarky側の画面遷移に影響しないため。
 */
const AUTOSTART_HASH = "easysmarky";

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

function hasAutostartHash(): boolean {
  return location.hash.replace(/^#/, "").toLowerCase() === AUTOSTART_HASH;
}

/**
 * 目印を消してから起動する。残したままだと、閉じたあとに再読み込み(引っ張って更新など)
 * しただけで勝手に開き直してしまう。ショートカット側のURLには目印が残るので、
 * 次にアイコンから開いたときはまた自動で起動する。
 */
function consumeAutostartHash(): boolean {
  if (!hasAutostartHash()) return false;
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    // replaceState が使えなくても起動自体はできるので握りつぶす
  }
  return true;
}

/**
 * 同じページを開いたままアドレスバーで `#easysmarky` を付けた場合は再読み込みが起きず
 * hashchange だけが飛ぶ。ブックマークからの起動をこの経路に頼るブラウザがあるため拾う。
 */
function watchAutostartHash(): void {
  window.addEventListener("hashchange", () => {
    if (!consumeAutostartHash()) return;
    if (!window.__easysmarky) {
      launch();
      return;
    }
    window.__easysmarky.toggle();
  });
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

async function runUpdateCheck(): Promise<void> {
  try {
    const latest = await checkForUpdate(__EASYSMARKY_VERSION__);
    if (latest) showUpdateToast(latest, () => dismissVersion(latest));
  } catch {
    // 通知が出ないだけで機能に影響しないため握りつぶす
  }
}

addLauncher();
watchAutostartHash();

if (consumeAutostartHash() || consumeAutostartFlag()) launch();

void runUpdateCheck();
