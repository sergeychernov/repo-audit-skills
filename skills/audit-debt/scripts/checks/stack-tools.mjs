import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    fetchNpmLatest,
    fetchNpmVersionDeprecated,
    primaryNpmPackage,
    packagesFromMarker,
} from '../npm-registry.mjs';
import {
    parseSemverParts,
    lowestInstalledVersion,
    versionLag,
    criticalityForLag,
} from '../semver-utils.mjs';

const STACK_SEGMENTS = [
    'frameworks',
    'bundlers',
    'testRunners',
    'uiLibraries',
    'componentCatalogs',
    'formLibraries',
    'linters',
    'databases',
];

const here = dirname(fileURLToPath(import.meta.url));
const stackMarkersPath = join(here, '../../../audit-init/assets/stack-markers.json');

/**
 * @param {{ profile: object, repoRoot: string, assets: object }} ctx
 */
export async function runStackToolsCheck(ctx) {
    const findings = [];
    const { segmentWeights, stackMarkers, deprecatedList, offline } = ctx.assets;

    const penalties = segmentWeights.penalties;
    const segmentConfig = segmentWeights.segments;

    for (const segment of STACK_SEGMENTS) {
        const segCfg = segmentConfig[segment];
        const weight = segCfg?.weight ?? 1;
        if (weight <= 0) continue;

        const section = ctx.profile.stack?.[segment];
        if (!section || typeof section !== 'object') continue;

        const markersSection = stackMarkers[segment];
        if (!markersSection) continue;

        for (const [stackItemId, versions] of Object.entries(section)) {
            const marker = markersSection[stackItemId];
            if (!marker) continue;

            const bundledFindings = checkBundledDeprecated({
                segment,
                stackItemId,
                versions,
                marker,
                weight,
                penalties,
                deprecatedList,
            });
            findings.push(...bundledFindings);

            if (offline) continue;

            const npmPkg = primaryNpmPackage(marker);
            if (!npmPkg) continue;

            const installed = lowestInstalledVersion(versions);
            if (!installed) continue;

            const npmDeprecated = await fetchNpmVersionDeprecated(npmPkg, installed.raw);
            if (npmDeprecated.deprecated) {
                findings.push(
                    makeFinding({
                        id: `stack_deprecated_npm:${segment}:${stackItemId}`,
                        segment,
                        stackItemId,
                        packageName: npmPkg,
                        penalty: roundPenalty(penalties.deprecated * weight),
                        criticality: 'high',
                        message: `npm marks ${npmPkg}@${installed.raw} as deprecated: ${npmDeprecated.deprecated}`,
                        current: `${npmPkg}@${installed.raw}`,
                        target: 'non-deprecated release',
                        detail: {
                            source: 'npm-registry',
                            deprecatedMessage: npmDeprecated.deprecated,
                        },
                    }),
                );
            }

            const latestRes = await fetchNpmLatest(npmPkg);
            if (latestRes.error || !latestRes.latest) {
                findings.push(
                    makeFinding({
                        id: `stack_npm_error:${segment}:${stackItemId}`,
                        segment,
                        stackItemId,
                        packageName: npmPkg,
                        penalty: 0,
                        criticality: 'info',
                        message: `Could not resolve latest version for ${npmPkg}: ${latestRes.error ?? 'unknown'}`,
                        current: installed.raw,
                        detail: { source: 'npm-registry', error: latestRes.error },
                    }),
                );
                continue;
            }

            const latestParts = parseSemverParts(latestRes.latest);
            if (!latestParts) continue;

            const lag = versionLag(installed.parts, latestParts);
            if (lag.majorBehind === 0 && lag.minorBehind === 0) continue;

            const basePenalty =
                penalties.perMajorBehind * lag.majorBehind +
                penalties.perMinorBehind * lag.minorBehind;
            const penalty = roundPenalty(basePenalty * weight);

            findings.push(
                makeFinding({
                    id: `stack_behind:${segment}:${stackItemId}`,
                    segment,
                    stackItemId,
                    packageName: npmPkg,
                    penalty,
                    criticality: criticalityForLag(lag.majorBehind, lag.minorBehind),
                    message: `${stackItemId} (${npmPkg}) is ${lag.majorBehind} major(s) and ${lag.minorBehind} minor(s) behind npm latest ${latestRes.latest}.`,
                    current: `${npmPkg}@${installed.raw}`,
                    target: `${npmPkg}@${latestRes.latest}`,
                    detail: {
                        source: 'npm-registry',
                        majorBehind: lag.majorBehind,
                        minorBehind: lag.minorBehind,
                        basePenalty,
                        segmentWeight: weight,
                        latest: latestRes.latest,
                    },
                }),
            );
        }
    }

    return findings;
}

function roundPenalty(n) {
    return Math.round(n * 10) / 10;
}

function makeFinding(fields) {
    return {
        checkId: 'stack_tools',
        category: 'tooling',
        ...fields,
    };
}

/**
 * @param {object} opts
 */
function checkBundledDeprecated(opts) {
    const { segment, stackItemId, versions, marker, weight, penalties, deprecatedList } =
        opts;
    const findings = [];
    const packages = packagesFromMarker(marker);
    const installed = lowestInstalledVersion(versions);

    for (const pkg of packages) {
        const entry = findDeprecatedEntry(pkg, deprecatedList);
        if (!entry) continue;

        if (entry.minMajor != null) {
            if (!installed) continue;
            if (installed.parts.major > entry.minMajor) continue;
            if (
                installed.parts.major === entry.minMajor &&
                entry.minMinor != null &&
                installed.parts.minor >= entry.minMinor
            ) {
                continue;
            }
        }

        findings.push(
            makeFinding({
                id: `stack_deprecated_list:${segment}:${stackItemId}:${pkg}`,
                segment,
                stackItemId,
                packageName: pkg,
                penalty: roundPenalty(penalties.deprecated * weight),
                criticality: 'high',
                message: entry.reason,
                current: installed ? `${pkg}@${installed.raw}` : pkg,
                target: entry.replacement ?? 'maintained alternative',
                detail: {
                    source: 'deprecated-packages.json',
                    replacement: entry.replacement,
                },
            }),
        );
    }

    return findings;
}

/**
 * @param {string} path
 */
export function loadStackMarkers(path = stackMarkersPath) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

export function indexDeprecatedList(list) {
    const byName = new Map();
    for (const entry of list.packages ?? []) {
        byName.set(entry.name, entry);
    }
    return { byName, raw: list };
}

function findDeprecatedEntry(pkg, deprecatedList) {
    if (deprecatedList.byName.has(pkg)) return deprecatedList.byName.get(pkg);
    for (const entry of deprecatedList.raw.packages ?? []) {
        if (entry.name.startsWith(`${pkg}@`)) return entry;
    }
    return null;
}
