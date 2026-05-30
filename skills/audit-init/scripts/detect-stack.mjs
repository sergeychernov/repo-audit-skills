#!/usr/bin/env node
// audit-init: detects the project stack and writes .audit/profile.json
//
// Read-only scan. No network calls. No external deps. Works on Node 18+.
//
// Usage (from anywhere inside a git repo):
//   node <SKILL_DIR>/scripts/detect-stack.mjs
//   node <SKILL_DIR>/scripts/detect-stack.mjs --json
//   node <SKILL_DIR>/scripts/detect-stack.mjs --dry-run

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { argv, exit } from 'node:process';

import { GENERATED_BY } from '../../_shared/generated-by.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, '..', 'assets');
const markers = JSON.parse(readFileSync(join(assetsDir, 'stack-markers.json'), 'utf8'));
const agentMarkers = JSON.parse(readFileSync(join(assetsDir, 'agent-config-markers.json'), 'utf8'));
const contentToolingMarkers = JSON.parse(
    readFileSync(join(assetsDir, 'content-tooling-markers.json'), 'utf8'),
);

const flags = new Set(argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
const jsonOut = flags.has('json');
const dryRun = flags.has('dry-run');
const force = flags.has('force');

const LANG_BY_EXT = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.pyi': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.kts': 'kotlin',
    '.rb': 'ruby',
    '.php': 'php',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.vue': 'vue',
    '.scala': 'scala',
    '.ex': 'elixir',
    '.exs': 'elixir',
    '.erl': 'erlang',
    '.hs': 'haskell',
    '.lua': 'lua',
    '.zig': 'zig',
    '.dart': 'dart',
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.md': 'markdown',
    '.mdx': 'mdx',
};

const CONFIG_EXTS = new Set([
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.txt',
    '.xml',
    '.svg',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.eot',
    '.lock',
    '.sum',
    '.gitignore',
    '.dockerignore',
    '.editorconfig',
    '.prettierrc',
    '.eslintrc',
]);

// ------- repo root -------

let repoRoot;
try {
    repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
} catch {
    console.error('Not a git repository. Run inside a project repo.');
    exit(1);
}

process.chdir(repoRoot);

// ------- git ls-files -------

const trackedFiles = execSync('git ls-files -z')
    .toString('utf8')
    .split('\0')
    .filter(Boolean);

// ------- languages -------

/** @type {Record<string, number>} */
const languageCounts = {};

for (const file of trackedFiles) {
    const dot = file.lastIndexOf('.');
    if (dot === -1) continue;
    const ext = file.slice(dot).toLowerCase();
    if (CONFIG_EXTS.has(ext)) continue;
    const lang = LANG_BY_EXT[ext];
    if (!lang) continue;
    languageCounts[lang] = (languageCounts[lang] || 0) + 1;
}

const sortedLanguages = Object.entries(languageCounts).sort((a, b) => b[1] - a[1]);
const primaryLanguage = sortedLanguages[0]?.[0] ?? 'unknown';

// ------- package.json discovery -------

const pkgFiles = trackedFiles.filter((f) => f.endsWith('package.json') && !f.includes('node_modules'));

/** @type {Record<string, string>[]} */
const allDeps = [];

/** @type {string[]} */
const allScriptValues = [];

/** @type {Record<string, unknown> | null} */
let rootPkg = null;

for (const file of pkgFiles) {
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        continue;
    }
    if (file === 'package.json') rootPkg = pkg;
    const scripts = pkg.scripts;
    if (scripts && typeof scripts === 'object') {
        for (const value of Object.values(scripts)) {
            if (typeof value === 'string') allScriptValues.push(value);
        }
    }
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const block = pkg[key] || {};
        for (const [name, range] of Object.entries(block)) {
            allDeps.push({ name, range: String(range), file, scope: key });
        }
    }
}

const depNames = new Set(allDeps.map((d) => d.name));

