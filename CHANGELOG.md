# Changelog

All notable changes to backlogsync. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Items reference their `BS-n` backlog id.

## [Unreleased]

### Added
- The 0.1.0 gate is met: skilltrigger migrated with the action pinned by commit, and its
  first sync on GitHub created the one issue the dry run had planned and touched nothing
  else (BS-10, BS-15).

### Changed
- The README documents running a pinned commit locally through the GitHub tarball, since
  `npx github:…` fails inside npm (BS-19).

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
