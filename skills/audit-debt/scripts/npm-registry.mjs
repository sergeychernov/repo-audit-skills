#!/usr/bin/env node
// npm registry lookups for audit-debt stack version checks.

const REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 15_000;

/** @type {Map<string, Promise<{ latest: string | null, error?: string }>>} */
const latestCache = new Map();

/** @type {Map<string, Promise<{ deprecated: string | null, error?: string }>>} */
const versionMetaCache = new Map();

function isNpmPackageName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.includes(':')) return false;
    return /^(@[^/]+\/[^/]+|[^@/\s]+)$/.test(name);
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
        });
        if (!res.ok) {
            return { error: `HTTP ${res.status}` };
        }
        return { data: await res.json() };
    } catch (e) {
        const msg = e.name === 'AbortError' ? 'timeout' : e.message;
        return { error: msg };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {string} packageName
 * @returns {Promise<{ latest: string | null, error?: string }>}
 */
export async function fetchNpmLatest(packageName) {
    if (!isNpmPackageName(packageName)) {
        return { latest: null, error: 'not an npm package name' };
    }

    if (latestCache.has(packageName)) return latestCache.get(packageName);

    const promise = (async () => {
        const enc = encodeURIComponent(packageName);
        const { data, error } = await fetchJson(`${REGISTRY}/${enc}`);
        if (error) return { latest: null, error };
        const latest = data?.['dist-tags']?.latest ?? data?.version ?? null;
        if (!latest) return { latest: null, error: 'no latest version in registry' };
        return { latest: String(latest) };
    })();

    latestCache.set(packageName, promise);
    return promise;
}

/**
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<{ deprecated: string | null, error?: string }>}
 */
export async function fetchNpmVersionDeprecated(packageName, version) {
    if (!isNpmPackageName(packageName) || !version) {
        return { deprecated: null, error: 'invalid package or version' };
    }

    const key = `${packageName}@${version}`;
    if (versionMetaCache.has(key)) return versionMetaCache.get(key);

    const promise = (async () => {
        const enc = encodeURIComponent(packageName);
        const { data, error } = await fetchJson(`${REGISTRY}/${enc}`);
        if (error) return { deprecated: null, error };

        const meta = data?.versions?.[version];
        if (!meta) {
            return { deprecated: null, error: `version ${version} not in registry` };
        }
        const dep = meta.deprecated;
        if (dep == null || dep === false) return { deprecated: null };
        return { deprecated: String(dep) };
    })();

    versionMetaCache.set(key, promise);
    return promise;
}

/**
 * First npm-compatible package name from stack-markers entry.
 * @param {unknown} marker
 */
export function primaryNpmPackage(marker) {
    const packages = packagesFromMarker(marker);
    return packages.find((p) => isNpmPackageName(p)) ?? null;
}

/**
 * @param {unknown} marker
 * @returns {string[]}
 */
export function packagesFromMarker(marker) {
    if (Array.isArray(marker)) return marker.filter((p) => typeof p === 'string');
    if (marker && typeof marker === 'object' && Array.isArray(marker.packages)) {
        return marker.packages.filter((p) => typeof p === 'string');
    }
    return [];
}

export { isNpmPackageName };
