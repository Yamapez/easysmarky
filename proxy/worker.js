// easysmarky リバースプロキシ (Cloudflare Worker)
//
// digi-repo.smarky.jp を運用者のオリジンで透過的に中継し、公式 SPA のシェル(HTML)に
// easysmarky を <script> で注入する。これにより:
//   - ログインは公式 SPA のコードがそのまま処理する(easysmarky はパスワードに触れない)
//   - easysmarky は「プロキシオリジンと同一オリジン」で動くので、Cookie 認証がそのまま効く
//     (別オリジンからの直 fetch では Cookie もヘッダ認証も使えないことを実測で確認済み)
//
// 【安全上の約束】このワーカーはリクエスト/レスポンスのボディを一切ログ・保存しない。
//   パスワードとレポート内容がここを通過するため、私的利用に限ること。
//   詳細と警告は proxy/README.md を参照。

const UPSTREAM_ORIGIN = "https://digi-repo.smarky.jp";
const UPSTREAM_HOST = "digi-repo.smarky.jp";

// SPA シェルに差し込むスクリプト。userscript 版(右下に launcher ボタンを常駐させる)を使う。
// iife 版はロード即オーバーレイを開いてしまい、公式画面での「提出」操作を妨げるため使わない。
const INJECT_SCRIPT =
  '<script src="https://yamapez.github.io/easysmarky/easysmarky.user.js"></script>';

// 認証を伴わない静的アセット。エッジにキャッシュしてコールドロード(app.js+vendors.js で約11MB)を軽くする。
function isStaticAsset(pathname) {
  return (
    /^\/(js|css|img|fonts|static)\//i.test(pathname) ||
    /\.(js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)$/i.test(pathname)
  );
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upstreamUrl = UPSTREAM_ORIGIN + url.pathname + url.search;
    const isStatic = isStaticAsset(url.pathname);

    // ---- 上流へ送るリクエストヘッダを組み立てる ----
    const reqHeaders = new Headers(request.headers);
    // Rails の protect_from_forgery(オリジンチェック)対策。state 変更系 POST で
    // Origin/Referer がプロキシオリジンだと弾かれるので、無条件に本家へ書き換える。
    reqHeaders.set("Origin", UPSTREAM_ORIGIN);
    reqHeaders.set("Referer", UPSTREAM_ORIGIN + "/");
    reqHeaders.set("Host", UPSTREAM_HOST);
    // 静的アセットは Cookie 不要。付けたままだとエッジキャッシュが Cookie 単位で分裂するので落とす。
    if (isStatic) reqHeaders.delete("Cookie");

    const init = {
      method: request.method,
      headers: reqHeaders,
      redirect: "manual",
    };
    // ボディ(保存時の multipart など)はストリームのまま転送する。
    // ストリーム body を渡すときは duplex:"half" が必須(付けないと fetch が投げる環境がある)。
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    if (isStatic) {
      init.cf = { cacheEverything: true, cacheTtl: 3600 };
    }

    const upstream = await fetch(upstreamUrl, init);

    // ---- レスポンスヘッダを組み立て直す ----
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete("content-security-policy");
    respHeaders.delete("content-security-policy-report-only");
    respHeaders.delete("x-frame-options");

    // Set-Cookie は getSetCookie() で正しく分割する(get("Set-Cookie") はカンマ結合で壊れる)。
    // Domain= を剥がさないと、本家ドメイン固定の Cookie がプロキシオリジンで拒否され、
    // 「ログインは成功したのに以降すべて 401」になる。
    respHeaders.delete("set-cookie");
    const setCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : [];
    for (const cookie of setCookies) {
      respHeaders.append("set-cookie", cookie.replace(/;\s*Domain=[^;]*/i, ""));
    }

    // リダイレクト先が本家絶対URLならプロキシオリジンへ寄せる。
    const location = respHeaders.get("location");
    if (location) {
      respHeaders.set(
        "location",
        location.replace(
          /^https?:\/\/digi-repo\.smarky\.jp/i,
          url.origin,
        ),
      );
    }

    // ---- HTML(SPA シェル)なら easysmarky を注入して返す ----
    const contentType = upstream.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const original = await upstream.text();
      const injected = original.includes("</body>")
        ? original.replace("</body>", INJECT_SCRIPT + "</body>")
        : original + INJECT_SCRIPT;
      respHeaders.delete("content-length"); // 長さが変わるので消す
      return new Response(injected, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      });
    }

    // それ以外はストリームのまま素通し。
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  },
};
