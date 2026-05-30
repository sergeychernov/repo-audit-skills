#!/usr/bin/env node
// Freshness score for audit-debt (same formula as tech-debt).

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

export function penalize(finding) {
    const p = Number(finding.penalty) || 0;
    return p < 0 ? 0 : p;
}

export function computeScore(findings) {
    const total = findings.reduce((acc, f) => acc + penalize(f), 0);
    const raw = 100 - total;
    const score = Math.max(0, Math.min(100, Math.round(raw)));
    return {
        score,
        rawScore: raw,
        totalPenalty: total,
        breakdown: findings.map((f) => ({
            id: f.id,
            penalty: penalize(f),
            criticality: f.criticality || 'low',
        })),
    };
}

export function grade(score) {
    if (score >= 90) return { letter: 'A', label: 'fresh' };
    if (score >= 75) return { letter: 'B', label: 'mostly current' };
    if (score >= 60) return { letter: 'C', label: 'aging' };
    if (score >= 40) return { letter: 'D', label: 'stale' };
    if (score >= 20) return { letter: 'E', label: 'legacy' };
    return { letter: 'F', label: 'critical tech debt' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = Object.fromEntries(
        argv.slice(2).reduce((acc, cur, i, arr) => {
            if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] ?? true]);
            return acc;
        }, []),
    );
    const path = args.findings;
    if (!path || path === true) {
        console.error('Usage: compute-score.mjs --findings <path-to-json>');
        process.exit(1);
    }
    const findings = JSON.parse(readFileSync(path, 'utf8'));
    const result = computeScore(findings);
    const g = grade(result.score);
    console.log(JSON.stringify({ ...result, grade: g }, null, 2));
}
