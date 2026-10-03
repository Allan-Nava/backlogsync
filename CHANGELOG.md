# Changelog

All notable changes to backlogsync. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Items reference their `BS-n` backlog id.

## [Unreleased]

## [0.1.1] — 2026-10-03

0.1.1 adds the opt-in label sync, and with the key off the plan is byte-identical to
0.1.0.

### Added
- `"syncLabels": true` keeps an existing issue's labels in step with its backlog item: a
  `LABELS` action adds the labels the item names and removes the ones it no longer does,
  within the declared `labels` and the three `prio-` labels, with one `PATCH` of the
  issue's label list — still no delete call. A label outside that set, added by hand, is
  left alone. Off by default, and it needs `labels`; with it off the plan and the summary
  line read exactly as in 0.1.0. On, the plan prints `LABELS <id> <#> +added -removed`
  and the summary line counts `N to relabel` (BS-18).

### Changed
- disclosegate and transcriptmeter run on backlogsync 0.1.0; with skilltrigger and
  whipbench that is four repositories off their own copy (BS-13, BS-14).
- `repository.url` takes the form npm normalises it to (`git+https://….git`), so `npm
  publish` no longer rewrites it and warns.

## [0.1.0] — 2026-10-01

The first version on npm: 0.0.1's tool, unchanged in behaviour, published once one
repository had been migrated and its sync observed on GitHub.

### Added
- The 0.1.0 gate is met: skilltrigger migrated with the action pinned by commit, and its
  first sync on GitHub created the one issue the dry run had planned and touched nothing
  else (BS-10, BS-15).

### Changed
- The README documents running a pinned commit locally through the GitHub tarball, since
  `npx github:…` fails inside npm (BS-19).
- The README installs from npm and pins the action by its release tag,
  `@backlogsync--v0.1.0`, or by commit; the tarball route stays for a commit that is not
  released. CONTRIBUTING gives the first release's order: publish by hand, configure the
  trusted publisher, push the tag (BS-9).

## [0.0.1] — 2026-10-01 — not released

The first version, in the repository only: the tool that replaces the `scripts/backlog.mjs`
seven repositories each carried, its tests against a fake GitHub API, and this
repository. The first version on npm is 0.1.0, after one repository has been migrated
and its sync observed on GitHub (BS-10).

### Added
- `backlogsync check`: the backlog validated — ids well-formed and unique, metadata that
  parses and holds known values, items under versioned milestones — and the roadmap
  compared with what the backlog generates; exit 1 on either (BS-1, BS-2).
- `backlogsync roadmap`: `ROADMAP.md` in the layout the replaced copies produced, byte
  for byte given the same name and regenerate command (BS-2).
- `backlogsync sync`: the one-way sync to issues and milestones over the GitHub REST
  API, from `GITHUB_TOKEN` and `GITHUB_REPOSITORY`; `--dry-run` and `--milestones`; no
  delete call; a pagination link to another origin refused (BS-3).
- Configuration in `package.json#backlogsync` or `.backlogsync.json`: `prefix`, `meta`,
  `name`, `labels`, `backlog`, `roadmap`, `branch`, `regenerate` (BS-4).
- A composite action, `uses: Allan-Nava/backlogsync@<ref>`, and `release-drift.yml` as a
  reusable workflow (BS-5).
- `scripts/compat.mjs`: the roadmap and the sync plan compared with a repository's own
  script, on its real backlog and issues (BS-7).

### Changed
- Against the replaced copies: the sync applies by default and `--dry-run` plans;
  `lint` and `check` are one command; labels are ensured only when an issue is created;
  the lint also refuses an item under another prefix, an item ticked `[X]`, a repeated
  milestone title and a `prio-` label listed by hand (BS-1, BS-3).

### Fixed
- The "Source of trutm" and "Source of trugl" artefacts two copies wrote into issue
  footers and milestone descriptions (BS-3).
