#!/usr/bin/env node
// audit-debt: profile-driven tech-debt scan for repository audits.
//
// Reads .audit/profile.json (audit-init), runs stack-relevant checks,
// writes .audit/reports/debt.json.
//
// Usage (from anywhere inside a git repo):
//   node <SKILL_DIR>/scripts/run-audit.mjs
//   node <SKILL_DIR>/scripts/run-audit.mjs --json
//   node <SKILL_DIR>/scripts/run-audit.mjs --dry-run
//   node <SKILL_DIR>/scripts/run-audit.mjs --explain
//   node <SKILL_DIR>/scripts/run-audit.mjs --offline   # skip npm (deprecated list only)
//   node <SKILL_DIR>/scripts/run-audit.mjs --verbose  # include checksSkipped in report (debug)

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';

import { loadProfile } from './load-profile.mjs';
import { evalWhen } from './eval-when.mjs';
import { computeScore, grade } from './compute-score.mjs';
import { CHECK_RUNNERS } from './checks/index.mjs';
import { loadStackMarkers, indexDeprecatedList } from './checks/stack-tools.mjs';
import { GENERATED_BY } from '../../_shared/generated-by.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');

const flags = new Set(argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
const jsonOut = flags.has('json');
const dryRun = flags.has('dry-run');
const explain = flags.has('explain');
const offline = flags.has('offline');
const verbose = flags.has('verbose');

const checkRegistry = JSON.parse(readFileSync(join(assetsDir, 'check-registry.json'), 'utf8'));
const skillRegistry = JSON.parse(readFileSync(join(assetsDir, 'skill-registry.json'), 'utf8'));

const deprecatedRaw = JSON.parse(
    readFileSync(join(assetsDir, 'deprecated-packages.json'), 'utf8'),
);

const assets = {
    referenceVersions: JSON.parse(readFileSync(join(assetsDir, 'reference-versions.json'), 'utf8')),
    cursorRulesConfig: JSON.parse(readFileSync(join(assetsDir, 'cursor-rules-criteria.json'), 'utf8')),
    segmentWeights: JSON.parse(readFileSync(join(assetsDir, 'segment-weights.json'), 'utf8')),
    stackMarkers: loadStackMarkers(),
    deprecatedList: indexDeprecatedList(deprecatedRaw),
    offline,
};

const c = (s, code) => (process.stdout.isTTY ? `\u001b[${code}m${s}\u001b[0m` : s);
const RED = '31',
    YEL = '33',
    GRN = '32',
    DIM = '90',
    BLD = '1',
    CYAN = '36';

let repoRoot;
let profile;
let profilePath;

try {
    ({ repoRoot, profile, profilePath } = loadProfile());
} catch (e) {
    console.error(e.message);
    exit(1);
}

main().catch((e) => {
    console.error(e.message || e);
    exit(1);
});

async function main() {
    process.chdir(repoRoot);

    /** @type {string[]} */
    const checksRun = [];
    /** @type {Array<{ id: string, reason: string }>} */
    const checksSkipped = [];
    /** @type {Array<Record<string, unknown>>} */
    const findings = [];

    const evalCtx = { profile, repoRoot };
    const checkCtx = { profile, repoRoot, assets };

    for (const entry of checkRegistry.checks) {
        const enabled = evalWhen(entry.when, evalCtx);
        if (!enabled) {
            checksSkipped.push({ id: entry.id, reason: 'profile condition not met' });
            continue;
        }

        const runner = CHECK_RUNNERS[entry.id];
        if (!runner) {
            checksSkipped.push({ id: entry.id, reason: 'no runner registered' });
            continue;
        }

        checksRun.push(entry.id);
        let batch = runner(checkCtx);
        if (batch && typeof batch.then === 'function') batch = await batch;
        for (const f of batch) {
            findings.push({
                ...f,
                category: f.category ?? entry.category,
            });
        }
    }

    findings.sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        const ca = order[a.criticality] ?? 5;
        const cb = order[b.criticality] ?? 5;
        if (ca !== cb) return ca - cb;
        return String(a.id).localeCompare(String(b.id));
    });

    const scoreResult = computeScore(findings);
    const g = grade(scoreResult.score);
    const recommendations = buildRecommendations(findings, skillRegistry);

    const report = {
        version: 1,
        generatedAt: new Date().toISOString(),
        generatedBy: GENERATED_BY,
        profile: {
            version: profile.version,
            generatedAt: profile.generatedAt,
            repoName: profile.repo.name,
        },
        scoring: {
            perMajorBehind: assets.segmentWeights.penalties.perMajorBehind,
            perMinorBehind: assets.segmentWeights.penalties.perMinorBehind,
            deprecated: assets.segmentWeights.penalties.deprecated,
            offline,
        },
        score: {
            value: scoreResult.score,
            grade: g.letter,
            label: g.label,
            totalPenalty: scoreResult.totalPenalty,
        },
        checksRun,
        findings,
        recommendations,
    };

    if (verbose && checksSkipped.length) {
        report.checksSkipped = checksSkipped;
    }

    const reportPath = join(repoRoot, '.audit/reports/debt.json');

    if (!dryRun) {
        const reportsDir = join(repoRoot, '.audit/reports');
        if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    if (jsonOut) {
        console.log(JSON.stringify({ report, reportPath: dryRun ? null : reportPath }, null, 2));
        exit(scoreResult.score < 40 ? 2 : 0);
    }

    printHumanReport(report, profilePath, reportPath);
    if (explain) printExplain(scoreResult);

    exit(scoreResult.score < 40 ? 2 : 0);
}

