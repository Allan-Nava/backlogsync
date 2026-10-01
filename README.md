<p align="center"><img src="https://raw.githubusercontent.com/Allan-Nava/backlogsync/main/assets/logo.svg" width="72" height="72" alt=""></p>

# backlogsync — one backlog file, a generated roadmap, issues that follow

**backlogsync keeps `BACKLOG.md` the single source of truth for planned work**: it checks the file, generates `ROADMAP.md` from it, and syncs GitHub issues and milestones one way — from the file to GitHub, never back. A Node CLI with zero runtime dependencies, and a composite GitHub Action that runs the same code.

**Status:** 0.1.0, the first version on npm. It replaces the `scripts/backlog.mjs` that seven repositories each carried, and on 2026-10-01 it reproduced every one of their committed roadmaps byte for byte and planned the same sync, decision for decision, on their real issues (see [Compatibility](#compatibility)). The gate on 0.1.0 — one of those repositories migrated and its sync observed on GitHub — was met the same day by skilltrigger.

## What it does

- **`backlogsync check`** — validates the backlog (ids well-formed and unique, metadata that parses and holds known values, every item under a milestone) and fails when `ROADMAP.md` is not what the backlog would generate. The CI gate.
- **`backlogsync roadmap`** — writes `ROADMAP.md`: a summary line, a table of milestones with progress bars, then every item by milestone.
- **`backlogsync sync`** — plans the issue sync, prints the whole plan, then applies it over the GitHub REST API: create the issue for an open item, close it when the item is ticked, reopen it when the item is unticked, retitle it when the title drifts, move it when the item moves to another milestone. `--dry-run` prints the plan and changes nothing.

The sync **never deletes**. There is no delete call in the code. An issue whose item has left the backlog is left alone; so is an issue filed by hand, a pull request, and an issue with another prefix.

## Install

Node 18 or later. No runtime dependencies, no build step, no install script.

**From npm**: `npx backlogsync check`, or `npm install --save-dev backlogsync` and `npx backlogsync check` from then on.

**As a GitHub Action**, pinned by release tag or by commit — `.github/workflows/backlog-issues.yml`:

```yaml
name: Backlog issues
on:
  push:
    branches: [main]
    paths: [BACKLOG.md, .github/workflows/backlog-issues.yml]
  workflow_dispatch:
permissions:
  contents: read
  issues: write
concurrency:
  group: backlog-issues
  cancel-in-progress: false
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: Allan-Nava/backlogsync@backlogsync--v0.1.0   # or @<sha>
        with:
          command: sync        # or check, roadmap
          # dry-run: "true"
          # milestones: v0.1.0,v0.2.0
```

The `concurrency` group matters: two runs racing would both see no issue for an item and open it twice. The action's inputs are `command`, `dry-run`, `milestones`, `config`, `working-directory` and `token` (default: the job's `GITHUB_TOKEN`). It runs `node "$GITHUB_ACTION_PATH/bin/backlogsync.mjs"` with the runner's Node.

**From a commit**, the pre-release route: for a repository that pins the action to a commit not yet released on npm and wants the same version locally — the GitHub tarball, because `npx github:Allan-Nava/backlogsync#<sha>` fails inside npm ("GitFetcher requires an Arborist constructor"):

```bash
npx --yes https://codeload.github.com/Allan-Nava/backlogsync/tar.gz/<sha> check
```

skilltrigger's `npm run backlog` and `npm run roadmap`, from the 0.1.0 pilot, do exactly this.

**From a checkout**: `node <checkout>/bin/backlogsync.mjs check`, run in the repository that holds the backlog.

## The backlog

````markdown
## v0.2.0 — Title of the milestone <!-- ms: phase=next -->

- [ ] **ST-12 — Short name**: what it is, why it earns its place, what it
  needs to touch. <!-- st: prio=high size=M labels=runner,docs -->
- [x] **ST-11 — Shipped item**: … <!-- st: prio=med size=S labels=docs ver=0.1.0 -->
````

- A **milestone** is a `## ` heading that starts with `vX.Y.Z` and carries `<!-- ms: phase=… -->`, phase one of `now`, `next`, `later`, `shipped`. Any other `## ` heading ends the milestone above it.
- An **item** is `- [ ] **<PREFIX>-n — Title**: body` and its indented continuation lines, ending with the metadata comment, whose key is the configured `meta` (here `st`). `prio` is `high`, `med` or `low`; `size` is `S`, `M`, `L` or `XL`; `labels` is a comma-separated list, at least one.
- `- [x]` marks it shipped, and a shipped item carries `ver=x.y.z` (or `ver=main` while merged and unreleased); an open item carries no `ver`.
- The **id never changes**. A new item takes the next free number.
- Fenced blocks are skipped whole, so the file can document its own format, as above.

The issue for an item is titled `<id> — <title>`; that prefix is the only link between the two, so the title is the one thing the sync rewrites. The body is the item's text with every HTML comment stripped, followed by a footer naming the backlog. It is written once, at creation.

## Configuration

In `package.json` under `"backlogsync"`, or in `.backlogsync.json` — which is all a repository without a `package.json`, a Go module say, needs. Both at once is an error rather than a precedence rule: a repository that carries two has already drifted. `--config <file>` names any other file.

```json
{
  "prefix": "ST",
  "meta": "st",
  "name": "skilltrigger",
  "labels": {
    "runner": { "color": "0e8a16", "description": "The serial runner" },
    "docs": ["0075ca", "README, CONTRIBUTING, site"]
  }
}
```

| Key | Default | What it is |
|---|---|---|
| `prefix` | — (required) | The id prefix: `ST` for `ST-1`. Upper-case letters and digits. |
| `meta` | the prefix, lower-cased | The metadata comment's key: `<!-- st: … -->`. |
| `name` | `package.json#name`, else the directory | The roadmap's title: `# Roadmap — <name>`. |
| `labels` | none: any label passes | Name → `{color, description}` (or `[color, description]`, the shape the replaced scripts used). When set, an item may only use these; the sync creates any that are missing. |
| `backlog`, `roadmap` | `BACKLOG.md`, `ROADMAP.md` | Paths, relative to the config's directory. |
| `branch` | `main` | The branch the issue footer links to. |
| `regenerate` | `npx backlogsync roadmap` | The command the roadmap and the stale-roadmap error tell a reader to run. The generated-by comment prints it without its leading `node` or `npx`. |

The sync takes `GITHUB_TOKEN` (or `GH_TOKEN`) and `GITHUB_REPOSITORY` from the environment, plus `GITHUB_API_URL` and `GITHUB_SERVER_URL` when set — Actions sets all four. A dry run on a public repository works without a token. Labels `prio-high`, `prio-med` and `prio-low` are added to every new issue from its `prio=`; a `labels` entry of the same name overrides one's colour.

Exit codes: `0` ok, `1` a problem in the backlog, a stale roadmap or a failed API call, `2` a usage or configuration error.

## Release drift

`.github/workflows/release-drift.yml` is also a reusable workflow: it fails when the version in the manifest has had no matching tag for two hours, because a merged release PR publishes nothing until someone pushes the tag. It runs on push and daily.

```yaml
jobs:
  drift:
    uses: Allan-Nava/backlogsync/.github/workflows/release-drift.yml@backlogsync--v0.1.0   # or @<sha>
    with:
      version-file: VERSION   # default package.json
      tag-prefix: v           # default <package name>--v, or v for a plain file
```

`grace-hours` (default 2) and `changelog` (default `CHANGELOG.md`) are the other inputs. A version whose CHANGELOG heading says `not released`, or whose section opens with `Not released`, passes with a notice.

## Decisions

The seven copies agreed on the format, the lint rules, the roadmap layout and the planner; they differed in what each hard-coded. Each difference is either a key above or one choice, recorded here.

- **Prefix, meta key, roadmap name, label set** — different in every copy; `prefix`, `meta`, `name` and `labels`. The owner and repository came from a hard-coded URL; they now come from `GITHUB_REPOSITORY`.
- **The `prio-med` colour** — `fbca04` in six copies, `e4b429` in one. The default is the majority's; a `labels` entry overrides it. Existing labels are never recoloured.
- **"Source of trutm" and "Source of trugl"** — two copies carried a find-and-replace artefact in the issue footer and the milestone description. Fixed, not reproduced. Bodies and descriptions are written only on creation, so issues that already exist are not touched by it.
- **The release-drift marker** — one copy read `not released` on the CHANGELOG heading, one read a section opening with `Not released`, five read neither. The reusable workflow accepts both. One of the five has a section that opens with `Not released` and would fail daily once its grace window passed; the reusable workflow passes it.
- **Version file and tag shape** — `package.json` with `<name>--v<version>` in five, a `VERSION` file with `v<version>` in two: the `version-file` and `tag-prefix` inputs. The remediation hint is a plain `git tag … && git push …` for all.
- **Fixed, not configurable:** the `prio`, `size` and `phase` vocabularies and the `vX.Y.Z` milestone headings — identical in all seven, so a key would only invite drift.

Changed on purpose, and the same in every repository from now on:

- The sync calls the REST API itself rather than the `gh` CLI, and applies by default; `--dry-run` replaces the old `issues` / `issues --apply` pair. `lint` and `check` are one command, `check`; the old `stats` line is the roadmap's summary line.
- Labels are ensured only when an issue is about to be created, not on every run.
- The close and reopen comments and the issue footer name backlogsync rather than a script path.
- The lint is stricter in four ways the copies let pass silently: an item under another prefix, an item ticked `[X]`, two milestone headings with one title (the sync finds a milestone by title), and a `prio-` label listed by hand. None of the seven real backlogs trips them.

## Compatibility

`node scripts/compat.mjs <repo> … [--issues]` runs over checkouts of repositories that still carry their own `scripts/backlog.mjs`. It derives the config from that script, runs `backlogsync roadmap` over the repository's `BACKLOG.md` into a temporary directory and compares the result with its committed `ROADMAP.md` byte for byte; runs `backlogsync check`; and, with `--issues`, reads the issues with `gh issue list` and compares the new planner's decisions with the old script's on that same list. It writes nothing outside the temporary directory, and nothing it reads belongs in this repository.

On 2026-10-01, over the seven repositories: seven roadmaps byte-identical (1,905 to 4,448 bytes), seven checks passing, seven plans identical (17 to 40 decisions each, 118 issues read, none with anything left to change).

## What it never does

- Delete an issue, a milestone or a label.
- Write to the repository. `roadmap` writes one file locally; committing it is yours.
- Read anything back from GitHub into the backlog. The sync is one way.
- Send the token anywhere but the configured API origin: a pagination link to another origin is refused.
- Run on install. There is no install script, and no dependency.

## License

MIT
