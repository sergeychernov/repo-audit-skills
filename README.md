# repo-audit-skills

Skills and agents for repository audits — architecture, code smells, security, and more.

Compatible with [ide-agents](https://github.com/sergeychernov/ide-agents): nested layout under `skills/`.

## Skills

| Skill | Description |
|-------|-------------|
| `audit-init` | Detects the project stack and writes `.audit/profile.json` |

## Local testing

```bash
file://$(pwd)
```

Install `audit-init` as **Project** in ide-agents, then in a target repo:

```bash
node .cursor/skills/audit-init/scripts/detect-stack.mjs
```
