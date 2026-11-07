// 方向2(一覧画面)の CSS。担当だけが追記する。
export const LIST_CSS = `
/* 続きから(前回開いた回)。.es-list-item は付けない(既存の検査が先頭の .es-list-item を開くため) */
.es-resume {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 44px;
  padding: 12px;
  margin: 4px 0 12px;
  border: 1px solid #1b7fae;
  border-radius: 8px;
  background: #2196c9;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: bold;
  text-align: left;
  cursor: pointer;
}
.es-resume:active { background: #1b7fae; }

/* 更新ボタン(一覧の注記行)。文言と一緒に折り返さないよう、注記行は折り返しを許して文言側を止める */
.es-list-note { flex-wrap: wrap; row-gap: 4px; }
.es-list-note > span:first-child { white-space: nowrap; }
.es-list-refresh {
  flex: 0 0 auto;
  min-height: 32px;
  white-space: nowrap;
  padding: 4px 12px;
  border: 1px solid #b8c4cb;
  border-radius: 12px;
  background: #fff;
  color: #3d4a52;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.es-list-refresh:disabled { opacity: 0.5; cursor: default; }

/* 締切超過。未提出の回だけに付く。注意(std)→ 強い警告(final) の2段階 */
.es-badge.overdue { background: #b45309; color: #fff; }
.es-badge.overdue-final { background: #c62828; color: #fff; }
.es-list-item.overdue .es-sub { color: #b45309; font-weight: bold; }
.es-list-item.overdue-final .es-sub { color: #c62828; font-weight: bold; }
`;
