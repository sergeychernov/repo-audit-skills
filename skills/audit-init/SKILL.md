---
name: audit-init
description: >-
  Detects the target repository stack (languages, runtime, package manager,
  frameworks, bundlers, test runners) and writes `.audit/profile.json` for
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
    └── profile.schema.json
```

`<SKILL_DIR>` is the directory that contains this file (e.g.
`.cursor/skills/audit-init/` when installed as Project).

## When to use

- First step of any repo audit workflow
- "Определи стек проекта", "инициализируй аудит"
- Before `repo-audit`, `architecture-review`, `security-audit`, etc.

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
| `repo.primaryLanguage` | Dominant language by tracked source files |
| `repo.monorepo` | Workspaces / lerna / nx / turbo / multiple package.json |
| `stack.runtime.node` | From `.nvmrc`, `.node-version`, or `engines.node` |
| `stack.packageManager` | yarn / npm / pnpm / bun + version when detectable |
| `stack.frameworks` | Matched from package.json deps + config files; id → semver |
| `stack.bundlers` | id → semver from package.json |
| `stack.testRunners` | id → semver from package.json |

Profile `version: 2` — frameworks, bundlers and testRunners are objects `{ "nextjs": "14.2.5" }`, not string arrays. `null` means detected but version unknown (e.g. file marker only, `workspace:*` range).
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
| Frameworks / bundlers / tests | `assets/stack-markers.json` — deps, tracked config files (e.g. `next.config.ts`), and `package.json` script commands (e.g. `next dev`); versions from semver ranges |

Read-only. No network. No `node_modules` access. Requires a git repo.

## Agent instructions

When the user asks to initialize an audit:

1. Resolve `<SKILL_DIR>` (installed skill path).
2. Run `detect-stack.mjs` in the target repo cwd.
3. Show the human summary; mention `profile.json` path.
4. Do **not** hand-edit the profile unless the user asks — re-run with `--force` instead.

If detection misses a framework, extend `assets/stack-markers.json` in this skill repo
and re-install the skill — do not patch markers in the target project.
