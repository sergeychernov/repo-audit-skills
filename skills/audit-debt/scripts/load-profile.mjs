#!/usr/bin/env node
// Loads .audit/profile.json from the target git repo.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const PROFILE_PATH = '.audit/profile.json';

/**
 * @returns {{ repoRoot: string, profile: object, profilePath: string }}
 */
export function loadProfile() {
    let repoRoot;
    try {
        repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    } catch {
        throw new Error('Not a git repository. Run inside a project repo.');
    }

    const profilePath = join(repoRoot, PROFILE_PATH);
    if (!existsSync(profilePath)) {
        throw new Error(
            `Missing ${PROFILE_PATH}. Run audit-init first:\n` +
                '  node <SKILL_DIR>/audit-init/scripts/detect-stack.mjs',
        );
    }

    let profile;
    try {
        profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    } catch (e) {
        throw new Error(`Invalid ${PROFILE_PATH}: ${e.message}`);
    }

    if (!profile.version || !profile.repo?.root) {
        throw new Error(`${PROFILE_PATH} is incomplete — re-run audit-init with --force.`);
    }

    return { repoRoot, profile, profilePath };
}
