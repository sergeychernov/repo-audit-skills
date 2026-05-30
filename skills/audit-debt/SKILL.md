---
name: audit-debt
description: >-
  Profile-driven tech-debt audit: reads .audit/profile.json, compares stack
  versions to npm latest (3 pts/major, 1 pt/minor × segment weight), flags
  deprecated packages, scores 0-100, writes .audit/reports/debt.json. Use after
  audit-init, for "оценка техдолга по стеку", "audit debt", stack-aware debt.
scope: any
---

# Audit debt — profile-driven tech-debt scan

Reads `.audit/profile.json` and runs only checks whose `when` clause matches the profile.
For stack segments (`frameworks`, `bundlers`, …) queries **npm registry** for latest versions.

## Skill layout

```
<SKILL_DIR>/
├── SKILL.md
├── scripts/
│   ├── run-audit.mjs
│   ├── npm-registry.mjs
│   ├── semver-utils.mjs
│   └── checks/
│       └── stack-tools.mjs    # npm + deprecated
└── assets/
    ├── segment-weights.json   # per-segment multipliers + base penalties
    ├── deprecated-packages.json
    ├── check-registry.json
    └── …
```

Stack item → npm package mapping comes from `../audit-init/assets/stack-markers.json`.

## Prerequisites

```bash
node <SKILL_DIR>/../audit-init/scripts/detect-stack.mjs
```

## Quick start

```bash
node <SKILL_DIR>/scripts/run-audit.mjs
```

| Flag | Effect |
|------|--------|
| `--json` | Machine-readable JSON on stdout |
| `--dry-run` | Scan without writing `.audit/reports/` |
| `--offline` | No npm calls — `stack_tools` uses bundled deprecated list only |
| `--explain` | Scoring breakdown table |

Exit code `2` when score &lt; 40.

**Requires network** for `stack_tools` (unless `--offline`).

## Scoring (stack_tools)

Configured in `assets/segment-weights.json`:

```
penalty = (perMajorBehind × majors + perMinorBehind × minors) × segment.weight
```

Defaults: **3** per major behind npm latest, **1** per minor (same major only), **5** for deprecated (× segment weight).

| Segment | Default weight |
|---------|----------------|
| `frameworks` | 1.0 |
| `bundlers` | 1.0 |
| `testRunners` | 0.8 |
| `uiLibraries` | 0.6 |
| `componentCatalogs` | 0.7 |
| `formLibraries` | 0.5 |
| `linters` | 0.8 |
| `databases` | 0.7 |

Set `weight: 0` to skip a segment. Tune `penalties.perMajorBehind`, `perMinorBehind`, `deprecated` globally.

Installed version = **lowest** semver among profile values for that stack item (conservative).

## Deprecated detection

1. **npm** — `deprecated` field on the installed version in the registry.
2. **Bundled** — `assets/deprecated-packages.json` (packages from stack-markers for detected items).

Finding ids: `stack_behind:…`, `stack_deprecated_npm:…`, `stack_deprecated_list:…`.

## Profile-driven checks

| Check id | Runs when | What it does |
|----------|-----------|--------------|
| `cursor_rules` | Cursor `rules` signal or `.cursor/rules/` | `.mdc` quality criteria |
| `node_runtime` | `stack.runtime.node` | Node LTS vs `reference-versions.json` |
| `stack_tools` | Any stack segment has items | npm latest + deprecated |
| `yarn_package_manager` | `packageManager: yarn` | Classic / Berry + dedupe |
| `profile_freshness` | always | Info if profile &gt; 90 days |

## Tuning

- **`assets/segment-weights.json`** — segment weights and base penalties.
- **`assets/deprecated-packages.json`** — known dead packages.
- **`assets/check-registry.json`** — enable/disable checks.
- **`assets/skill-registry.json`** — route findings to migration skills.

## Agent instructions

1. Ensure `.audit/profile.json` exists (`audit-init`).
2. Run `run-audit.mjs` (needs network for full stack scan).
3. Summarise score, `checksRun`, top findings.
4. Point to `.audit/reports/debt.json`.
5. Only write under `.audit/reports/` in the target repo.
