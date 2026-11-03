/** Minimal numeric semver comparison for the forced-update check (F-PLT-02). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function parseVersion(v: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!match) throw new RangeError(`Invalid version: ${v}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isUpdateRequired(current: string, minSupported: string): boolean {
  return compareVersions(current, minSupported) < 0;
}
