# UI回帰チェック

```bash
npm run verify
```

`dist/easysmarky.iife.js`(実際の配布物)を、Smarky の API をスタブしたページに読み込ませ、
ヘッドレス Chromium で操作して挙動を検証する。**Smarky への接続もログインも不要。**

- `harness.html` — `window.fetch` を差し替えて Smarky の API を模した検証ページ。
  ページ画像は canvas で生成する。`window.__esAssert()` / `window.__esView(mode)` を公開している
  (mode は `list` / `view` / `edit`)
- `drive.mjs` — 静的サーバの起動 → Chromium 起動 → CDP 操作 → 判定 まで行う。
  playwright/puppeteer は使わず、Node のグローバル `WebSocket` で CDP を直接叩いている
  (Node 22未満だと `WebSocket is not defined` で落ちる。`package.json` の `engines.node` 参照)
- 出力(スクリーンショット)は `out/`(gitignore 済み)

`chromium` 以外を使う場合は `CHROME_BIN=google-chrome-stable npm run verify`。

## 検証している内容

スマホ幅(430px)と PC 幅(1400px)の両方で:

| 項目 | 落ちたときに起きること |
|---|---|
| 設問ストリップに全設問が並び、移動できる | 目次が壊れ、設問を探せなくなる |
| 問題ページには枠を出さず、解答用紙にだけ枠と凡例が出る | 座標の合わない位置に枠が出る |
| 枠が用紙サイズに対する百分率で置かれる | 拡大すると枠と解答欄がズレる |
| 解答欄をタップするとその設問が開く | 2a の主動線(タップ→入力)が死ぬ |
| **スマホ: 入力モードでプレビューが描画される** | 下書きを再開した人のプレビューが永久に空になる(下記) |
| PC: 2カラムで両ペインが出て、初期表示でプレビューが描かれる | レイアウト崩れ |
| 幅変更でスケールが再計算される | プレビューのテキスト位置がズレる |
| `ResizeObserver` が無限ループしない | リサイズでフリーズする |
| 入力で進捗・ストリップ・プレビュー・文字数が更新される | 入力結果が確認できない |
| 「次の未入力へ」で未入力の設問に移る | 未入力を追う導線が死ぬ |
| `Ctrl`+`↵` で次の設問に移る | キーボード操作が壊れる |
| 下書き保存が再取得照合まで通る | **保存が壊れる(最重要のリグレッション)** |
| 背景ページのスクロールがロックされる | オーバーレイの裏でSmarkyがスクロールする |

## 注意点

### スマホのプレビュー描画は ResizeObserver だけが支えている

スマホは問題ページ(`data-mode="view"`)から始まるので、入力ペイン `.es-pane-form` は
`display: none` で始まる。このとき解答欄 canvas の実幅は 0 になり、
`updatePreview()`(`src/ui/fieldEditor.ts`)は幅0ガードで即 return する。
つまり**プレビューを描くのは、解答欄をタップして編集モード(`data-mode="edit"`)に
入ったときに `ResizeObserver` が発火する経路だけ**。ここを壊すと、下書きを再開した
スマホユーザーはプレビューが永久に空になる。`updatePreview()` のキャッシュ(`lastRendered`)を
早期return の分岐で更新してしまうのも同じ結果を招く。

### `--virtual-time-budget` は使わないこと

仮想時間ではレンダリング更新が実時間どおりに走らず `ResizeObserver` が配信されないため、
「編集モードに入ってもプレビューが描画されない」という**偽の不具合**が出る。
同じ理由で、ブラウザウィンドウが不可視(`document.hidden === true`)だと
`requestAnimationFrame` が止まり `ResizeObserver` も発火しない。

### Shadow DOM の外に出るイベント

キーボードショートカットは `window` の capture で受けている(オーバーレイのどこに
フォーカスがあっても効かせるため)。ハーネスから合成イベントで叩くときは
`composed: true` を付けないと Shadow DOM の境界を越えない。

### スタブの保存はステートフル

`/api/student/digital_report/save` を受けると、送られた `param_base_sheet_fields` の
`answer_texts` をスタブ側の状態に書き戻す。これにより `src/save/save.ts` の
「保存 → 再取得 → 送ったテキストが反映されているか照合」が本物どおり動く。
ステートレスにすると照合が必ず失敗するので、この挙動は維持すること。

### 一覧の進捗は localStorage 由来

一覧の「3/8」と「手書きあり・保存不可」は、一度開いた回の要約を
`easysmarky:summary:{studentCode}` に残したものを読んでいる。ハーネスは実行のたびに
`easysmarky:` で始まるキーを消してから始めるので、一覧の進捗欄は「—」で始まる。

### 検証していないこと

実機の Smarky でしか確認できないものは対象外:
問題文が「問題」「解答用紙」どちらのタブに載るか、rim の枠が実際の解答用紙とどれだけ
合うか、iOS Safari の `100dvh` とソフトキーボード表示時のレイアウト、実サーバへの保存、
ユーザースクリプト版の「別タブで開く」。
