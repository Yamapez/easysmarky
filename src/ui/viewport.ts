// ソフトキーボード表示時のレイアウト追従(visualViewport)。
// 方向3(スマホの入力体験)で中身を入れる。Phase 0 では継ぎ目だけを置き、挙動は変えない。
// overlay.ts が表示・非表示に合わせて start()/stop() を呼ぶ。
export interface ViewportSync {
  start(): void;
  stop(): void;
}

export function installViewportSync(_root: HTMLElement): ViewportSync {
  return {
    start() {},
    stop() {},
  };
}
