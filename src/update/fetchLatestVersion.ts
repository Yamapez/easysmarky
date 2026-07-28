const REMOTE_USERSCRIPT_URL = "https://yamapez.github.io/easysmarky/easysmarky.user.js";
const FETCH_TIMEOUT_MS = 5000;

/** GitHub Pages上の最新 easysmarky.user.js の @version を取得する。失敗時は null(例外を投げない) */
export async function fetchLatestVersion(): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REMOTE_USERSCRIPT_URL, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = await res.text();
    const header = /==UserScript==([\s\S]*?)==\/UserScript==/.exec(text);
    if (!header) return null;
    const version = /@version\s+(\S+)/.exec(header[1]);
    return version ? version[1] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
