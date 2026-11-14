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
import { addLauncher } from "./ui/launcher";

declare global {
  interface Window {
    __easysmarky?: EasySmarkyController;
  }
}

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

async function runUpdateCheck(): Promise<void> {
  try {
    const latest = await checkForUpdate(__EASYSMARKY_VERSION__);
    if (latest) showUpdateToast(latest, () => dismissVersion(latest));
  } catch {
    // 通知が出ないだけで機能に影響しないため握りつぶす
  }
}

addLauncher(() => {
  if (!window.__easysmarky) {
    launch();
    return;
  }
  window.__easysmarky.toggle();
});

if (consumeAutostartFlag()) launch();

void runUpdateCheck();
