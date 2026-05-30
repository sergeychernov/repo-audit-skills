---
name: audit-init
description: >-
  Detects the target repository stack (languages, runtime, package manager,
  frameworks, bundlers, test runners, UI libraries, component catalogs, form
  libraries, AI assistant configs) and
  writes `.audit/profile.json` for
  downstream audit skills. Use when initializing a repo audit, detecting tech
  stack, creating `.audit/`, or before running architecture/security/code-smell
  audits.
scope: any
---

# Audit init — stack detection

Bootstraps the audit context in the **target project**. Creates `.audit/profile.json`
that other audit skills read before scanning.

## Skill layout

Scripts and data live **inside this skill's folder**, not in the target repo.

```
<SKILL_DIR>/
├── SKILL.md
├── scripts/
│   └── detect-stack.mjs
└── assets/
    ├── stack-markers.json
    ├── agent-config-markers.json
    └── profile.schema.json
```

`<SKILL_DIR>` is the directory that contains this file (e.g.
`.cursor/skills/audit-init/` when installed as Project).

## When to use

- First step of any repo audit workflow
- "Определи стек проекта", "инициализируй аудит"
- Before `audit-debt`.

## Quick start

Run from anywhere inside the target git repo:

```bash
node <SKILL_DIR>/scripts/detect-stack.mjs
```

Output: human-readable summary + `.audit/profile.json`.

Flags:

| Flag | Effect |
|------|--------|
| `--json` | Print profile JSON to stdout |
| `--dry-run` | Detect only, do not write files |
| `--force` | Overwrite existing `.audit/profile.json` |

## Workflow

```
- [ ] Step 1: Run detect-stack.mjs
- [ ] Step 2: Review .audit/profile.json — adjust audit.exclude if needed
- [ ] Step 3: Commit `.audit/profile.json` or add `.audit/` to `.gitignore`
- [ ] Step 4: Proceed with other audit skills that read the profile
```

**Step 1 — Detect**

```bash
node <SKILL_DIR>/scripts/detect-stack.mjs
```

If profile already exists and stack changed:

```bash
node <SKILL_DIR>/scripts/detect-stack.mjs --force
```

**Step 2 — Review**

Open `.audit/profile.json`. Key fields:

| Field | Meaning |
|-------|---------|
| `generatedBy` | Git URL of the repo-audit-skills catalog |
| `repo.primaryLanguage` | Dominant language by tracked source files |
| `repo.monorepo` | Workspaces / lerna / nx / turbo / multiple package.json |
| `stack.runtime.node` | From `.nvmrc`, `.node-version`, or `engines.node` |
| `stack.packageManager` | yarn / npm / pnpm / bun + version when detectable |
| `stack.frameworks` | Matched from package.json deps + config files; id → semver[] |
| `stack.bundlers` | id → semver[] from all package.json |
| `stack.testRunners` | id → semver[] from all package.json |
| `stack.uiLibraries` | UI / CSS kit id → semver[] (MUI, Tailwind, Radix, …) |
| `stack.componentCatalogs` | Storybook, Ladle, Histoire, Styleguidist, … → semver[] |
| `stack.formLibraries` | Formik, React Hook Form, RJSF, Formily, … → semver[] |
| `stack.linters` | ESLint, Prettier, Ruff, … → semver[] |
| `stack.databases` | Postgres, MySQL, MongoDB, Redis, … → semver[] |
| `agentTooling` | Cursor, Claude, Codex, Copilot, … — matched config paths and rule/skill directory categories |

Profile `version: 4` — stack items are objects `{ "react": ["18.2.0", "17.0.2"] }`: unique versions from **all** `package.json` in the repo (monorepo-safe). Single version → one-element array. `[null]` means detected but version unknown (file marker only, `workspace:*` range).

`agentTooling` entries look like `{ "cursor": { "signals": ["rules", "skills", "AGENTS.md"] } }`: exact file paths from markers plus category labels when tracked files exist under a prefix (e.g. `rules` → `.cursor/rules/`).

| `audit.exclude` | Paths skipped by downstream audit skills |

Validate shape against `<SKILL_DIR>/assets/profile.schema.json` when needed.

**Step 3 — Git**

Recommended `.gitignore` entry if reports will be generated later:

```
.audit/reports/
```

Keep `profile.json` committed when the team shares audit context.

## What gets detected

| Dimension | Source |
|-----------|--------|
| Languages | `git ls-files` extension counts (typescript, python, go, …) |
| Node version | `.nvmrc`, `.node-version`, root `engines.node` |
| Package manager | lockfiles + `packageManager` field |
| Monorepo | workspaces, lerna, nx, turbo, pnpm-workspace, go.work |
| Frameworks / bundlers / tests / UI / catalogs / forms / linters / databases | `assets/stack-markers.json` — deps, tracked config files (e.g. `next.config.ts`, `.storybook/main.ts`, `components.json`), and `package.json` script commands; unique semver ranges from all workspace package.json |
| Agent configs (Cursor, Claude, Codex, Copilot, Windsurf, …) | `assets/agent-config-markers.json` — tracked files and directory prefixes only (no versions) |

Read-only. No network. No `node_modules` access. Requires a git repo.

## Agent instructions

When the user asks to initialize an audit:

1. Resolve `<SKILL_DIR>` (installed skill path).
2. Run `detect-stack.mjs` in the target repo cwd.
3. Show the human summary; mention `profile.json` path.
4. Do **not** hand-edit the profile unless the user asks — re-run with `--force` instead.

If detection misses a framework, extend `assets/stack-markers.json` in this skill repo
and re-install the skill — do not patch markers in the target project.

If an AI assistant config is missing, extend `assets/agent-config-markers.json` the same way.
