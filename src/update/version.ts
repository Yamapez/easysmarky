/** "0.6.0" のような x.y.z のみを対象にした軽量パーサ。解析できない場合は null */
export function parseVersion(raw: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * a と b を比較する。a > b なら正、a < b なら負、等しければ 0。
 * どちらかが解析不能なら null(呼び出し側は「比較不能=通知しない」として扱うこと)
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
