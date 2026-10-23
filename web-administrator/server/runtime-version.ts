/* Fail closed even when npm's advisory engines check is bypassed (direct Node
 * invocation and packaged deployments). Keep aligned with package.json engines.
 */
export function assertSupportedNodeVersion(version: string = process.versions.node): void {
    const match = /^(22|24|26)\.(\d+)\.(\d+)$/.exec(version);
    const minimums: Record<number, [number, number]> = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };
    if (match) {
        const [, major, minor, patch] = match.map(Number);
        const [minMinor, minPatch] = minimums[major];
        if (minor > minMinor || (minor === minMinor && patch >= minPatch)) return;
    }
    throw new Error(`Unsupported Node.js ${version}. CVE-2026-111497 requires Node.js 22.23.4+ (22.x), 24.22.1+ (24.x), or 26.12.1+ (26.x). Upgrade Node.js and restart.`);
}
