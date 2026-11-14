// Android アプリ版エントリ。アプリ(GeckoView)が Smarky のページへ差し込む。
// 起動ボタンを常駐させ、生徒としてログイン済みなら1回だけ自動で開く。
// ここから呼ぶ API は /api/current_user(ログイン済みかの確認)だけ。
import { createOverlay, type EasySmarkyController } from "./ui/overlay";
import { addLauncher } from "./ui/launcher";
import { fetchCurrentUser } from "./api/endpoints";

declare global {
  interface Window {
    __easysmarky?: EasySmarkyController;
    __easysmarkyApp?: boolean;
  }
}

/** 生徒の画面(ログイン画面と、Googleログインの戻り先を除く) */
const STUDENT_ROUTE = /\/student_site\/(?!sign_in|authorized_callback)/;
/** 画面の移動を見張る間隔。Smarky は pushState で移動するので hashchange だけでは拾えない */
const WATCH_INTERVAL_MS = 1000;
/** 同じ画面でログイン確認をやり直す回数(ログイン直後はトークンの交換が終わっていないことがある) */
const MAX_ATTEMPTS_PER_ROUTE = 5;

function launch(): void {
  window.__easysmarky = createOverlay();
  window.__easysmarky.start();
}

function startAutoOpen(): void {
  let lastHash: string | null = null;
  let attempts = 0;
  let checking = false;
  let timer: number | null = null;

  function stop(): void {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  }

  async function tick(): Promise<void> {
    // 利用者が自分で開いたあと(閉じたあとも含む)は、もう自動では開かない
    if (window.__easysmarky) {
      stop();
      return;
    }
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      attempts = 0;
    }
    if (checking || attempts >= MAX_ATTEMPTS_PER_ROUTE) return;
    if (!STUDENT_ROUTE.test(location.hash)) return;

    checking = true;
    attempts++;
    try {
      await fetchCurrentUser();
    } catch {
      return; // 未ログイン・通信断。次の見張りでやり直す
    } finally {
      checking = false;
    }
    if (window.__easysmarky) return;
    stop();
    launch();
  }

  timer = window.setInterval(() => void tick(), WATCH_INTERVAL_MS);
  void tick();
}

// 同じページへ二重に差し込まれても、ボタンと見張りを増やさない
if (!window.__easysmarkyApp) {
  window.__easysmarkyApp = true;
  addLauncher(() => {
    if (!window.__easysmarky) {
      launch();
      return;
    }
    window.__easysmarky.toggle();
  });
  startAutoOpen();
}
