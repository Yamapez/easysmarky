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
UIは「1設問ずつ集中して入力する」方針で作られている(解答用紙の解答欄をタップして入力に入り、
下部の設問ストリップで移動し、「次の未入力へ」で未入力を追う)。解答欄の枠は、rim の座標系が
確実な解答用紙ページにだけ重ねること(問題ページ側で一致するかは実機で未確認)。

### answer_type の値(公式 app.js の AnswerTypeEnum と一致・実機で確認)

`1` 手書き・テキスト / `2` 手書きのみ / `3` テキストのみ / `4` 選択肢(記号問題) / `5` 画像。
`src/api/types.ts` の `AnswerType` と同じ値。以前の定義(1テキスト・2選択・3画像)は誤りだった。
テキストを打てるのは 1 と 3、選択式は 4、それ以外は編集不可。

### rim の座標系(実機で確認済み・v0.6.2)

- **`base_sheet` に `width` / `height` は無い。** rim と `cut_margin` の座標系は
  `base_sheet.correct_image_size`(ページごとの `[w,h]` を並べたフラット配列)から取る。
  解決は `src/model/sheetGeometry.ts` に集約してある
- 実機の全59レポートで `correct_image_size` は解答用紙画像の実解像度と一致していた。
  ただし一致は前提にせず、切り出しは `naturalWidth` との比で換算する
- 実機のレポートには**問題ページ画像が1件も無かった**(`question_page_count: 0`)。
  PC幅で解答欄プレビューの横に出る「問題(目安)」は実際には表示されていない。
  `question_image_size` の中身も未確認
- `dpi` は 200。`cut_margin` は 20(= 約2.5mm)しかないので、プレビューでは実寸2mmぶんの
  余白を足して見せ、保存される範囲(rim)を破線の枠で示している。保存内容には影響しない

国語の問題文は**解答用紙画像に印字されている**(採点結果画面と easysmarky で実機確認。問題画像・動画・吹き出しは空)。上ペインでは本文が小さすぎるため、「読む」で解答用紙を全画面表示する。
これで確認できないもの(iOS Safari の `100dvh`、
実サーバへの保存)は実機での確認が要る。

## リリース・デプロイ

- **リリース時は必ず `package.json` の `version` を上げる。** この値が userscript の `@version` に埋め込まれ(vite.config.ts)、Tampermonkey等の自動更新はこの比較で動く。
- 配布は GitHub Pages(ソース: GitHub Actions)。`gh-pages` ブランチは使わない — `dist/`(`easysmarky.iife.js`・`easysmarky.user.js`・`index.html`)をビルド成果物としてそのままPagesにアップロードする。`index.html` は `public/index.html` が実体で、Viteのpublicディレクトリとして自動的に `dist/` にコピーされる。
- **反映は `.github/workflows/deploy-pages.yml` が自動で行う。** `package.json` を変更した push(または手動の `workflow_dispatch`)をトリガーに、型チェック→`npm run verify`→`package.json` の version が直前のコミットから変わっているか確認→変わっていれば `actions/upload-pages-artifact` / `actions/deploy-pages` で `dist/` を配信する。バージョンが変わっていなければ(`workflow_dispatch` 以外は)何もせずスキップする。
- リポジトリ設定は Settings → Pages → Source を「GitHub Actions」にしておくこと(「Deploy from a branch」ではない)。
- 旧 `gh-pages` ブランチは移行前の名残で、もう配信には使われていない。

## ビルド構成

`npm run build` は vite を2回実行する:

1. 通常モード → `src/main.ts` をエントリに `easysmarky.iife.js`(ブックマークレット版。ロードと同時にオーバーレイを起動/トグル)
2. `--mode userscript` → `src/userscript.ts` をエントリに `easysmarky.user.js`(右下に常駐ボタンだけ置き、押されたらオーバーレイを開く)

userscript ビルドでは vite.config.ts 内のカスタムプラグインが minify 後に UserScript バナーを付与し、`emptyOutDir: false` で1回目の成果物を残す。両エントリとも `window.__easysmarky` にコントローラを置いて二重起動を防ぐ。`bookmarklet/loader.js` はブックマーク登録用ローダーの元コード(圧縮前)。

## アーキテクチャ

データの流れ: `api/` でSmarky APIから取得 → `model/` で編集用構造体に変換 → `ui/` のフォームで編集 → `render/` でテキストをcanvasにPNG描画 → `save/` でZIP化してSmarkyへPOST → 保存後に再取得して反映を照合。

