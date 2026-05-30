#!/usr/bin/env node
// Scans .cursor/rules/ for presence and formal quality criteria.
// Read-only. No network calls. No external deps.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';

const RULES_DIR = '.cursor/rules';

/**
 * @param {string} repoRoot
 * @param {{ missingRulesPenalty: number, maxLinesPerRule: number, minBodyLines: number, criteria: Array<{ id: string, label: string, message: string }> }} config
 * @returns {Array<Record<string, unknown>>}
 */
export function scanCursorRules(repoRoot, config) {
    const findings = [];
    const rulesPath = join(repoRoot, RULES_DIR);

    const mdcFiles = listMdcFiles(repoRoot, rulesPath);
    if (!existsSync(rulesPath) || mdcFiles.length === 0) {
        findings.push({
            id: 'cursor_rules_missing',
            category: 'cursor-rules',
            current: existsSync(rulesPath) ? '(no .mdc files)' : '(no .cursor/rules/)',
            target: '≥1 .mdc rule in .cursor/rules/',
            penalty: config.missingRulesPenalty,
            criticality: 'critical',
            message:
                'No Cursor rules — agents lack project-specific guidance. Create .cursor/rules/ first.',
        });
        return findings;
    }

    const rules = mdcFiles.map((relPath) => parseRule(relPath, join(repoRoot, relPath)));

    const fail = (criterionId, criterion, failedFiles, extra = {}) => {
        findings.push({
            id: `cursor_rules_criterion:${criterionId}`,
            category: 'cursor-rules',
            current: `${failedFiles.length} violation(s)`,
            target: criterion.label,
            penalty: 1,
            criticality: 'low',
            message: criterion.message,
            detail: { criterionId, failedFiles, ...extra },
        });
    };

    const frontmatterFails = rules.filter((r) => !r.validFrontmatter).map((r) => r.path);
    if (frontmatterFails.length) {
        fail('frontmatter', byId(config, 'frontmatter'), frontmatterFails);
    }

    const withFm = rules.filter((r) => r.validFrontmatter);

    const descriptionFails = withFm.filter((r) => !r.description?.trim()).map((r) => r.path);
    if (descriptionFails.length) {
        fail('description', byId(config, 'description'), descriptionFails);
    }

    const scopeFails = withFm
        .filter((r) => r.alwaysApply !== true && r.globs.length === 0)
        .map((r) => r.path);
    if (scopeFails.length) {
        fail('scope', byId(config, 'scope'), scopeFails);
    }

    const bodyMinFails = withFm
        .filter((r) => r.nonEmptyBodyLines < config.minBodyLines)
        .map((r) => r.path);
    if (bodyMinFails.length) {
        fail('body_min', byId(config, 'body_min'), bodyMinFails, {
            requiredLines: config.minBodyLines,
        });
    }

    const hasOverview = withFm.some(
        (r) => r.alwaysApply === true || r.globs.some((g) => g === '**/*' || g === '**/**'),
    );
    if (!hasOverview) {
        fail('overview', byId(config, 'overview'), ['(repo-wide)']);
    }

    const lengthFails = rules.filter((r) => r.lineCount > config.maxLinesPerRule).map((r) => r.path);
    if (lengthFails.length) {
        fail('length_cap', byId(config, 'length_cap'), lengthFails, {
            maxLines: config.maxLinesPerRule,
        });
    }

    const allTracked = listAllRulesDirFiles(repoRoot);
    const nonMdc = allTracked.filter((f) => !f.endsWith('.mdc'));
    if (nonMdc.length) {
        fail('mdc_only', byId(config, 'mdc_only'), nonMdc);
    }

    const descCounts = new Map();
    for (const r of withFm) {
        const d = r.description?.trim();
        if (!d) continue;
        if (!descCounts.has(d)) descCounts.set(d, []);
        descCounts.get(d).push(r.path);
    }
    const duplicateDescFiles = [...descCounts.values()]
        .filter((paths) => paths.length > 1)
        .flat();
    if (duplicateDescFiles.length) {
        fail('unique_desc', byId(config, 'unique_desc'), duplicateDescFiles);
    }

    return findings;
}

function byId(config, id) {
    return config.criteria.find((c) => c.id === id) ?? { id, label: id, message: id };
}

function listMdcFiles(repoRoot, rulesPath) {
    if (!existsSync(rulesPath)) return [];

    let files = [];
    try {
        files = execSync("git ls-files '.cursor/rules/*.mdc' '.cursor/rules/**/*.mdc'", {
            encoding: 'utf8',
            cwd: repoRoot,
        })
            .split('\n')
            .filter(Boolean);
    } catch {
        files = [];
    }

    if (!files.length) {
        files = walkMdc(rulesPath).map((abs) => relative(repoRoot, abs));
    }

    return [...new Set(files)].sort();
}

function walkMdc(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkMdc(full));
        else if (entry.name.endsWith('.mdc')) out.push(full);
    }
    return out;
}

function listAllRulesDirFiles(repoRoot) {
    try {
        return execSync("git ls-files '.cursor/rules' '.cursor/rules/**'", {
            encoding: 'utf8',
            cwd: repoRoot,
        })
            .split('\n')
            .filter(Boolean);
    } catch {
        if (!existsSync(join(repoRoot, RULES_DIR))) return [];
        return walkAll(join(repoRoot, RULES_DIR)).map((abs) => relative(repoRoot, abs));
    }
}

function walkAll(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkAll(full));
        else out.push(full);
    }
    return out;
}

function parseRule(relPath, absPath) {
    const content = readFileSync(absPath, 'utf8');
    const lineCount = content.split(/\r?\n/).length;
    const parsed = parseFrontmatter(content);

    if (!parsed) {
        return {
            path: relPath,
            validFrontmatter: false,
            description: null,
            alwaysApply: null,
            globs: [],
            nonEmptyBodyLines: 0,
            lineCount,
        };
    }

    const nonEmptyBodyLines = parsed.body
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0).length;

    return {
        path: relPath,
        validFrontmatter: true,
        description: parsed.description,
        alwaysApply: parsed.alwaysApply,
        globs: parsed.globs,
        nonEmptyBodyLines,
        lineCount,
    };
}

function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
    if (!match) return null;

    const yaml = match[1];
    const body = match[2];

    return {
        body,
        description: parseYamlScalar(yaml, 'description'),
        alwaysApply: parseYamlBool(yaml, 'alwaysApply'),
        globs: parseYamlGlobs(yaml),
    };
}

function parseYamlScalar(yaml, key) {
    const m = yaml.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (!m) return null;
    let value = m[1].trim();
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        value = value.slice(1, -1);
    }
    return value;
}

function parseYamlBool(yaml, key) {
    const m = yaml.match(new RegExp(`^${key}:\\s*(true|false)\\s*$`, 'im'));
    if (!m) return null;
    return m[1].toLowerCase() === 'true';
}

function parseYamlGlobs(yaml) {
    const scalar = parseYamlScalar(yaml, 'globs');
    if (scalar) return [scalar];

    const block = yaml.match(/^globs:\s*\[([^\]]*)\]/m);
    if (!block) return [];

    return block[1]
        .split(',')
        .map((part) => part.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
}
