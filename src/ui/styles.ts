export const OVERLAY_STYLES = `
:host, * { box-sizing: border-box; }
.es-root {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: rgba(0, 0, 0, 0.45);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  overflow-y: auto;
  padding: 0;
}
.es-panel {
  background: #fff;
  color: #222;
  width: 100%;
  max-width: 720px;
  min-height: 100vh;
  padding: 12px 14px 96px;
}
@media (min-width: 760px) {
  .es-panel {
    min-height: auto;
    margin: 24px auto;
    border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.3);
  }
}
.es-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 2px solid #2196c9;
  margin-bottom: 12px;
  position: sticky;
  top: 0;
  background: #fff;
  z-index: 1;
}
.es-title {
  font-size: 16px;
  font-weight: bold;
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
  padding: 10px 0 4px;
  margin-top: 8px;
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
`;
