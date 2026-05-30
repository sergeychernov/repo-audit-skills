# repo-audit-skills

Skills and agents for repository audits — architecture, code smells, security, and more.

## ide-agents

Skills are compatible with [ide-agents](https://github.com/sergeychernov/ide-agents): nested layout under `skills/`, installed via symlinks (Global or Project).

| | |
|---|---|
| Site | [ide-agents.vercel.app](https://ide-agents.vercel.app/) |
| GitHub | [sergeychernov/ide-agents](https://github.com/sergeychernov/ide-agents) |
| npm | [`ide-agents`](https://www.npmjs.com/package/ide-agents) |

## Skills

| Skill | Description |
|-------|-------------|
| `audit-init` | Detects the project stack and writes `.audit/profile.json` |
| `audit-debt` | Profile-driven tech-debt scan; writes `.audit/reports/debt.json` |

## Local testing

```bash
file://$(pwd)
```

Install `audit-init` as **Project** in ide-agents, then in a target repo:

```bash
node .cursor/skills/audit-init/scripts/detect-stack.mjs
```
