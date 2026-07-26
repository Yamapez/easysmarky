export const OVERLAY_STYLES = `
:host, * { box-sizing: border-box; }
.es-root {
  position: fixed;
  inset: 0;
  height: 100vh;   /* dvh 未対応ブラウザ向けのフォールバック */
  height: 100dvh;  /* iOS Safari のツールバー分を除いた実際の表示高さ */
  z-index: 2147483000;
  background: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif;
  overflow: hidden; /* スクロールは内側のペインが持つ */
}
.es-panel {
  background: #fff;
  color: #222;
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
.es-title {
  font-size: 16px;
  font-weight: bold;
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
}
.es-close {
  border: none;
  background: #eee;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
  min-height: 40px;
}
.es-list-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 12px 10px;
  margin-bottom: 6px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
  font-size: 14px;
  min-height: 44px;
}
.es-list-item:active { background: #eef7fb; }
.es-list-item .es-sub { color: #666; font-size: 12px; margin-top: 2px; }
.es-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  background: #2196c9;
  color: #fff;
  margin-left: 6px;
}
.es-badge.done { background: #4caf50; }
.es-badge.locked { background: #999; }
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
.es-field {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 14px;
}
.es-field-label {
  font-size: 13px;
  font-weight: bold;
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 6px;
}
.es-field-locked {
  font-size: 12px;
  color: #888;
  padding: 8px 0;
}
.es-preview-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
  margin-bottom: 8px;
  border: 1px solid #ccc;
  background: #f5f5f5;
}
.es-preview-wrap canvas.es-crop {
  display: block;
  max-width: 100%;
  height: auto;
}
.es-preview-overlay {
  position: absolute;
  pointer-events: none;
  image-rendering: pixelated;
}
.es-direction-toggle {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.es-direction-toggle button {
  flex: 1;
  padding: 8px;
  font-size: 13px;
  border: 1px solid #bbb;
  border-radius: 6px;
  background: #fff;
  min-height: 40px;
}
.es-direction-toggle button.active {
  background: #2196c9;
  color: #fff;
  border-color: #2196c9;
}
.es-textarea {
  width: 100%;
  min-height: 80px;
  font-size: 16px; /* iOS Safariでズームさせないため16px以上 */
  padding: 8px;
  border: 1px solid #bbb;
  border-radius: 6px;
  resize: vertical;
  font-family: inherit;
}
.es-savebar {
  position: sticky;
  bottom: 0;
  background: #fff;
  border-top: 1px solid #ddd;
  /* スクロールコンテナ(.es-pane-form)の左右パディング分を打ち消して端まで背景を敷く */
  margin: 8px -12px 0;
  padding: 10px 12px 4px;
}
.es-save-btn {
  width: 100%;
  padding: 14px;
  font-size: 16px;
  font-weight: bold;
  border: none;
  border-radius: 8px;
  background: #2196c9;
  color: #fff;
  min-height: 48px;
}
.es-save-btn:disabled {
  background: #aac7d3;
}
.es-save-status {
  font-size: 13px;
  margin-top: 6px;
  text-align: center;
}
.es-loading {
  padding: 40px 10px;
  text-align: center;
  color: #666;
}
.es-back {
  border: none;
  background: transparent;
  color: #2196c9;
  font-size: 14px;
  padding: 8px 0;
  min-height: 40px;
}

/* ===== 問題ビューアと入力フォームの2ペイン ===== */
.es-form-layout {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.es-pane-tabs {
  flex: 0 0 auto;
  display: flex;
  border-bottom: 1px solid #ddd;
}
.es-pane-tabs button {
  flex: 1 1 50%;
  border: none;
  border-bottom: 3px solid transparent;
  background: #f5f5f5;
  color: #555;
  font-size: 14px;
  min-height: 44px;
}
.es-pane-tabs button.active {
  background: #fff;
  color: #2196c9;
  font-weight: bold;
  border-bottom-color: #2196c9;
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
  overflow-y: auto;
  padding: 10px 12px 12px;
}
/* スマホ: data-pane で一方だけを表示する */
.es-form-layout[data-pane="form"] .es-pane-question { display: none; }
.es-form-layout[data-pane="question"] .es-pane-form { display: none; }

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
.es-viewer-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
.es-viewer-img {
  display: block;
  /* 幅を変えることでスクロール可能領域も広がる。transform: scale() だとレイアウトが
     変わらず拡大時に画像の端へスクロールできないため、width で拡大する */
  width: 100%;
  max-width: none;
  height: auto;
}
.es-viewer-empty {
  padding: 30px 12px;
  text-align: center;
  color: #666;
  font-size: 13px;
}
.es-field-pagelink {
  border: none;
  background: transparent;
  color: #2196c9;
  font-size: 13px;
  padding: 4px 0;
  min-height: 32px;
}

/* ===== PC: 2カラム。data-pane による display:none を同詳細度・後勝ちで打ち消す ===== */
@media (min-width: 900px) {
  .es-pane-tabs { display: none; }
  .es-form-layout { flex-direction: row; }
  .es-form-layout[data-pane] .es-pane-question {
    display: flex;
    flex: 0 0 46%;
    border-right: 1px solid #ddd;
  }
  .es-form-layout[data-pane] .es-pane-form {
    display: block;
    flex: 1 1 54%;
  }
}
`;
