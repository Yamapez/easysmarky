import { fetchLatestVersion } from "./fetchLatestVersion";
import { compareVersions } from "./version";
import { getDismissedVersion, getLastCheckedAt, markChecked } from "../storage/updateState";

/** 通知頻度を抑えるためのクールダウン。オフライン時の連続リトライも抑止する */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6時間

/**
 * 通知すべき新バージョンがあればそのバージョン文字列を返す。無ければ null。
 * 例外は投げない(fetch失敗・パース失敗・localStorage不可などは全て null 扱い)。
 */
export async function checkForUpdate(currentVersion: string): Promise<string | null> {
  try {
    const now = Date.now();
    if (now - getLastCheckedAt() < CHECK_INTERVAL_MS) return null;

    // fetch失敗時も次回まで再試行しないよう、結果を待たず先に記録する
    markChecked(now);

    const latest = await fetchLatestVersion();
    if (!latest) return null;

    const cmp = compareVersions(latest, currentVersion);
    if (cmp === null || cmp <= 0) return null;

    if (getDismissedVersion() === latest) return null;

    return latest;
  } catch {
    return null;
  }
}
