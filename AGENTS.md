# AGENTS.md

Instructions for any coding agent working in this repository. Claude Code users: see
[CLAUDE.md](CLAUDE.md) for the longer version; this file is the vendor-neutral subset and
the two must agree.

## Project

`backlogsync` is a Node 18+ ESM command-line tool and a composite GitHub Action, with
zero runtime dependencies and no build step. `BACKLOG.md` is the single source of truth;
`backlogsync roadmap` generates `ROADMAP.md`, `backlogsync check` validates both, and
`backlogsync sync` syncs GitHub issues and milestones one way over the REST API.

## Layout

| Path | Role |
|---|---|
| `bin/backlogsync.mjs` | the CLI |
| `bin/lib/*.mjs` | config, parse/lint/roadmap, planner, REST client, sync |
| `action.yml` | the composite action |
| `test/` | `node --test`; the sync runs against `test/helpers/fake-github.mjs` |
| `scripts/repo-check.mjs` | repository invariants and the leak check |
| `scripts/compat.mjs` | compatibility against other checkouts' own scripts |
| `site/build.mjs` | the Pages site, generated from the README |

## Rules

- The sync is one way and never deletes. The plan is printed before anything is applied;
  `--dry-run` sends no write. `syncLabels` (off by default) removes a label from an issue
  by a `PATCH` of its label list, and only a declared or `prio-` label.
- `roadmap()` output is a compatibility contract: byte-identical to the replaced copies.
- Fixtures are synthetic; never copy a real backlog or issue list into the repository.
- No runtime dependency, no install script, no build.
- This repository is public: no home paths, private names, work email addresses or
  token-shaped strings in files or commit messages.
- No tool attribution in commits, pull requests or docs.

## Verify

```bash
npm test; echo "exit $?"
npm pack --dry-run
```
