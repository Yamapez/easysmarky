export const OVERLAY_STYLES = `
:host, * { box-sizing: border-box; }
.es-root {
  position: fixed;
  inset: 0;
  height: 100vh;   /* dvh 未対応ブラウザ向けのフォールバック */
  height: 100dvh;  /* iOS Safari のツールバー分を除いた実際の表示高さ */
  z-index: 2147483000;
  background: #fff;
  color: #1d2b33;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;
  overflow: hidden; /* スクロールは内側のペインが持つ */
}
.es-panel {
  background: #fff;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
}
/* flex の子をスクロールさせるには min-height:0 が必須(省くと内容がはみ出す) */
.es-content {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 一覧・エラーなど、全画面幅に広げると読みにくいものを中央カラムに収める */
.es-column {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 12px 14px 40px;
}

/* ===== ヘッダ ===== */
.es-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 2px solid #2196c9;
  background: #fff;
}
.es-header-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.es-header-back {
  border: none;
  background: transparent;
  color: #2196c9;
  font-size: 14px;
  min-height: 40px;
  padding: 0;
  font-family: inherit;
  white-space: nowrap;
}
.es-title {
  font-size: 16px;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.es-header-sub {
  font-size: 12px;
  color: #8b959b;
  white-space: nowrap;
}
.es-header-right {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.es-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.es-header-btn {
  border: 1px solid #2196c9;
  background: #fff;
  color: #2196c9;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  min-height: 40px;
  font-family: inherit;
  white-space: nowrap;
}
.es-close {
  border: none;
  background: #eee;
  color: #1d2b33;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  min-height: 40px;
  font-family: inherit;
  white-space: nowrap;
}

/* ===== 進捗表示(ヘッダ内) ===== */
.es-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}
.es-progress-count {
  font-size: 12px;
  color: #5b6770;
  white-space: nowrap;
}
.es-progress-bar {
  display: block;
  flex: 0 0 auto;
  width: 120px;
  height: 8px;
  border-radius: 4px;
  background: #e3e8eb;
  overflow: hidden;
}
.es-progress-fill {
  display: block;
  height: 100%;
  width: 0;
  background: #2196c9;
}
.es-progress-fill.done { background: #4caf50; }
.es-autosave {
  font-size: 12px;
  color: #7a848a;
  white-space: nowrap;
}

/* ===== 一覧 ===== */
.es-list-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 12px;
  font-size: 13px;
  color: #5b6770;
}
.es-list-note .es-list-note-sub {
  margin-left: auto;
  font-size: 12px;
  color: #8b959b;
}
.es-list-heading {
  font-weight: bold;
  font-size: 14px;
  margin: 14px 0 6px;
}
.es-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 12px;
  margin-bottom: 6px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
  color: #1d2b33;
  font-family: inherit;
  font-size: 14px;
  min-height: 44px;
}
.es-list-item.current {
  border-color: #2196c9;
  background: #eaf6fb;
}
.es-list-item:active { background: #eef7fb; }
.es-list-main { flex: 1 1 auto; min-width: 0; }
.es-list-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-weight: bold;
}
.es-list-item .es-sub { color: #666; font-size: 12px; margin-top: 2px; }
.es-list-progress {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #5b6770;
  white-space: nowrap;
}
.es-list-progress .es-progress-bar { width: 96px; }
.es-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  background: #2196c9;
  color: #fff;
  white-space: nowrap;
}
.es-badge.done { background: #4caf50; }
.es-badge.locked { background: #999; }
.es-badge.idle { background: #eef1f3; color: #6b757b; }

/* ===== 共通の注意書き ===== */
.es-warning {
  background: #fff3e0;
  border: 1px solid #ffb74d;
  color: #7a4a00;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 12px;
  line-height: 1.5;
}
.es-warning-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.es-warning-actions button {
  flex: 1;
  padding: 10px;
  font-size: 13px;
  border: 1px solid #7a4a00;
  border-radius: 6px;
  background: #fff;
  color: #7a4a00;
  min-height: 40px;
  font-family: inherit;
}
.es-warning-actions button.secondary { border-color: #d8c3a2; }
.es-error {
  background: #fdecea;
  border: 1px solid #f5989d;
  color: #a02622;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  margin-bottom: 12px;
  white-space: pre-wrap;
}
.es-loading {
  padding: 40px 10px;
  text-align: center;
  color: #666;
}

/* ===== フォーム全体(1設問集中レイアウト) ===== */
.es-form {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* シート全体に関わる注意書き(保存ブロック・下書き復元・保存結果)。
   スマホでは問題ページ表示中でも見えるように、ペインの外に置く */
.es-notices {
  flex: 0 0 auto;
  max-height: 40vh;
  overflow-y: auto;
  padding: 10px 14px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.es-notices:empty { display: none; }
.es-notices > * { margin-bottom: 0; }
.es-work {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.es-toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  background: rgba(40, 44, 48, .92);
  color: #fff;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 20px;
  pointer-events: none;
  z-index: 5;
  opacity: 0;
  transition: opacity .2s ease;
}
.es-toast.show {
  opacity: 1;
}
.es-pane-question {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.es-pane-form {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
}

/* ===== 設問ヘッダ(エディタペイン上部) ===== */
.es-editor-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #e5e9eb;
}
.es-editor-title {
  flex: 1 1 auto;
  min-width: 0;
  text-align: center;
}
.es-editor-name {
  font-size: 16px;
  font-weight: bold;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 左のビューアで選択中の枠・右のプレビューチップと同じ色の目印で「今どこを見ているか」を揃える */
.es-editor-name::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: #2196c9;
  margin-right: 6px;
}
.es-editor-meta {
  font-size: 12px;
  color: #8b959b;
  white-space: nowrap;
}
.es-editor-nav {
  border: 1px solid #ccc;
  background: #fff;
  color: #333;
  border-radius: 6px;
  min-width: 44px;
  min-height: 40px;
  font-size: 14px;
  font-family: inherit;
}
.es-editor-nav.primary {
  border-color: #2196c9;
  color: #2196c9;
}
.es-editor-nav:disabled { color: #bbb; background: #f5f5f5; }
.es-editor-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
}

/* ===== 1設問エディタ ===== */
.es-preview-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #7a848a;
}
.es-preview-head .es-preview-note {
  margin-left: auto;
  font-size: 11px;
  color: #98a3aa;
}
/* 左のビューアで選択中の枠(.es-rim.active)と同じ見た目にして、対応関係を目で追えるようにする */
.es-preview-chip {
  display: inline-block;
  background: #2196c9;
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  padding: 3px 8px;
  border-radius: 4px;
  white-space: nowrap;
}
.es-preview-row {
  display: block;
}
/* 表示できる幅を測るための枠。中身(canvas)がこれを押し広げないようにしておくこと。
   広げられると fieldEditor の ResizeObserver が無限ループする */
.es-preview-slot {
  min-width: 0;
  overflow: hidden;
  margin-bottom: 12px;
}
.es-preview-wrap {
  position: relative;
  display: block;
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  border: 2px solid rgba(33, 150, 201, .55);
  background: #f5f5f5;
}
/* 幅も高さも updatePreview()(src/ui/fieldEditor.ts)が JS で決める。
   CSS に幅だけ指定して height:auto に任せると、max-height が当たったときに
   高さだけ潰れて横に伸びる(CSS の縦横比保持は width/height が両方 auto の
   ときだけ効く)。ここの max-height は「高さの上限」の唯一の出所で、
   fieldEditor が getComputedStyle().maxHeight で読む。必ず px / vh / min() など
   **絶対長に解決される値**で書くこと(% は読めず「上限なし」になる)。
   下の宣言は JS が走る前と読み取り失敗時の保険を兼ねる */
.es-preview-wrap canvas.es-crop {
  display: block;
  max-width: 100%;
  height: auto;
  max-height: 44vh; /* どのブレークポイントにも当たらない既定値(下の2つが上書きする) */
}
.es-preview-overlay {
  position: absolute;
  pointer-events: none;
  image-rendering: pixelated;
}
/* 保存される範囲(rim)の境界。余白を広げて見せるぶん、どこまでが解答欄かを示す */
.es-rim-guide {
  position: absolute;
  pointer-events: none;
  border: 1px dashed #2196c9;
  box-sizing: border-box;
}
/* 問題プレビュー(解答欄の横に置く「目安」の切り出し画像)は、狭い画面では出さない */
.es-question-preview {
  display: none;
}
.es-question-preview-head {
  font-size: 12px;
  color: #7a848a;
  margin-bottom: 6px;
}
.es-crop-question {
  display: block;
  max-width: 100%;
  height: auto;
  border: 1px solid #ccc;
  background: #f5f5f5;
}
.es-editor-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.es-field-name {
  font-size: 15px;
  font-weight: bold;
}
.es-direction-toggle {
  display: flex;
  border: 1px solid #bbb;
  border-radius: 6px;
  overflow: hidden;
}
.es-direction-toggle button {
  border: none;
  background: #fff;
  color: #555;
  font-size: 13px;
  padding: 8px 16px;
  min-height: 40px;
  font-family: inherit;
  white-space: nowrap;
}
.es-direction-toggle button + button { border-left: 1px solid #bbb; }
.es-direction-toggle button.active {
  background: #2196c9;
  color: #fff;
}
.es-fit {
  margin-left: auto;
  font-size: 13px;
  color: #2e7d32;
  white-space: nowrap;
}
.es-fit.over { color: #a0522d; }
.es-textarea {
  width: 100%;
  min-height: 150px;
  font-size: 16px; /* iOS Safariでズームさせないため16px以上 */
  padding: 10px;
  border: 1px solid #bbb;
  border-radius: 6px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.7;
  color: inherit;
}
.es-textarea:focus {
  outline: none;
  border-color: #2196c9;
  box-shadow: 0 0 0 3px rgba(33, 150, 201, .24);
}
.es-key-hints {
  display: none;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  font-size: 12px;
  color: #8b959b;
}
.es-key-hints span {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.es-key-hints kbd {
  font-family: ui-monospace, Menlo, monospace;
  border: 1px solid #d5dbdf;
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 2px 6px;
  background: #fafbfc;
}
.es-field-locked {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 12px;
}
.es-field-locked .es-field-locked-name {
  font-size: 13px;
  font-weight: bold;
  margin-bottom: 6px;
}
.es-field-locked .es-field-locked-note {
  font-size: 12px;
  color: #888;
  line-height: 1.6;
}

/* ===== 保存バー ===== */
.es-savebar {
  flex: 0 0 auto;
  background: #fff;
  border-top: 1px solid #ddd;
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.es-savebar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.es-save-btn {
  flex: 1 1 auto;
  padding: 14px;
  font-size: 16px;
  font-weight: bold;
  border: none;
  border-radius: 8px;
  background: #2196c9;
  color: #fff;
  min-height: 48px;
  font-family: inherit;
  white-space: nowrap;
}
.es-save-btn:disabled { background: #aac7d3; }
.es-next-btn {
  flex: 0 0 auto;
  padding: 14px 16px;
  font-size: 14px;
  border: 1px solid #2196c9;
  border-radius: 8px;
  background: #fff;
  color: #2196c9;
  min-height: 48px;
  font-family: inherit;
  white-space: nowrap;
}
.es-next-btn:disabled { border-color: #cfd6da; color: #b9c2c7; }
.es-save-status {
  font-size: 13px;
  text-align: center;
  color: #7a848a;
}
.es-save-actions {
  display: flex;
  gap: 8px;
}
.es-save-actions button {
  flex: 1;
  padding: 10px;
  font-size: 13px;
  border: 1px solid #a02622;
  border-radius: 6px;
  background: #fff;
  color: #a02622;
  min-height: 40px;
  font-family: inherit;
}
.es-save-actions button.secondary { border-color: #ccc; color: #333; }
.es-save-note {
  font-size: 12px;
  text-align: center;
  color: #7a848a;
}

/* ===== キーボード操作の見え方・初回ヒント ===== */
/* 入力欄(textarea)は枠の代わりに box-shadow でフォーカスを示すので、ここではボタンとチップだけ */
button:focus-visible,
.es-strip-chip:focus-visible {
  outline: 3px solid #2196c9;
  outline-offset: 2px;
}
.es-hint {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid #b8dcef;
  border-radius: 8px;
  background: #eaf6fb;
  color: #1e4f66;
  font-size: 13px;
  line-height: 1.6;
}
.es-hint > div {
  flex: 1 1 auto;
}
.es-hint button {
  flex: 0 0 auto;
  padding: 6px 12px;
  font-size: 13px;
  border: 1px solid #2196c9;
  border-radius: 6px;
  background: #fff;
  color: #2196c9;
  min-height: 32px;
  font-family: inherit;
}

/* ===== 設問ストリップ ===== */
.es-strip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #ddd;
  background: #fafbfc;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.es-strip-page {
  flex: 0 0 auto;
  font-size: 12px;
  color: #7a848a;
  white-space: nowrap;
  margin: 0 4px;
}
.es-strip-chip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #e0e4e7;
  background: #fff;
  color: inherit;
  border-radius: 20px;
  padding: 8px 14px;
  font-size: 13px;
  min-height: 40px;
  font-family: inherit;
  white-space: nowrap;
}
.es-strip-chip.active {
  border-color: #2196c9;
  background: #eaf6fb;
  font-weight: bold;
}
.es-strip-chip.locked {
  background: #f2f4f5;
  color: #8b959b;
}
.es-strip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  border: 1.5px solid #b9c2c7;
}
.es-strip-dot.filled { background: #4caf50; border-color: #4caf50; }
.es-strip-dot.locked { border-radius: 2px; background: #b9c2c7; border-color: #b9c2c7; }

/* ===== 問題ページビューア ===== */
.es-viewer {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #eceff1;
}
.es-viewer-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 8px;
  background: #fff;
  border-bottom: 1px solid #ddd;
}
.es-viewer-bar button {
  border: 1px solid #ccc;
  background: #fff;
  color: #333;
  border-radius: 6px;
  min-width: 40px;
  min-height: 36px;
  padding: 0 10px;
  font-size: 14px;
  font-family: inherit;
}
.es-viewer-bar button:disabled {
  color: #bbb;
  background: #f5f5f5;
}
.es-viewer-tabs {
  display: flex;
  gap: 4px;
  margin-right: auto;
}
.es-viewer-tabs button.active {
  background: #2196c9;
  border-color: #2196c9;
  color: #fff;
  font-weight: bold;
}
.es-viewer-pager,
.es-viewer-zoom {
  display: flex;
  align-items: center;
  gap: 4px;
}
.es-viewer-count {
  font-size: 13px;
  color: #555;
  min-width: 46px;
  text-align: center;
}
.es-viewer-body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.es-viewer-scroll {
  width: 100%;
  height: 100%;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
/* 画像と枠を同じ箱に収める。幅を変えるとスクロール領域も広がる(transform: scale()
   だとレイアウトが変わらず、拡大時に画像の端へスクロールできない) */
.es-viewer-canvas {
  position: relative;
  width: 100%;
}
.es-viewer-img {
  display: block;
  width: 100%;
  max-width: none;
  height: auto;
}
.es-viewer-rims {
  position: absolute;
  inset: 0;
}
.es-rim {
  position: absolute;
  border: 2px dashed #9aa6ad;
  border-radius: 3px;
  background: rgba(255, 255, 255, .4);
  padding: 0;
  font-family: inherit;
  cursor: pointer;
}
.es-rim.filled {
  border-style: solid;
  border-color: #4caf50;
  background: rgba(76, 175, 80, .10);
}
.es-rim.active {
  border-width: 3px;
  border-style: solid;
  border-color: #2196c9;
  background: rgba(33, 150, 201, .16);
  box-shadow: 0 0 0 4px rgba(33, 150, 201, .28);
  animation: es-rim-flash .6s ease-out;
}
.es-rim.locked {
  border-style: solid;
  border-color: #b9c2c7;
  background: rgba(185, 194, 199, .12);
  cursor: default;
}
/* 今どの枠を見ればいいか一目でわかるよう、選択中以外を沈める */
.es-viewer-rims.has-active .es-rim:not(.active) {
  opacity: .45;
}
@keyframes es-rim-flash {
  from { box-shadow: 0 0 0 14px rgba(33, 150, 201, .45); }
}
.es-rim-label {
  position: absolute;
  left: 0;
  top: 0;
  transform: translateY(-100%);
  background: #8b959b;
  color: #fff;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px 4px 0 0;
  white-space: nowrap;
  pointer-events: none;
}
.es-rim.filled .es-rim-label { background: #4caf50; }
.es-rim.active .es-rim-label { background: #2196c9; }
/* 表示の可否は renderRims() が .is-on で切り替える。インラインの display に
   していたときはメディアクエリで消せなかった(インラインが CSS に勝つため) */
.es-viewer-legend {
  position: absolute;
  left: 10px;
  bottom: 10px;
  display: none;
  gap: 10px;
  background: rgba(255, 255, 255, .94);
  border: 1px solid #d5dbdf;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 11px;
  color: #5b6770;
  pointer-events: none;
}
.es-viewer-legend.is-on {
  display: flex;
}
.es-viewer-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.es-legend-swatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.es-legend-swatch.filled { background: #4caf50; }
.es-legend-swatch.active { background: #2196c9; }
.es-legend-swatch.empty { border: 1.5px dashed #9aa6ad; }
.es-viewer-empty {
  padding: 30px 12px;
  text-align: center;
  color: #666;
  font-size: 13px;
}

/* ===== PC: ビューアとエディタを左右に並べる ===== */
@media (min-width: 900px) {
  .es-work { flex-direction: row; }
  .es-form[data-mode] .es-pane-question {
    display: flex;
    flex: 1 1 58%;
    border-right: 1px solid #ddd;
  }
  .es-form[data-mode] .es-pane-form {
    display: flex;
    flex: 1 1 42%;
  }
  .es-form[data-mode] .es-strip { display: flex; }
  .es-savebar .es-editor-nav { display: none; }
  .es-key-hints { display: flex; }
  .es-field-name { display: none; }
  .es-preview-row {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    flex-wrap: wrap;
  }
  /* 幅は basis で決める。中身で伸びると ResizeObserver がループするので min-width:0 必須 */
  .es-preview-slot { flex: 1 1 58%; min-width: 0; margin-bottom: 14px; }
  /* プレビューと入力欄を同時に視界に収め、スクロールしての見比べを減らす。
     この上限が当たるのは縦長の切り出しだけで、横長は先に幅で頭打ちになる */
  .es-preview-wrap canvas.es-crop { max-height: 36vh; }
  .es-question-preview {
    display: block;
    flex: 1 1 30%;
    min-width: 0;
  }
}

/* ===== スマホ: 問題ページと入力を常に上下同時に見せる ===== */
@media (max-width: 899px) {
  /* 問題文(解答用紙に印字された設問文)を常時表示するための領域。
     可変にすると入力内容量でガタつくので固定高さにする */
  .es-pane-question {
    flex: 0 0 36vh;
    min-height: 170px;
    border-bottom: 1px solid #ddd;
  }
  .es-pane-form {
    flex: 1 1 auto;
    min-height: 0; /* editorBody の内部スクロールを効かせるために必須 */
  }
  /* 下書き復元バー等が常時表示のquestionPaneと競合して編集領域を圧迫しすぎないよう縮める */
  .es-notices { max-height: 22vh; }
  /* 凡例は解答用紙ペインに浮いて本文に重なる。狭い画面では枠のラベルが
     「— 入力中」「— 未入力」「— 編集不可」と状態を文字で書いているので出さない
     (ツールバーへ移すと flex-wrap で2行目に折り返し、36vh しかないペインを
     さらに削るため採らない) */
  .es-viewer-legend.is-on { display: none; }
  .es-preview-head { display: none; }
  /* 枠(.es-preview-wrap)は canvas と同じ大きさのままにすること。
     ここを width:100% にすると、canvas の左端と枠の左端がずれて
     オーバーレイ画像と rim ガイド(どちらも絶対配置)の位置計算が狂う */
  .es-preview-slot { margin-bottom: 10px; }
  /* 解答欄内に収まるかの最終確認用の帯。問題文はquestionPaneが常時見せるので、
     textareaの領域を残すため上限は控えめにする。ただし1文字の縦書き解答欄
     (縦横比 0.7 前後)が読める大きさは要る。この上限が当たるのは縦長の
     切り出しだけで、横長(実機の大多数)は先に幅で頭打ちになるため縦の予算は増えない */
  .es-preview-wrap canvas.es-crop { max-height: min(200px, 26vh); }
  .es-editor-nav.pc-only { display: none; }
  .es-editor-head .es-editor-name { display: none; }
  .es-progress-count, .es-autosave { display: none; }
  .es-progress-bar { width: 52px; }
  .es-header-right { gap: 8px; }
  .es-editor-head { padding: 8px 12px; }
  .es-editor-name { font-size: 15px; }
  .es-editor-body { padding: 10px 12px; }
  .es-savebar { padding: 8px 12px 12px; }
}
`;
