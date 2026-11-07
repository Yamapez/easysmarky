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
const EASYSMARKY_URL = "https://yamapez.github.io/easysmarky/easysmarky.user.js";

// 認証を伴わない静的アセット。エッジにキャッシュしてコールドロード(app.js+vendors.js で約11MB)を軽くする。
function isStaticAsset(pathname) {
  return (
    /^\/(js|css|img|fonts|static)\//i.test(pathname) ||
    /\.(js|mjs|css|png|jpe?g|gif|svg|ico|woff2?|ttf|map)$/i.test(pathname)
  );
}

/**
 * easysmarky 本体を <script> タグとして返す。
 *
 * 外部 src ではなく**サーバー側で取得して HTML に直接埋め込む**。クライアントが
 * yamapez.github.io に到達できない環境(学校ネットワークの制限など)でも動かすため。
 * 取得に失敗したときだけ、従来どおり外部 src のタグにフォールバックする。
 */
async function easysmarkyScriptTag() {
  try {
    const res = await fetch(EASYSMARKY_URL, {
      cf: { cacheEverything: true, cacheTtl: 600 },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const code = await res.text();
    // 文字列リテラル中に "</script" があると <script> ブロックを脱出して HTML が壊れる。
    const safe = code.replace(/<\/script/gi, "<\\/script");
    return `<script>${safe}</script>`;
  } catch {
    return `<script src="${EASYSMARKY_URL}"></script>`;
  }
}

/**
 * ハッシュが空のときだけ、学校のログイン画面のハッシュを設定する小さなブートストラップ。
 *
 * 公式SPAはログインAPIに渡す school_url_prefix を URL のハッシュ
 * (/#/<prefix>/student_site/sign_in)のルートパラメータからしか取らない。ハッシュ無しで
 * ルートを開くと空になり「ログインに失敗しました。URLが不正です。」(410)になる。
 *
 * サーバー側の 302 リダイレクトではダメ。**フラグメントはサーバーに送られない**ため、
 * どのハッシュルートにいてもリロード時のリクエストは GET / になり、
 * レポートの途中でリロードするとログイン画面に飛ばされて現在位置を失う。
 * JS からならハッシュが見えるので「空のときだけ」を正しく判定できる。
 *
 * SPA のスクリプトより前(<head> 直後)に置く。後から実行すると Vue Router が
 * 空ハッシュで初期化された後になり、画面がちらつく。
 */
function hashBootstrapTag(prefix) {
  if (!prefix) return "";
  const json = JSON.stringify(String(prefix));
  return `<script>(function(){if(!location.hash){location.replace(location.pathname+"#/"+${json}+"/student_site/sign_in");}})();</script>`;
}

export default {
  async fetch(request, env) {
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
      const scriptTag = await easysmarkyScriptTag();
      const bootstrap = hashBootstrapTag(env && env.SCHOOL_URL_PREFIX);

      let injected = original;
      // ブートストラップは SPA のスクリプトより前に置く必要がある。
      if (bootstrap) {
        injected = injected.includes("<head>")
          ? injected.replace("<head>", "<head>" + bootstrap)
          : bootstrap + injected;
      }
      injected = injected.includes("</body>")
        ? injected.replace("</body>", scriptTag + "</body>")
        : injected + scriptTag;

      // 長さもエンコーディングも変わるので消す(元の content-encoding が残ると
      // ブラウザが展開に失敗してページが壊れる)。
      respHeaders.delete("content-length");
      respHeaders.delete("content-encoding");
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
