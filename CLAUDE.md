# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

学校のデジタルレポート提出サイト「Smarky」( https://digi-repo.smarky.jp )の公式キャンバスUIの代わりに、全設問をフォームで一気に入力できるオーバーレイを提供するブックマークレット/ユーザースクリプト。ブラウザの既存Smarkyセッションをそのまま使い(パスワード非取扱)、**下書き保存までを自動化する。提出は絶対に行わない**。

## コマンド

```bash
npm run build                    # dist/easysmarky.iife.js と dist/easysmarky.user.js を生成
npm run dev                      # watchビルド(ブックマークレット版=iifeのみ)
npm run verify                   # ビルド + ヘッドレスChromiumでのUI回帰チェック
./node_modules/.bin/tsc --noEmit # 型チェック(ビルドは型チェックしないため必須)
```

リンターは無い。ユニットテストも無く、代わりに `npm run verify`(`tools/verify/`)が
**実際の配布物 `dist/easysmarky.iife.js` を、APIをスタブしたページに読み込ませて
ヘッドレスChromiumで操作する回帰チェック**を行う。Smarkyへの接続は不要。
`src/ui/` や `src/save/save.ts` を触ったら必ず流すこと。前提と落とし穴は
`tools/verify/README.md` に書いてある(特に「スマホのプレビュー描画は ResizeObserver
だけが支えている」と「`--virtual-time-budget` は使わない」)。

これで確認できないもの(問題文がどちらのタブに載るか、iOS Safari の `100dvh`、
実サーバへの保存)は実機での確認が要る。

## リリース・デプロイ

- **リリース時は必ず `package.json` の `version` を上げる。** この値が userscript の `@version` に埋め込まれ(vite.config.ts)、Tampermonkey等の自動更新はこの比較で動く。
- 配布は GitHub Pages: `gh-pages` ブランチのルートに `easysmarky.iife.js`・`easysmarky.user.js`・`index.html` を置く(mainのソースとは別管理)。`index.html` は gh-pages 側だけの手書きファイルで main に実体は無いので、デプロイ時に上書きしない。
- **反映は `.github/workflows/deploy-gh-pages.yml` が自動で行う。** `package.json` を変更した push(または手動の `workflow_dispatch`)をトリガーに、型チェック→`npm run verify`→gh-pages側の `@version` と現在のバージョンを比較→違えば `easysmarky.iife.js`/`easysmarky.user.js` だけを差し替えてコミット・プッシュする(gh-pagesはCI内で `git worktree` を使い、mainの作業ツリーには持ち込まない)。バージョンが変わっていなければ何もせずスキップする。
- 手動で反映したい場合のみ、`npm run build` 後に `git worktree add ../gh-pages-deploy origin/gh-pages` などで別ディレクトリにgh-pagesを出し、対象2ファイルを差し替えてコミット・プッシュする。

## ビルド構成

`npm run build` は vite を2回実行する:

1. 通常モード → `src/main.ts` をエントリに `easysmarky.iife.js`(ブックマークレット版。ロードと同時にオーバーレイを起動/トグル)
2. `--mode userscript` → `src/userscript.ts` をエントリに `easysmarky.user.js`(右下に常駐ボタンだけ置き、押されたらオーバーレイを開く)

userscript ビルドでは vite.config.ts 内のカスタムプラグインが minify 後に UserScript バナーを付与し、`emptyOutDir: false` で1回目の成果物を残す。両エントリとも `window.__easysmarky` にコントローラを置いて二重起動を防ぐ。`bookmarklet/loader.js` はブックマーク登録用ローダーの元コード(圧縮前)。

## アーキテクチャ

データの流れ: `api/` でSmarky APIから取得 → `model/` で編集用構造体に変換 → `ui/` のフォームで編集 → `render/` でテキストをcanvasにPNG描画 → `save/` でZIP化してSmarkyへPOST → 保存後に再取得して反映を照合。

- `src/ui/` — Shadow DOM 上のオーバーレイ全体。`overlay.ts`(ホスト生成・画面遷移)→ `sheetPicker.ts`(科目・回の一覧)→ `formView.ts` + `fieldRow.ts`(設問ごとの入力フォーム)。CSSは `styles.ts` に文字列で集約
- `src/api/` — `fetch`(credentials: include)による薄いクライアント。型は `types.ts`
- `src/model/` — `field.ts`(編集可否の判定を含む `EditableField`)、`toParam.ts`(保存用パラメータ+ZIPエントリの構築)
- `src/render/` — canvasでのテキスト計測・描画(横書き/縦書き)
- `src/save/` — `buildZip.ts`(fflateで無圧縮ZIP生成)、`save.ts`(保存ガード→ZIP→POST→再取得照合のオーケストレーション)
- `src/storage/` — localStorageへの入力内容自動バックアップ(キー: `easysmarky:{studentCode}:{baseSheetId}:{times}`)

### Smarky公式 app.js との対応

`render/` と `model/toParam.ts` のロジックは、Smarky公式アプリ(minifyされた app.js)の挙動を忠実に再現したもの。コメントの「app.js の `Do`/`ye`/`$`/`ie`/`X` 相当」は公式コードのminify後関数名との対応を示す。計測式・改行分割規則(`/\r\n|\r|\n/`)・「保存の度に全answer_textsのPNGを再生成して再送する」方式などは公式と同一に保つこと。勝手に「改善」すると公式画面での表示とズレる。

## 安全上の不変条件(変更禁止)

- **提出APIは呼ばない。** 自動化するのは下書き保存(`/api/student/digital_report/save`)まで
- **手書き・画像の解答(`answer_images` / `base64_canvas`)が1つでも含まれるシートは保存自体をブロックする**(`model/toParam.ts` の `checkSaveGuard`)。GET APIが画像バイナリを再取得可能な形で返すか実機で未確認のため、データ消失防止の安全策
- 複数テキストスタンプ(`answer_texts` が2件以上)の設問は主テキストの追加編集をしない(既存分はメタデータから再レンダリングして送り返すのみ)
- 保存後は同条件で再取得し、送信したテキストが反映されているかを照合する(`save/save.ts`)