// ------- helpers -------

function lookupRegistry(id, registry) {
    if (registry.findings[id]) return registry.findings[id];
    const prefix = id.includes(':') ? id.split(':')[0] : null;
    if (prefix && registry.findings[prefix]) return registry.findings[prefix];
    return null;
}

function buildRecommendations(findingsList, registry) {
    const seen = new Set();
    /** @type {Array<Record<string, unknown>>} */
    const recs = [];

    for (const f of findingsList) {
        const baseId = String(f.id).split(':')[0];
        if (seen.has(f.id)) continue;
        seen.add(f.id);

        const reg = lookupRegistry(String(f.id), registry) ?? lookupRegistry(baseId, registry);
        if (!reg) continue;

        recs.push({
            findingId: f.id,
            criticality: f.criticality,
            rationale: reg.rationale,
            skill: reg.skill ?? null,
            manualSteps: reg.manualSteps,
        });
    }

    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    recs.sort((a, b) => (order[a.criticality] ?? 5) - (order[b.criticality] ?? 5));
    return recs;
}

function printHumanReport(report, profPath, outPath) {
    const COLOR_BY_CRIT = { critical: RED, high: RED, medium: YEL, low: DIM, info: DIM };

    console.log(c('━━━ Audit debt scan ━━━', BLD));
    console.log(`Repo: ${repoRoot}`);
    console.log(`Profile: ${profPath} (v${report.profile.version}, ${report.profile.generatedAt})`);
    console.log(
        c(
            `Scoring: −${assets.segmentWeights.penalties.perMajorBehind}/major, −${assets.segmentWeights.penalties.perMinorBehind}/minor (× segment weight); deprecated −${assets.segmentWeights.penalties.deprecated}${offline ? '; offline' : '; npm registry'}`,
            DIM,
        ),
    );

    const scoreColor =
        report.score.value >= 75 ? GRN : report.score.value >= 40 ? YEL : RED;
    console.log(
        `\n${c('Freshness score:', BLD)} ${c(`${report.score.value}/100`, scoreColor)}  (${report.score.grade} — ${report.score.label})`,
    );
    console.log(c(`  total penalty: -${report.score.totalPenalty}`, DIM));

    console.log(`\n${c('Checks run:', BLD)} ${report.checksRun.join(', ') || '(none)'}`);

    console.log(`\n${c('━━━ Findings ━━━', BLD)}`);
    if (!report.findings.length) {
        console.log(c('  No debt findings for the current stack profile.', GRN));
    } else {
        for (const f of report.findings) {
            const col = COLOR_BY_CRIT[f.criticality] || DIM;
            const tag = `[${String(f.criticality).toUpperCase()}]`;
            console.log(
                `  ${c(tag, col)} ${c(String(f.id), BLD)}  (-${f.penalty})  [${f.checkId}]`,
            );
            console.log(`      ${f.message}`);
            if (f.current && f.target) {
                console.log(c(`      current: ${f.current}  →  target: ${f.target}`, DIM));
            }
            if (f.detail?.failedFiles) {
                for (const file of f.detail.failedFiles.slice(0, 8)) {
                    console.log(c(`        • ${file}`, DIM));
                }
            }
        }
    }

    console.log(`\n${c('━━━ Upgrade plan (profile-aware) ━━━', BLD)}`);
    if (!report.recommendations.length) {
        console.log(c('  No routed recommendations.', GRN));
    } else {
        report.recommendations.forEach((r, i) => {
            const col = COLOR_BY_CRIT[r.criticality] || DIM;
            console.log(`\n  ${i + 1}. ${c(`[${String(r.criticality).toUpperCase()}]`, col)} ${r.findingId}`);
            console.log(c(`      why: ${r.rationale}`, DIM));
            if (r.skill) {
                console.log(`      skill: ${c(String(r.skill), CYAN)}`);
            }
            if (r.manualSteps) {
                for (const s of r.manualSteps) console.log(c(`        • ${s}`, DIM));
            }
        });
    }

    if (dryRun) {
        console.log(c('\n(dry-run: report not written)', YEL));
    } else {
        console.log(`\nReport: ${outPath}`);
    }
    if (report.scoring?.offline) {
        console.log(c('\nOffline mode: npm version checks skipped.', YEL));
    }
    if (verbose && report.checksSkipped?.length) {
        console.log(c('\n(debug) Checks not run for this profile:', DIM));
        for (const s of report.checksSkipped) {
            console.log(c(`  • ${s.id}: ${s.reason}`, DIM));
        }
    }
    console.log(c('\nRe-run with --json, --dry-run, --offline, --explain, or --verbose.', DIM));
}

function printExplain(scoreResult) {
    console.log(`\n${c('━━━ Scoring breakdown ━━━', BLD)}`);
    console.log(c('  Formula: score = max(0, 100 - sum(penalties))', DIM));
    for (const b of scoreResult.breakdown) {
        console.log(`  -${String(b.penalty).padStart(2)}  ${b.id}  (${b.criticality})`);
    }
    console.log(
        c(`  =====  total: -${scoreResult.totalPenalty}  →  final: ${scoreResult.score}/100`, BLD),
    );
}
