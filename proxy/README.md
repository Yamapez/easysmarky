# easysmarky リバースプロキシ（上級者向け・自己責任）

Smarky（ https://digi-repo.smarky.jp ）を**自分のドメインで透過的に中継**し、公式ページに
easysmarky を自動で注入する Cloudflare Worker です。これにより、拡張機能もブックマークレットも
使わずに「そのURLを開くだけ」で easysmarky が使えるようになります（スマホの Chrome でも
ホーム画面に追加してアプリのように起動できます）。

## ⚠️ 使う前に必ず読んでください

このプロキシは、あなたが入力する**Smarky のパスワードと全レポート内容が、あなたが立てた
プロキシ（Cloudflare Worker）を通過**します。

- easysmarky 本体のコードはパスワードを扱いません（ログインは公式 SPA のコードが処理します）。
  しかしプロキシはその通信をバイト列として中継するため、経路上に**自分のインフラが挟まります**。
- この Worker は**リクエスト/レスポンスのボディを一切ログ・保存しません**。改変してログを
  仕込まないでください。
- **他人（同級生など）に使わせないでください。** 他人に使わせると、他人の学校アカウントの
  資格情報をあなたが中継することになります。**私的利用に限定してください。**
- 学校のセキュリティ規約・利用規約に抵触する可能性があります。**利用は自己責任**です。

不安がある場合は、この方式ではなく[ブックマークレット版／ユーザースクリプト版](../README.md)を
使ってください。そちらは通信が Smarky と自分のブラウザの間だけで完結します。

## なぜこの方式なのか（技術的背景）

別オリジンの静的 web アプリから Smarky API を直接叩く方式は成立しません。実測の結果:

- Smarky API の認証は **Cookie のみ**（`access-token` などのヘッダ認証・クエリトークンはすべて 401）
- レスポンスは `Access-Control-Allow-Origin: *` だが `Access-Control-Allow-Credentials` を返さないため、
  ブラウザは別オリジンからの `credentials: "include"`（＝Cookie 送信）を拒否する

そのため「同一オリジンにしてしまう」プロキシ方式だけが動きます。公式 SPA には
`digi-repo.smarky.jp` の絶対URLが無く（API・JS・CSS は全て相対パス）、オリジン判定や
Cookie の domain 固定も無いので、丸ごと中継すれば別オリジンでもそのまま動作します。

## Worker の動作

- 上流 fetch で `Origin`/`Referer` を `https://digi-repo.smarky.jp` に書き換える
  （Rails の CSRF オリジンチェック対策）
- レスポンスの `Set-Cookie` から `Domain=` 属性を除去（本家ドメイン固定の Cookie が
  プロキシオリジンで拒否されるのを防ぐ）
- `Content-Security-Policy` / `X-Frame-Options` を除去
- `text/html`（SPA シェル）に easysmarky の userscript 版 `<script>` を注入
- `/js/` `/css/` などの静的アセットはエッジキャッシュ

## デプロイ手順

[Wrangler](https://developers.cloudflare.com/workers/wrangler/) を使います。グローバル
インストールは不要で、`npx` で実行できます（初回は自動でダウンロードされます）。

```bash
cd proxy
npx wrangler login    # ブラウザが開くので Cloudflare アカウントで許可する
npx wrangler deploy
```

デプロイすると `*.workers.dev` のURLが表示されます。そのURLを開き、いつもどおり Smarky に
ログインしてください。右下に「easysmarky」ボタンが出れば成功です。

独自ドメインで使いたい場合は [wrangler.toml](wrangler.toml) の `routes` を編集してください。
URLは**推測されにくいもの**にし、可能なら Cloudflare Access などでアクセス制限をかけることを
強く推奨します。

## 動作確認（デプロイした本人が実施）

プロキシ経由でログイン → easysmarky を開く → 下書きを1件保存 →
**公式サイト（ https://digi-repo.smarky.jp ）を直接開いて反映されているか確認**してください。
Set-Cookie や Origin の扱いに問題があると、この一連のどこかで目に見えて失敗します。

## 注意点

- 入力内容の localStorage バックアップはオリジン単位です。プロキシのドメインと
  `digi-repo.smarky.jp` は別オリジンなので、ブックマークレット版で取ったバックアップは
  プロキシ版からは見えません（Smarky サーバーに保存済みの下書き本体は当然読めます）。
- Smarky 側の作りが変わると中継が壊れることがあります。その場合は公式ページ（本家ドメイン）を
  直接使ってください。
