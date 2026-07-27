// easysmarky のUI回帰チェック。`npm run verify` で実行する。
//
// dist/easysmarky.iife.js(実際の配布物)を、SmarkyのAPIをスタブしたページに読み込ませ、
// ヘッドレスChromiumで操作して挙動を検証する。playwright/puppeteer は使わず、
// Node のグローバル WebSocket で CDP を直接叩く(依存を増やさないため)。
//
// 重要: --virtual-time-budget は使わないこと。仮想時間ではレンダリング更新が
// 実時間どおりに走らず ResizeObserver が配信されないため、
// 「タブ切替でプレビューが描画されない」という偽の不具合が出る。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const OUT_DIR = join(HERE, "out");
const PROFILE = join(OUT_DIR, "chrome-profile");
const CHROME = process.env.CHROME_BIN || "chromium";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 静的サーバ
async function startServer() {
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    const path = join(REPO_ROOT, rel);
    try {
      const body = await readFile(path);
      res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: server.address().port };
}

// ---------------------------------------------------------------- CDP
async function launchChrome(port) {
  const child = spawn(CHROME, [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${PROFILE}`,
    "--window-size=1400,900",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  for (let i = 0; i < 150; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return { child, wsUrl: page.webSocketDebuggerUrl };
    } catch { /* まだ起動中 */ }
    await sleep(100);
  }
  child.kill("SIGKILL");
  throw new Error(`${CHROME} の DevTools エンドポイントに接続できませんでした`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", (e) => rej(new Error("ws error " + e.message)));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = msg.id && pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
    else slot.resolve(msg.result);
  });
  const send = async (method, params = {}) => {
    await ready;
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error("CDP timeout: " + method));
      }, 120000);
    });
  };
  return { ws, send };
}

async function evalJs(send, expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("page exception: " + (d.exception?.description ?? JSON.stringify(d)));
  }
  return r.result.value;
}

const setViewport = (send, width, height) =>
  send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });

async function openHarness(send, url) {
  await send("Page.navigate", { url });
  for (let i = 0; i < 120; i++) {
    await sleep(150);
    const ok = await evalJs(
      send,
      `!!document.getElementById("easysmarky-host")?.shadowRoot?.querySelector(".es-list-item, .es-form-layout")`,
      false,
    );
    if (ok) return;
  }
  throw new Error("オーバーレイが起動しませんでした: " + url);
}

async function screenshot(send, name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT_DIR, name), Buffer.from(data, "base64"));
}

// ---------------------------------------------------------------- アサーション
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
}

function assertAll(label, r) {
  const s = r.steps;

  if (s.initial.twoPaneMediaQuery) {
    check(`${label}: 2カラムでタブが隠れている`, s.initial.tabsDisplay === "none", s.initial.tabsDisplay);
    check(`${label}: 問題・フォームの両ペインが表示されている`,
      s.initial.questionPaneDisplay !== "none" && s.initial.formPaneDisplay !== "none",
      `${s.initial.questionPaneDisplay}/${s.initial.formPaneDisplay}`);
    check(`${label}: 初期表示で既存下書きのプレビューが描画される`,
      s.initial.field1.display === "block", s.initial.field1);
  } else {
    check(`${label}: タブが表示され「問題」から始まる`,
      s.initial.tabsDisplay === "flex" && s.initial.dataPane === "question",
      `${s.initial.tabsDisplay}/${s.initial.dataPane}`);
    // 最重要: フォームが display:none で始まるため、既存下書きのプレビューを描くのは
    // 「解答」タブを押したときの ResizeObserver 発火だけになる。
    // ここが落ちると、下書きを再開したスマホユーザーはプレビューが永久に空になる。
    check(`${label}: 「解答」タブでプレビューが描画される(ResizeObserver経由)`,
      s.afterFormTab.field1.display === "block" && parseFloat(s.afterFormTab.field1.width) > 0,
      s.afterFormTab);
  }

  check(`${label}: 幅変更でスケールが再計算される`, s.resize.rescaledCorrectly === true,
    { png: [s.resize.pngWidthBefore, s.resize.pngWidthAfterShrink, s.resize.pngWidthAfterRestore] });
  check(`${label}: ResizeObserverが無限ループしない`,
    s.resize.mutationCallbacksAt400ms === s.resize.mutationCallbacksAt1300ms,
    `${s.resize.mutationCallbacksAt400ms} -> ${s.resize.mutationCallbacksAt1300ms}`);
  check(`${label}: 入力したテキストのプレビューが出る`,
    s.typed.field2.display === "block" && parseFloat(s.typed.field2.width) > 0, s.typed.field2);
  check(`${label}: 下書き保存が再取得照合まで通る`,
    s.save.postCount === 1 && s.save.status.includes("反映を確認"), s.save.status);
  check(`${label}: 背景ページのスクロールがロックされる`,
    s.scrollLock.html === "hidden" && s.scrollLock.body === "hidden", s.scrollLock);
}

// ---------------------------------------------------------------- 実行
await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });

const { server, port: httpPort } = await startServer();
const URL_HARNESS = `http://127.0.0.1:${httpPort}/tools/verify/harness.html`;
const { child, wsUrl } = await launchChrome(9333 + (process.pid % 500));
const { send } = connect(wsUrl);

try {
  await send("Page.enable");
  await send("Runtime.enable");

  for (const [label, w, h] of [["スマホ(430px)", 430, 900], ["PC(1400px)", 1400, 900]]) {
    await setViewport(send, w, h);
    await openHarness(send, URL_HARNESS);
    assertAll(label, await evalJs(send, "window.__esAssert()"));
  }

  // 目視確認用のスクリーンショット
  await setViewport(send, 1400, 900);
  await openHarness(send, URL_HARNESS);
  await evalJs(send, `window.__esView("question")`);
  await screenshot(send, "desktop.png");

  await setViewport(send, 430, 900);
  await openHarness(send, URL_HARNESS);
  await evalJs(send, `window.__esView("question")`);
  await screenshot(send, "mobile-question.png");
  await evalJs(send, `window.__esView("form")`);
  await screenshot(send, "mobile-form.png");
} catch (e) {
  check("実行が最後まで完了する", false, String(e && e.stack || e));
} finally {
  // 終了を待たずにプロファイルを消すと、Chromium の書き込みと競合して ENOTEMPTY になる
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGKILL");
  await Promise.race([exited, sleep(5000)]);
  server.close();
  await rm(PROFILE, { recursive: true, force: true }).catch(() => {
    /* 消せなくても out/ は gitignore 済みなので無視する */
  });
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.ok) console.log("      " + JSON.stringify(c.detail));
}
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
console.log(`screenshots: ${OUT_DIR}`);
process.exit(failed.length ? 1 : 0);
