import { createOverlay, type EasySmarkyController } from "./ui/overlay";

declare global {
  interface Window {
    __easysmarky?: EasySmarkyController;
    __easysmarkyStartedAt?: number;
  }
}

// 生成直後の toggle を無視する猶予。
// ローダーの読み込み中(モバイルでは数秒かかる)にもう一度タップされると
// <script> が2本挿入され、2本目がこのファイルの toggle 分岐に入って
// 1本目が開いたばかりのオーバーレイを閉じてしまう。それを防ぐ。
//
// 新しいローダーは __easysmarkyLoading で2本目の挿入自体を防ぐため、
// このガードが効くのは「古い1行コードを登録したままのブックマーク」の場合。
// その場合の再タップ間隔は人間の待ち時間(数秒)になるので、短すぎると素通りする。
const DOUBLE_LAUNCH_GUARD_MS = 5000;

if (window.__easysmarky) {
  const startedAt = window.__easysmarkyStartedAt ?? 0;
  if (Date.now() - startedAt > DOUBLE_LAUNCH_GUARD_MS) {
    window.__easysmarky.toggle();
  }
} else {
  window.__easysmarky = createOverlay();
  window.__easysmarkyStartedAt = Date.now();
  window.__easysmarky.start();
}
