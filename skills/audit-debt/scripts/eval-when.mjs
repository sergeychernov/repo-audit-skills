#!/usr/bin/env node
// Evaluates check-registry "when" clauses against .audit/profile.json.

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * @param {unknown} clause
 * @param {{ profile: object, repoRoot: string }} ctx
 * @returns {boolean}
 */
export function evalWhen(clause, ctx) {
    if (!clause || typeof clause !== 'object') return false;

    if (clause.always === true) return true;

    if (clause.has && typeof clause.has === 'string') {
        return getPath(ctx.profile, clause.has) != null;
    }

    if (clause.packageManager && typeof clause.packageManager === 'string') {
        return ctx.profile.stack?.packageManager?.name === clause.packageManager;
    }

    if (clause.hasStackToolItems === true) {
        const sections = [
            'frameworks',
            'bundlers',
            'testRunners',
            'uiLibraries',
            'componentCatalogs',
            'formLibraries',
            'linters',
            'databases',
        ];
        for (const key of sections) {
            const block = ctx.profile.stack?.[key];
            if (block && typeof block === 'object' && Object.keys(block).length > 0) {
                return true;
            }
        }
        return false;
    }

    if (clause.agentSignal && typeof clause.agentSignal === 'object') {
        const { agent, signal } = clause.agentSignal;
        const entry = ctx.profile.agentTooling?.[agent];
        if (!entry?.signals) return false;
        return entry.signals.includes(signal);
    }

    if (clause.gitTrackedPrefix && typeof clause.gitTrackedPrefix === 'string') {
        return hasGitTrackedPrefix(ctx.repoRoot, clause.gitTrackedPrefix);
    }

    if (Array.isArray(clause.or)) {
        return clause.or.some((c) => evalWhen(c, ctx));
    }

    if (Array.isArray(clause.and)) {
        return clause.and.every((c) => evalWhen(c, ctx));
    }

    return false;
}

/**
 * @param {object} obj
 * @param {string} path dot-separated
 */
function getPath(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return null;
        cur = cur[p];
    }
    return cur ?? null;
}

function hasGitTrackedPrefix(repoRoot, prefix) {
    const quoted = prefix.replace(/'/g, "'\\''");
    try {
        const out = execSync(`git ls-files '${quoted}' '${quoted}**'`, {
            encoding: 'utf8',
            cwd: repoRoot,
        }).trim();
        if (out) return true;
    } catch {
        /* fall through */
    }
    return existsSync(join(repoRoot, prefix));
}