- `src/ui/` — Shadow DOM 上のオーバーレイ全体。`overlay.ts`(ホスト生成・画面遷移・ヘッダのスロット)→ `sheetPicker.ts`(科目・回の一覧)→ `formView.ts`(1設問集中レイアウトの司令塔)。`formView.ts` が使う部品は `pageViewer.ts`(ページ画像 + 解答欄の枠オーバーレイ)・`fieldEditor.ts`(1設問ぶんの入力欄とプレビュー)・`questionStrip.ts`(下部の設問チップ)。CSSは `styles.ts` に文字列で集約
- `src/api/` — `fetch`(credentials: include)による薄いクライアント。型は `types.ts`
- `src/model/` — `field.ts`(編集可否の判定を含む `EditableField`)、`toParam.ts`(保存用パラメータ+ZIPエントリの構築)
- `src/render/` — canvasでのテキスト計測・描画(横書き/縦書き)
- `src/save/` — `buildZip.ts`(fflateで無圧縮ZIP生成)、`save.ts`(保存ガード→保存直前の再取得→他所での変更の確認→ZIP→POST→再取得照合のオーケストレーション)、`conflict.ts`(設問ごとの答えの指紋と、他所での変更の判定。サーバーには版番号が無いので内容で比べる)
- `src/storage/` — localStorageへの入力内容自動バックアップ(キー: `easysmarky:{studentCode}:{baseSheetId}:{times}`、値は `{v:2, savedAt, fields}`。v0.5.0以前のフラットな形式も読める)と、一覧に出す進捗の要約(キー: `easysmarky:summary:{studentCode}`)。一覧APIは設問を返さないため、進捗と「手書きあり・保存不可」は一度開いた回の要約だけから出す。
下書きの各設問には、読み込み時(直近の保存後)にサーバーが持っていた値を `base` として任意項目で足す(v:2 のまま。古い版が読んでも壊れない)。復元は `base` と違う(=この端末で触った)設問だけを戻し、戻した設問のうちサーバーの今の値が `base` と違うものは競合として知らせる。`base` の無い下書きは従来どおり全部戻す。復元した設問は元の `base` を引き継ぎ、他所で変わった設問は保存時に「上書きして保存」の確認を通すまで送らない(復元バナーは最初の編集で消えるため、保存の確認が持続する守り)。「元に戻す」は復元前の基準に戻す。
同じ回を別のタブで書かれたら(`storage` イベント)、取り合いになるおそれを知らせる(中身はマージしない)。
v0.11.0 で、次の端末側の保存を足した: 「続きから」用の最後に開いた回(キー: `easysmarky:last:{studentCode}`、`src/storage/listState.ts`)と、端末共通の表示設定(キー: `easysmarky:prefs`、`src/storage/prefs.ts`。`zoom` は手動で変えた倍率、`direction` は手動で選んだ書字方向)。`saveBackup` と `saveSheetSummary` は boolean を返し、失敗を呼び出し側が警告に使う。保存成功後に残ってよいキーは `tools/verify/harness.html` の `KEEP_AFTER_SAVE` に列挙する(新しい永続キーを足したら必ず足す)。
起動時に残っている下書きがある間の最初の入力で、古い下書きを `easysmarky:archive:{studentCode}:{baseSheetId}:{times}` へ退避してから、新しい入力を下書きに自動保存する(`offerPending`、`archiveBackupOnce`、`src/ui/formView.ts` と `src/storage/backup.ts`)。退避は保存成功か「破棄する」で消す。退避は一覧や画面からは出していない(この画面を開いている間の「復元する」だけが戻せる)。
方向別の CSS は `src/ui/styles/{safety,list,mobile}.ts` を連結する(`OVERLAY_STYLES`)。キーボード追従は `src/ui/viewport.ts`(`--es-vvh` と `es-kbd`)。

### Smarky公式 app.js との対応

`render/` と `model/toParam.ts` のロジックは、Smarky公式アプリ(minifyされた app.js)の挙動を忠実に再現したもの。コメントの「app.js の `Do`/`ye`/`$`/`ie`/`X` 相当」は公式コードのminify後関数名との対応を示す。計測式・改行分割規則(`/\r\n|\r|\n/`)・「保存の度に全answer_textsのPNGを再生成して再送する」方式などは公式と同一に保つこと。勝手に「改善」すると公式画面での表示とズレる。
- 記号問題(`answer_type: 4`・選択式)も公式 app.js に合わせる。選択肢は `choice_texts` を並べ、選んだ文字は `answer_texts[0].text` に入る。選び直したときだけ中央に置き直し、無回答は 1x1 の空スタンプ(PNG は空文字で描く)。根拠は `src/model/toParam.ts` の `buildFieldForSave` と `src/ui/fieldEditor.ts` の選択式の分岐に書いてある

## 安全上の不変条件(変更禁止)

- **提出APIは呼ばない。** 自動化するのは下書き保存(`/api/student/digital_report/save`)まで
- **手書き・画像の解答(`answer_images` / `base64_canvas`)が1つでも含まれるシートは保存自体をブロックする**(`model/toParam.ts` の `checkSaveGuard`)。GET APIが画像バイナリを再取得可能な形で返すか実機で未確認のため、データ消失防止の安全策
- 複数テキストスタンプ(`answer_texts` が2件以上)の設問は主テキストの追加編集をしない(既存分はメタデータから再レンダリングして送り返すのみ)
- 保存直前に再取得し、手書きが増えていれば送らない。読み込み後に他所で変わった設問を、送ると置き換えてしまうなら送らず、利用者に「上書きして保存」を確認付きで選ばせる(`save/save.ts`、`save/conflict.ts`)
- 保存後は同条件で再取得し、送信したテキストが反映されているかを照合する(`save/save.ts`)
