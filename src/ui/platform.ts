/**
 * Mac かどうか。キーヒントの表記(⌘ か Ctrl)と、「Cmd」相当の修飾キーの割り当てに使う。
 * iPad のキーボードも Mac 扱い(⌘ を使う)
 */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

/** キーヒントに出す「Cmd」の表記 */
export const CMD_LABEL = IS_MAC ? "⌘" : "Ctrl";

/**
 * 「Cmd」相当の修飾キーが押されているか。
 * Mac は ⌘(metaKey)だけを見る。Ctrl を見ると Ctrl+D(一字削除)などの OS・文字入力の標準動作を奪ってしまうため。
 * それ以外は Ctrl を見る(Windows の Windows キーは対象外)
 */
export function isCmdKey(event: KeyboardEvent): boolean {
  return IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}
