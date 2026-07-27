# UI回帰チェック

```bash
npm run verify
```

`dist/easysmarky.iife.js`(実際の配布物)を、Smarky の API をスタブしたページに読み込ませ、
ヘッドレス Chromium で操作して挙動を検証する。**Smarky への接続もログインも不要。**

- `harness.html` — `window.fetch` を差し替えて Smarky の API を模した検証ページ。
  ページ画像は canvas で生成する。`window.__esAssert()` / `window.__esView(pane)` を公開している
- `drive.mjs` — 静的サーバの起動 → Chromium 起動 → CDP 操作 → 判定 まで行う。
  playwright/puppeteer は使わず、Node のグローバル `WebSocket` で CDP を直接叩いている
- 出力(スクリーンショット)は `out/`(gitignore 済み)

`chromium` 以外を使う場合は `CHROME_BIN=google-chrome-stable npm run verify`。

## 検証している内容

スマホ幅(430px)と PC 幅(1400px)の両方で:

| 項目 | 落ちたときに起きること |
|---|---|
| スマホ: タブが出て「問題」から始まる | 問題文が見えないまま解答を求められる |
| **スマホ: 「解答」タブでプレビューが描画される** | 下書きを再開した人のプレビューが永久に空になる(下記) |
| PC: 2カラムでタブが隠れ、両ペインが出る | レイアウト崩れ |
| 幅変更でスケールが再計算される | プレビューのテキスト位置がズレる |
| `ResizeObserver` が無限ループしない | リサイズでフリーズする |
| 入力したテキストのプレビューが出る | 入力結果が確認できない |
| 下書き保存が再取得照合まで通る | **保存が壊れる(最重要のリグレッション)** |
| 背景ページのスクロールがロックされる | オーバーレイの裏でSmarkyがスクロールする |

## 注意点

### スマホのプレビュー描画は ResizeObserver だけが支えている

スマホでは初期タブが「問題」なので `.es-pane-form` が `display: none` で始まる。
このとき解答欄 canvas の実幅は 0 になり、`updatePreview()`(`src/ui/fieldRow.ts`)は
幅0ガードで即 return する。つまり**プレビューを描くのは、「解答」タブを押したときに
`ResizeObserver` が発火する経路だけ**。ここを壊すと、下書きを再開したスマホユーザーは
プレビューが永久に空になる。`updatePreview()` のキャッシュ(`lastRendered`)を
早期return の分岐で更新してしまうのも同じ結果を招く。

### `--virtual-time-budget` は使わないこと

仮想時間ではレンダリング更新が実時間どおりに走らず `ResizeObserver` が配信されないため、
「タブ切替でプレビューが描画されない」という**偽の不具合**が出る。
同じ理由で、ブラウザウィンドウが不可視(`document.hidden === true`)だと
`requestAnimationFrame` が止まり `ResizeObserver` も発火しない。

### スタブの保存はステートフル

`/api/student/digital_report/save` を受けると、送られた `param_base_sheet_fields` の
`answer_texts` をスタブ側の状態に書き戻す。これにより `src/save/save.ts` の
「保存 → 再取得 → 送ったテキストが反映されているか照合」が本物どおり動く。
ステートレスにすると照合が必ず失敗するので、この挙動は維持すること。

### 検証していないこと

実機の Smarky でしか確認できないものは対象外:
問題文が「問題」「解答用紙」どちらのタブに載るか、iOS Safari の `100dvh` の効き、
実サーバへの保存、ユーザースクリプト版の「別タブで開く」。
