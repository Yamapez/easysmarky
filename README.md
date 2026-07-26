# easysmarky

学校のデジタルレポート提出サイト「Smarky」( https://digi-repo.smarky.jp )の入力を
もっと楽にするためのブックマークレット/ユーザースクリプトです。用紙画像の上に
テキストボックスを1個ずつ配置していくSmarky公式のキャンバスUIの代わりに、
全設問を普通のフォームで一気に入力できる画面を重ねて表示します。

- ログインは既存のブラウザのSmarkyセッションをそのまま使います(パスワードは一切扱いません)
- 「下書き保存」までを自動化します。**提出は行いません**(公式画面から手動で行ってください)
- 手書き・画像の解答が含まれる回答用紙は、データ消失を防ぐため保存自体を無効化します
- PC・スマートフォン(iOS Safari / Android Chrome)どちらでも動作します

導入方法は2通りあり、どちらか一方でかまいません(併用も可)。

- **ユーザースクリプト版**: Smarkyのページを開くと右下に起動ボタンが常駐。自動更新あり。導入には拡張機能/アプリが必要
- **ブックマークレット版**: 追加ソフト不要でどのブラウザでも使えるが、登録手順がやや煩雑

## 使い方(ユーザースクリプトの導入)

Tampermonkey などのユーザースクリプトマネージャーに
https://yamapez.github.io/easysmarky/easysmarky.user.js を登録します。
導入後は Smarky のページを開くと右下に「easysmarky」ボタンが表示され、
タップすると入力画面が開閉します。新しいバージョンは自動更新で配信されます。

### PC(Chrome / Edge / Firefox)

1. 拡張機能ストアから「Tampermonkey」(または Violentmonkey)をインストール
2. https://yamapez.github.io/easysmarky/easysmarky.user.js を開くと
   インストール確認画面が出るので「インストール」を押す

※Chrome系でインストール画面が出ない場合は、拡張機能の設定で
「デベロッパーモード」を有効にする必要があります(Tampermonkeyの仕様)。

### iOS Safari

1. App Storeから「Userscripts」アプリ(無料)をインストール
2. 設定→Safari→拡張機能 で Userscripts を有効化
3. Safariで https://yamapez.github.io/easysmarky/easysmarky.user.js を開き、
   アドレスバーの拡張機能アイコン→Userscripts からインストール

### Android

Android版Chromeは拡張機能に対応していないため、ユーザースクリプト版を使う場合は
Firefox(+Tampermonkey)などの対応ブラウザをご利用ください。
Chromeのまま使いたい場合は下記のブックマークレット版をどうぞ。

## 使い方(ブックマークレットの登録)

スクリプト本体は GitHub Pages( https://yamapez.github.io/easysmarky/easysmarky.iife.js )
で公開済みです。以下の1行をそのままブックマークの「URL」欄に貼り付ければ使えます。

```
javascript:(function(){if(window.__easysmarky){window.__easysmarky.toggle();return;}var s=document.createElement("script");s.src="https://yamapez.github.io/easysmarky/easysmarky.iife.js?v="+Date.now();document.body.appendChild(s);})();
```

(このリポジトリを自分でフォークして別URLにホストする場合は、`bookmarklet/loader.js` の
`SCRIPT_URL` を書き換えたうえで同様に1行へ圧縮してください)

### PC(Chrome / Safari など)

- ブックマークバーを表示し、右クリック→「ページを追加」などでブックマークを新規作成
- 名前を「easysmarky」、URLに上記の1行コードを貼り付けて保存
- Smarkyのレポート画面を開いた状態でブックマークをクリックすると起動します

### iOS Safari

1. 適当なページ(例: https://yamapez.github.io/easysmarky/ )をいったんブックマークに追加
2. 「ブックマークを編集」からそのブックマークのURLを上記の1行コードに書き換える
3. Smarkyをブラウザで開き、共有メニュー→ブックマークからeasysmarkyを選択して起動

### Android Chrome

1. アドレスバーの右のメニュー→「ブックマークを追加」で適当なページをブックマーク
2. ブックマークを開き、編集アイコンからURLを上記の1行コードに書き換える
3. Smarkyをブラウザで開き、アドレスバーに「easysmarky」と入力してブックマークから起動

もう一度ブックマークをクリック(タップ)すると、開いている画面の表示/非表示を切り替えます。

## 開発

```bash
npm install
npm run build   # dist/easysmarky.iife.js と dist/easysmarky.user.js を生成
npm run dev     # watchモードでビルド(ブックマークレット版のみ)
```

ユーザースクリプト版のバージョン(`@version`)は `package.json` の `version` を
そのまま埋め込みます。自動更新はこの値の比較で動くため、
**リリース時は必ず `version` を上げてください。**

型チェックのみ行う場合:

```bash
./node_modules/.bin/tsc --noEmit
```

## デプロイ(GitHub Pages)

`gh-pages` ブランチのルートに `easysmarky.iife.js`・`easysmarky.user.js`・
`index.html` を置く形でGitHub Pagesを公開しています( https://yamapez.github.io/easysmarky/ )。
更新する場合は `npm run build` で `dist/` の両ファイルを再生成し、
`gh-pages` ブランチの同名ファイルを差し替えてコミット・プッシュしてください
(mainブランチのソースとは別管理です)。ブックマークレットのローダーは
`?v=<timestamp>` を自動付与するため、ブラウザキャッシュを気にせず更新を反映できます。

## 使い方(アプリ本体)

1. Smarkyにログインした状態でブックマークレットを起動すると、科目・回の一覧が表示されます
2. 提出したい回をタップすると、設問ごとの入力フォームが開きます
   - 解答欄の切り抜きプレビューの上に、入力中のテキストがどう表示されるかのプレビューが重なります
   - 横書き/縦書きを設問ごとに切り替えられます
3. 「下書き保存」を押すと、Smarkyのサーバーに下書きとして保存されます
   - 保存後、自動的にサーバーへ再取得して反映を確認します
   - 手書き・画像の解答が含まれる回は、安全のため保存ボタンが無効化されます
4. 入力内容はブラウザのlocalStorageにも自動でバックアップされます
   (途中で閉じてしまっても、次回開いたときに復元できます)
5. **提出は必ず公式のSmarky画面から行ってください。**

## 制限事項・既知の注意点

- 複数のテキストスタンプが既に存在する設問、選択肢・画像タイプの設問は編集できません
  (公式画面をご利用ください)
- 手書き・画像の解答が1つでも含まれる回答用紙は、保存機能自体を無効化しています
  (Smarky APIが解答画像のバイナリを再取得可能な形で返すかどうかを実機で確認できていないため、
  誤って消してしまう事故を避ける安全策です)
- テキストの描画(フォント)は使用しているブラウザ・OSの `serif` フォントに依存します。
  ご自身が普段お使いの環境で入力・保存することを推奨します
