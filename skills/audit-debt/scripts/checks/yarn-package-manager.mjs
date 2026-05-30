import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const SUMMARY_RE = /(\d+) packages can be deduped using the highest strategy/;

const dedupeTier = (count) => {
    if (count <= 50) return { penalty: 0, criticality: null };
    if (count <= 100) return { penalty: 1, criticality: 'low' };
    if (count <= 200) return { penalty: 2, criticality: 'medium' };
    if (count <= 500) return { penalty: 3, criticality: 'high' };
    return { penalty: 4, criticality: 'high' };
};

const looseMajor = (raw) => {
    if (typeof raw !== 'string') return null;
    const m = raw.match(/(\d+)/);
    return m ? Number(m[1]) : null;
};

/**
 * @param {import('./types.mjs').CheckContext} ctx
 */
export function runYarnPackageManagerCheck(ctx) {
    const findings = [];
    const pm = ctx.profile.stack?.packageManager;
    if (pm?.name !== 'yarn') return findings;

    const yarnRef = ctx.assets.referenceVersions.runtimes.yarn;
    const major = looseMajor(pm.version ?? '');

    if (major === 1) {
        findings.push({
            id: 'yarn_classic',
            checkId: 'yarn_package_manager',
            category: 'package-manager',
            current: pm.version ?? 'Yarn 1',
            target: `Yarn ${yarnRef.currentMajor}`,
            penalty: 10,
            criticality: 'high',
            message: 'Yarn 1 (Classic) is unmaintained; migrate to Yarn Berry.',
        });
        return findings;
    }

    if (major != null && major >= 2 && major < yarnRef.currentMajor) {
        findings.push({
            id: 'yarn_berry_pre_v4',
            checkId: 'yarn_package_manager',
            category: 'package-manager',
            current: pm.version ?? `Yarn ${major}`,
            target: `Yarn ${yarnRef.currentMajor}`,
            penalty: major === 2 ? 2 : 1,
            criticality: 'medium',
            message: `Yarn ${major} is behind current Berry (${yarnRef.currentMajor}).`,
        });
    }

    if (major != null && major >= 2 && existsSync(join(ctx.repoRoot, 'yarn.lock'))) {
        const dedupe = runYarnDedupeCheck(ctx.repoRoot);
        if (dedupe.count != null && dedupe.count > 0) {
            const tier = dedupeTier(dedupe.count);
            if (tier.penalty > 0 && tier.criticality) {
                findings.push({
                    id: 'yarn_dedupe_opportunity',
                    checkId: 'yarn_package_manager',
                    category: 'package-manager',
                    current: `${dedupe.count} dedupeable packages`,
                    target: '0 after yarn dedupe --check',
                    penalty: tier.penalty,
                    criticality: tier.criticality,
                    message: 'yarn.lock has packages Yarn can collapse to a single resolved version.',
                    detail: {
                        fixCommand: 'yarn dedupe --strategy highest',
                        verifyCommand: 'yarn dedupe --check',
                    },
                });
            }
        }
    }

    return findings;
}

function runYarnDedupeCheck(repoRoot) {
    try {
        const output = execSync('yarn dedupe --check', {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120_000,
            maxBuffer: 16 * 1024 * 1024,
        });
        const match = output.match(SUMMARY_RE);
        return { count: match ? Number(match[1]) : 0 };
    } catch (err) {
        const combined = `${err.stdout?.toString?.() ?? ''}\n${err.stderr?.toString?.() ?? ''}`;
        const match = combined.match(SUMMARY_RE);
        if (match) return { count: Number(match[1]) };
        return { count: null, skipped: true };
    }
}