/** @param {string} range */
function parseVersionFromRange(range) {
    if (/^(workspace:|link:|file:|catalog:|npm:|patch:|github:|git\+|https?:|\*$|latest$)/i.test(range)) {
        return null;
    }
    const exact = range.match(/^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
    if (exact) return exact[1];
    const partial = range.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
    if (partial) return partial[1];
    const minor = range.match(/(\d+\.\d+)/);
    if (minor) return minor[1];
    const major = range.match(/(\d+)/);
    if (major) return major[1];
    return null;
}

/** @param {string} a @param {string} b */
function compareSemver(a, b) {
    const pa = a.split(/[.-]/).map((part) => parseInt(part, 10) || 0);
    const pb = b.split(/[.-]/).map((part) => parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff;
    }
    return a.localeCompare(b);
}

/** @param {string[]} packages @returns {(string | null)[]} */
function resolveAllPackageVersions(packages) {
    /** @type {Set<string | null>} */
    const versions = new Set();
    for (const dep of allDeps) {
        if (packages.includes(dep.name)) {
            versions.add(parseVersionFromRange(dep.range));
        }
    }
    const parsed = [...versions].filter((v) => v !== null).sort(compareSemver);
    if (parsed.length > 0) return parsed;
    if (versions.has(null)) return [null];
    return [];
}

/** @typedef {{ packages: string[], files?: string[], scriptPatterns?: string[] }} MarkerDef */

/** @param {string[]} patterns */
function hasTrackedFile(patterns) {
    return patterns.some((pattern) =>
        trackedFiles.some((file) => file === pattern || file.endsWith(`/${pattern}`) || basename(file) === pattern),
    );
}

/** @param {string} pattern */
function isTrackedPath(pattern) {
    return trackedFiles.some(
        (file) => file === pattern || file.endsWith(`/${pattern}`) || basename(file) === pattern,
    );
}

/**
 * @typedef {{ files?: string[], prefixes?: Record<string, string>, packages?: string[] }} SignalMarkerDef
 */

/**
 * @param {Record<string, SignalMarkerDef>} definitions
 * @returns {Record<string, { signals: string[] }>}
 */
function detectSignalTooling(definitions) {
    /** @type {Record<string, { signals: string[] }>} */
    const detected = {};

    for (const [toolId, def] of Object.entries(definitions)) {
        /** @type {Set<string>} */
        const signals = new Set();

        for (const file of def.files ?? []) {
            if (isTrackedPath(file)) signals.add(file);
        }

        for (const [category, prefix] of Object.entries(def.prefixes ?? {})) {
            if (trackedFiles.some((file) => file.startsWith(prefix))) signals.add(category);
        }

        for (const pkg of def.packages ?? []) {
            if (depNames.has(pkg)) signals.add(pkg);
        }

        if (signals.size > 0) {
            detected[toolId] = { signals: [...signals].sort() };
        }
    }

    return Object.fromEntries(Object.entries(detected).sort(([a], [b]) => a.localeCompare(b)));
}

/** @param {Record<string, SignalMarkerDef>} definitions */
function detectAgentTooling(definitions) {
    return detectSignalTooling(definitions);
}

/** @param {string[]} patterns */
function matchesPackageScripts(patterns) {
    return patterns.some((pattern) => {
        const re = new RegExp(pattern);
        return allScriptValues.some((script) => re.test(script));
    });
}

/**
 * @param {Record<string, string[] | MarkerDef>} category
 * @returns {Record<string, (string | null)[]>}
 */
function matchMarkersWithVersions(category) {
    /** @type {Record<string, (string | null)[]>} */
    const matched = {};

    for (const [label, def] of Object.entries(category)) {
        const packages = Array.isArray(def) ? def : def.packages;
        const files = Array.isArray(def) ? undefined : def.files;
        const scriptPatterns = Array.isArray(def) ? undefined : def.scriptPatterns;
        const foundPackage = packages.find((pkg) => depNames.has(pkg));

        if (foundPackage) {
            const versions = resolveAllPackageVersions(packages);
            matched[label] = versions.length ? versions : [null];
        } else if (scriptPatterns?.length && matchesPackageScripts(scriptPatterns)) {
            const versions = resolveAllPackageVersions(packages);
            matched[label] = versions.length ? versions : [null];
        } else if (files?.length && hasTrackedFile(files)) {
            matched[label] = [null];
        }
    }

    return Object.fromEntries(Object.entries(matched).sort(([a], [b]) => a.localeCompare(b)));
}

// ------- package manager -------

/** @returns {{ name: string, version: string | null }} */
function detectPackageManager() {
    if (existsSync('bun.lockb') || existsSync('bun.lock')) {
        const pm = rootPkg?.packageManager;
        const m = typeof pm === 'string' ? pm.match(/^bun@([\d.]+)/) : null;
        return { name: 'bun', version: m?.[1] ?? null };
    }
    if (existsSync('pnpm-lock.yaml') || existsSync('pnpm-workspace.yaml')) {
        const pm = rootPkg?.packageManager;
        const m = typeof pm === 'string' ? pm.match(/^pnpm@([\d.]+)/) : null;
        return { name: 'pnpm', version: m?.[1] ?? null };
    }
    if (existsSync('yarn.lock')) {
        const header = readFileSync('yarn.lock', 'utf8').slice(0, 200);
        const isBerry = header.includes('__metadata');
        const pm = rootPkg?.packageManager;
        const m = typeof pm === 'string' ? pm.match(/^yarn@([\d.]+)/) : null;
        if (m) return { name: 'yarn', version: m[1] };
        return { name: 'yarn', version: isBerry ? '4' : '1' };
    }
    if (existsSync('package-lock.json')) {
        const pm = rootPkg?.packageManager;
        const m = typeof pm === 'string' ? pm.match(/^npm@([\d.]+)/) : null;
        return { name: 'npm', version: m?.[1] ?? null };
    }
    if (rootPkg?.packageManager && typeof rootPkg.packageManager === 'string') {
        const m = rootPkg.packageManager.match(/^(\w+)@([\d.]+)/);
        if (m) return { name: m[1], version: m[2] };
    }
    if (pkgFiles.length > 0) return { name: 'npm', version: null };
    return { name: null, version: null };
}

const packageManager = detectPackageManager();

// ------- Node runtime -------

/** @returns {string | null} */
function detectNodeVersion() {
    if (existsSync('.nvmrc')) {
        const raw = readFileSync('.nvmrc', 'utf8').trim();
        const m = raw.match(/^v?(\d+(?:\.\d+)?(?:\.\d+)?)/);
        if (m) return m[1];
    }
    if (existsSync('.node-version')) {
        const raw = readFileSync('.node-version', 'utf8').trim();
        const m = raw.match(/^v?(\d+(?:\.\d+)?(?:\.\d+)?)/);
        if (m) return m[1];
    }
    const engines = rootPkg?.engines?.node;
    if (typeof engines === 'string') {
        const m = engines.match(/(\d+(?:\.\d+)?(?:\.\d+)?)/);
        if (m) return m[1];
    }
    return null;
}

const nodeVersion = detectNodeVersion();

// ------- monorepo -------

const monorepoSignals = [];
if (rootPkg?.workspaces) monorepoSignals.push('package.json#workspaces');
if (existsSync('lerna.json')) monorepoSignals.push('lerna.json');
if (existsSync('nx.json')) monorepoSignals.push('nx.json');
if (existsSync('turbo.json')) monorepoSignals.push('turbo.json');
if (existsSync('pnpm-workspace.yaml')) monorepoSignals.push('pnpm-workspace.yaml');
if (existsSync('go.work')) monorepoSignals.push('go.work');
const isMonorepo = monorepoSignals.length > 0 || pkgFiles.length > 1;

// ------- marker matching -------

const frameworks = matchMarkersWithVersions(markers.frameworks);
const bundlers = matchMarkersWithVersions(markers.bundlers);
const testRunners = matchMarkersWithVersions(markers.testRunners);
const uiLibraries = matchMarkersWithVersions(markers.uiLibraries);
const componentCatalogs = matchMarkersWithVersions(markers.componentCatalogs);
const formLibraries = matchMarkersWithVersions(markers.formLibraries);
const linters = matchMarkersWithVersions(markers.linters);
const databases = matchMarkersWithVersions(markers.databases);
const agentTooling = detectAgentTooling(agentMarkers);
const contentTooling = detectSignalTooling(contentToolingMarkers);

// ------- content archetype -------

const CODE_LANGUAGE_IDS = [
    'typescript',
    'javascript',
    'python',
    'go',
    'rust',
    'java',
    'kotlin',
    'ruby',
    'php',
    'csharp',
    'swift',
    'vue',
    'scala',
    'elixir',
    'erlang',
    'haskell',
    'lua',
    'zig',
    'dart',
    'shell',
];

/** @returns {string[]} */
function detectArticleSlugs() {
    /** @type {Set<string>} */
    const slugs = new Set();
    for (const file of trackedFiles) {
        const match = file.match(/^([^/.][^/]*)\/index\.md$/);
        if (match) slugs.add(match[1]);
    }
    return [...slugs].sort();
}

function hasObsidianVault() {
    return trackedFiles.some((file) => file.startsWith('.obsidian/'));
}

function hasNovelStructure() {
    const numberedRoot = trackedFiles.some((file) => {
        const top = file.split('/')[0];
        return /^[0-9]{2}_/.test(top);
    });
    const actsOrChapters = trackedFiles.some(
        (file) => file.includes('/Act_') || /^04_Главы\//.test(file),
    );
    const scenes = trackedFiles.some(
        (file) => /_сцена\.md$/i.test(file) || /\/мета\.md$/i.test(file),
    );
    return numberedRoot && (actsOrChapters || scenes);
}

function hasDocusaurusSite() {
    return (
        depNames.has('@docusaurus/core') ||
        hasTrackedFile([
            'docusaurus.config.js',
            'docusaurus.config.ts',
            'docusaurus.config.mjs',
        ])
    );
}

/** @returns {'code' | 'articles' | 'novel' | 'docs-site' | 'mixed'} */
function detectContentArchetype() {
    const mdCount = (languageCounts.markdown || 0) + (languageCounts.mdx || 0);
    const codeCount = CODE_LANGUAGE_IDS.reduce((sum, lang) => sum + (languageCounts[lang] || 0), 0);
    const articleSlugs = detectArticleSlugs();
    const obsidian = hasObsidianVault();
    const novel = hasNovelStructure();
    const docusaurus = hasDocusaurusSite();

    if (novel) return 'novel';
    if (obsidian || (articleSlugs.length > 0 && pkgFiles.length === 0)) return 'articles';
    if (articleSlugs.length > 0 && mdCount >= codeCount) return 'articles';
    if (docusaurus && mdCount > 0) return 'docs-site';
    if (mdCount > 0 && codeCount > 0) return 'mixed';
    if (mdCount > 0) return 'articles';
    return 'code';
}

const contentArchetype = detectContentArchetype();
const contentRepo = contentArchetype !== 'code';

// Python markers from files
if (
    (existsSync('requirements.txt') || existsSync('pyproject.toml') || existsSync('Pipfile')) &&
    !('django' in frameworks) &&
    trackedFiles.some((f) => f.endsWith('manage.py'))
) {
    frameworks.django = [null];
}
if (existsSync('go.mod')) {
    if (primaryLanguage === 'go' || languageCounts.go) {
        // go module present
    }
}

// ------- profile -------

/** @param {Record<string, unknown>} obj */
function omitUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

const profile = {
    version: 5,
    generatedAt: new Date().toISOString(),
    generatedBy: GENERATED_BY,
    repo: {
        name: basename(repoRoot),
        root: repoRoot,
        primaryLanguage,
        contentRepo,
        monorepo: isMonorepo,
        monorepoSignals: monorepoSignals.length ? monorepoSignals : undefined,
        packageJsonCount: pkgFiles.length,
    },
    languages: Object.fromEntries(sortedLanguages),
    content: omitUndefined({
        archetype: contentArchetype,
        tooling: Object.keys(contentTooling).length ? contentTooling : undefined,
    }),
    stack: omitUndefined({
        runtime: nodeVersion ? { node: nodeVersion } : {},
        packageManager: packageManager.name
            ? omitUndefined({
                  name: packageManager.name,
                  version: packageManager.version ?? undefined,
              })
            : undefined,
        frameworks: Object.keys(frameworks).length ? frameworks : undefined,
        bundlers: Object.keys(bundlers).length ? bundlers : undefined,
        testRunners: Object.keys(testRunners).length ? testRunners : undefined,
        uiLibraries: Object.keys(uiLibraries).length ? uiLibraries : undefined,
        componentCatalogs: Object.keys(componentCatalogs).length ? componentCatalogs : undefined,
        formLibraries: Object.keys(formLibraries).length ? formLibraries : undefined,
        linters: Object.keys(linters).length ? linters : undefined,
        databases: Object.keys(databases).length ? databases : undefined,
    }),
    agentTooling: Object.keys(agentTooling).length ? agentTooling : undefined,
    audit: {
        scope: 'full',
        exclude: ['node_modules/', 'dist/', 'build/', '.git/'],
    },
};

const auditDir = join(repoRoot, '.audit');
const profilePath = join(auditDir, 'profile.json');
const legacyProfilePath = join(auditDir, 'profile.yaml');
const profileJson = `${JSON.stringify(profile, null, 2)}\n`;

if (!dryRun) {
    if (!force && (existsSync(profilePath) || existsSync(legacyProfilePath))) {
        console.error(`Profile already exists: ${profilePath}`);
        console.error('Use --force to overwrite.');
        exit(1);
    }
    mkdirSync(auditDir, { recursive: true });
    writeFileSync(profilePath, profileJson, 'utf8');
}

// ------- output -------

/** @param {Record<string, (string | null)[]>} items */
function formatStackItems(items) {
    return Object.entries(items)
        .map(([name, versions]) => {
            const parsed = versions.filter((v) => v !== null);
            if (parsed.length === 0) return name;
            if (parsed.length === 1) return `${name}@${parsed[0]}`;
            return `${name}@[${parsed.join(', ')}]`;
        })
        .join(', ');
}

if (jsonOut) {
    console.log(JSON.stringify({ profile, profilePath: dryRun ? null : profilePath }, null, 2));
} else {
    const c = (s, code) => (process.stdout.isTTY ? `\u001b[${code}m${s}\u001b[0m` : s);
    console.log(c('Stack detection complete', '1;32'));
    console.log('');
    console.log(`${c('Repo', '36')}:        ${profile.repo.name}`);
    console.log(`${c('Language', '36')}:    ${profile.repo.primaryLanguage}${sortedLanguages[0] ? ` (${sortedLanguages[0][1]} files)` : ''}`);
    console.log(`${c('Content repo', '36')}: ${profile.repo.contentRepo ? 'yes' : 'no'}`);
    if (profile.content?.archetype) {
        console.log(`${c('Archetype', '36')}:   ${profile.content.archetype}`);
    }
    if (profile.content?.tooling && Object.keys(profile.content.tooling).length) {
        const contentSummary = Object.entries(profile.content.tooling)
            .map(([tool, { signals }]) => `${tool}(${signals.join(', ')})`)
            .join(', ');
        console.log(`${c('Content tooling', '36')}: ${contentSummary}`);
    }
    console.log(`${c('Monorepo', '36')}:    ${profile.repo.monorepo ? 'yes' : 'no'}${monorepoSignals.length ? ` (${monorepoSignals.join(', ')})` : ''}`);
    if (nodeVersion) console.log(`${c('Node', '36')}:        ${nodeVersion}`);
    if (packageManager.name) {
        console.log(`${c('Package mgr', '36')}: ${packageManager.name}${packageManager.version ? `@${packageManager.version}` : ''}`);
    }
    if (Object.keys(frameworks).length) console.log(`${c('Frameworks', '36')}:  ${formatStackItems(frameworks)}`);
    if (Object.keys(bundlers).length) console.log(`${c('Bundlers', '36')}:    ${formatStackItems(bundlers)}`);
    if (Object.keys(testRunners).length) console.log(`${c('Tests', '36')}:       ${formatStackItems(testRunners)}`);
    if (Object.keys(uiLibraries).length) console.log(`${c('UI libs', '36')}:     ${formatStackItems(uiLibraries)}`);
    if (Object.keys(componentCatalogs).length)
        console.log(`${c('Catalogs', '36')}:   ${formatStackItems(componentCatalogs)}`);
    if (Object.keys(formLibraries).length)
        console.log(`${c('Forms', '36')}:      ${formatStackItems(formLibraries)}`);
    if (Object.keys(linters).length) console.log(`${c('Linters', '36')}:     ${formatStackItems(linters)}`);
    if (Object.keys(databases).length) console.log(`${c('Databases', '36')}:   ${formatStackItems(databases)}`);
    if (Object.keys(agentTooling).length) {
        const agentSummary = Object.entries(agentTooling)
            .map(([tool, { signals }]) => `${tool}(${signals.join(', ')})`)
            .join(', ');
        console.log(`${c('Agent tooling', '36')}: ${agentSummary}`);
    }
    if (sortedLanguages.length > 1) {
        console.log('');
        console.log(c('All languages:', '90'));
        for (const [lang, count] of sortedLanguages) {
            console.log(`  ${lang}: ${count}`);
        }
    }
    console.log('');
    if (dryRun) {
        console.log(c('Dry run — profile not written.', '33'));
    } else {
        console.log(`${c('Written', '32')}: ${profilePath}`);
    }
}
