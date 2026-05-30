/**
 * @param {string | null | undefined} raw
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseSemverParts(raw) {
    if (raw == null) return null;
    const m = String(raw)
        .trim()
        .replace(/^v/i, '')
        .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) return null;
    return {
        major: Number(m[1]),
        minor: m[2] != null ? Number(m[2]) : 0,
        patch: m[3] != null ? Number(m[3]) : 0,
    };
}

/**
 * Lowest installed version among profile values (conservative for debt scoring).
 * @param {Array<string | null>} versions
 * @returns {{ parts: { major: number, minor: number, patch: number }, raw: string } | null}
 */
export function lowestInstalledVersion(versions) {
    if (!Array.isArray(versions) || !versions.length) return null;

    let best = null;
    for (const v of versions) {
        if (v == null) continue;
        const parts = parseSemverParts(v);
        if (!parts) continue;
        if (
            !best ||
            parts.major < best.parts.major ||
            (parts.major === best.parts.major && parts.minor < best.parts.minor) ||
            (parts.major === best.parts.major &&
                parts.minor === best.parts.minor &&
                parts.patch < best.parts.patch)
        ) {
            best = { parts, raw: String(v) };
        }
    }
    return best;
}

/**
 * @param {{ major: number, minor: number }} installed
 * @param {{ major: number, minor: number }} latest
 */
export function versionLag(installed, latest) {
    const majorBehind = Math.max(0, latest.major - installed.major);
    const minorBehind =
        majorBehind === 0 ? Math.max(0, latest.minor - installed.minor) : 0;
    return { majorBehind, minorBehind };
}

/**
 * @param {number} majorBehind
 * @param {number} minorBehind
 */
export function criticalityForLag(majorBehind, minorBehind) {
    if (majorBehind >= 2) return 'high';
    if (majorBehind === 1) return 'medium';
    if (minorBehind > 0) return 'low';
    return 'info';
}
