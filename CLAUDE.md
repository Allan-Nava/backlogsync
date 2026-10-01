# CLAUDE.md

Guidance for Claude Code when working in this repository. [AGENTS.md](AGENTS.md) is the
vendor-neutral subset; the two must agree.

## What this repo is

`backlogsync` is a **command-line tool and a composite GitHub Action**: `BACKLOG.md` is
the single source of truth for planned work, `ROADMAP.md` is generated from it, and the
GitHub issues and milestones are synced from it one way. It replaces the
`scripts/backlog.mjs` that seven sibling repositories each carried, and their
`release-drift.yml`.

Zero runtime dependencies, Node 18+, ESM, no build, no install script. `marked` is a
devDependency used only by the site build.

## Layout

```
bin/
  backlogsync.mjs      the CLI: roadmap, check, sync; exit codes 0/1/2
  lib/args.mjs         argument parser (util.parseArgs is 18.3+, the floor is 18.0)
  lib/config.mjs       package.json#backlogsync or .backlogsync.json, validated
  lib/backlog.mjs      parse, lint, roadmap — pure, text in
  lib/plan.mjs         the planner: backlog + existing issues → actions — pure
  lib/github.mjs       the REST client on node:http(s); no DELETE, no foreign origin
  lib/sync.mjs         applies a plan: labels, milestones, issues, comments
action.yml             composite action: node "$GITHUB_ACTION_PATH/bin/backlogsync.mjs"
test/
  helpers/fake-github.mjs  the fake REST API on a local port, every request recorded
  fixtures/            a synthetic backlog, config, issue list and expected roadmap
  *.test.mjs           node --test
scripts/
  repo-check.mjs       the repository's invariants and the leak check (--history in CI)
  compat.mjs           the roadmap and plan against other checkouts' own scripts
  release-notes.mjs    the CHANGELOG section a release's notes open with
site/build.mjs         site/dist/index.html from README.md (gitignored output)
assets/logo.svg        the mark, the favicon's single source
.github/workflows/
  ci.yml               check on Node 18/20/22/24, own-history, pack, the action on itself
  backlog-issues.yml   this repository's own sync, through `uses: ./`
  release-drift.yml    this repository's drift check AND the reusable workflow
  release.yml          on tag backlogsync--v*: npm over OIDC, GitHub release, milestone
  pages.yml, codeql.yml
```

## The rules the code encodes

Do not weaken these; they are the tool's reason to exist.

1. **One way only.** Nothing is read back from GitHub into the backlog. The issue title
   prefix `<id> — ` is the only link between an item and its issue.
2. **Never delete.** No delete call exists in `lib/github.mjs`; the planner has no
   action for it; an issue whose item left the backlog is not touched. The fake API
   answers DELETE with 405 and the tests assert none is sent.
3. **The plan is printed in full before anything is applied**, and `--dry-run` sends no
   write — the tests assert zero non-GET requests.
4. **The roadmap layout is a compatibility contract.** `roadmap()` must keep producing
   the seven repositories' committed `ROADMAP.md` byte for byte; run
   `scripts/compat.mjs` against their checkouts before changing it, the lint or the
   planner.
5. **A lint error stops every command** before anything is written or sent.
6. **The token goes to the configured API origin only.** A pagination link elsewhere is
   refused; an error message never carries the token.
7. **Inputs reach the action's shell as environment variables**, never interpolated
   into the script.

## Conventions

- A difference between the replaced copies is a config key or one recorded choice — the
  README's "Decisions" section is where the choice is written. Adding a key means the
  README table, `KEYS` in `lib/config.mjs`, and a test.
- Fixtures are synthetic. Never copy a real backlog, issue list or roadmap into
  `test/`; some of them mention private infrastructure.
- `npm test` runs `backlogsync check` on this repository's own backlog first: regenerate
  `ROADMAP.md` in the same commit as a `BACKLOG.md` change.
- Prose: British-leaning spelling, em-dashes, no decorative emoji, no marketing filler.
- No tool attribution in commits, pull requests or docs.

## Publishing hygiene

This repository is public. Before a push, `git grep` the tree and `git log -p` the
history for home paths, file URLs, email addresses other than the public one, private
repository, host or client names, internal IPs and token shapes —
`LEAK_TERMS=<private list outside the repo> node scripts/repo-check.mjs --history`
does all of it. CI runs the same check without the private list.

## Verifying a change

```bash
npm test; echo "exit $?"          # print the exit code; never judge a run through | tail
npm pack --dry-run
node scripts/compat.mjs <checkouts…> --issues   # when the format, lint, roadmap or planner changed
npm run build:site && open site/dist/index.html # when the README changed
```

## Releasing

The runbook lives in [CONTRIBUTING.md](CONTRIBUTING.md#releasing). The first version on
npm, 0.1.0, is published by hand (BS-9): npm cannot configure a trusted publisher for a
package that does not exist. Never run `npm publish` or `npm login` on the maintainer's
behalf.
