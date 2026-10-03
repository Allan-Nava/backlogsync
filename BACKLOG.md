# Backlog — backlogsync

Single source of truth for what is planned. Items keep a stable `BS-n` id so commits,
the CHANGELOG and the issues can reference them. New ideas go here rather than into
scattered TODO comments.

[ROADMAP.md](ROADMAP.md) is a **generated** view of this file, grouped by milestone. Do
not edit it by hand — run `node bin/backlogsync.mjs roadmap` after touching this file,
or CI fails. The GitHub issues are another generated view, synced one way by backlogsync
itself on every push to `main` that changes this file.

## How to write an item

```
## v0.2.0 — Title of the milestone <!-- ms: phase=next -->

- [ ] **BS-99 — Short name**: what it is, why it earns its place, what it needs to
  touch. <!-- bs: prio=high size=M labels=sync -->
```

- The **id never changes**; a new item takes the next free number.
- `- [ ]` open, `- [x]` shipped with `ver=x.y.z` (or `ver=main` when merged, unreleased);
  an open item carries no `ver`.
- `prio` is `high`, `med` or `low`; `size` is `S`, `M`, `L` or `XL`; `labels` come from
  `package.json#backlogsync.labels`.

## v0.1.0 — One repository in step <!-- ms: phase=now -->

0.0.1 is the tool, its tests and this repository, in the repository only. 0.1.0 is the
first version on npm, and it waits on one real repository running on backlogsync.

- [x] **BS-1 — The format, read**: `parse` and `lint` over the superset of the seven
  copies: milestone headings with `<!-- ms: phase=… -->`, items with the configured
  prefix and meta key, the same fault list, plus four faults the copies let pass
  silently. <!-- bs: prio=high size=M labels=cli ver=0.1.0 -->
- [x] **BS-2 — roadmap and check**: `ROADMAP.md` in the layout every copy produced,
  byte for byte given the same name and regenerate command; `check` fails on a lint
  error and on a stale or missing roadmap. <!-- bs: prio=high size=S labels=cli ver=0.1.0 -->
- [x] **BS-3 — sync over the REST API**: the planner of the copies — create, close,
  reopen, retitle, move — with `--dry-run` and `--milestones`, on `node:http(s)` with no
  `gh` CLI; no delete call exists; the token never follows a link to another origin.
  <!-- bs: prio=high size=M labels=sync ver=0.1.0 -->
- [x] **BS-4 — Configuration**: `package.json#backlogsync` or `.backlogsync.json`, one
  of them, validated with unknown keys refused; the label set in both shapes.
  <!-- bs: prio=high size=S labels=cli ver=0.1.0 -->
- [x] **BS-5 — The action and the reusable release-drift workflow**: a composite
  `action.yml` running the CLI from the action's checkout, inputs passed as environment
  variables; `release-drift.yml` callable with `version-file`, `tag-prefix`,
  `grace-hours` and `changelog`. <!-- bs: prio=high size=M labels=action ver=0.1.0 -->
- [x] **BS-6 — Tests**: `node:test` over the format, the config, the planner, the CLI
  and the sync, the last against a fake GitHub API on a local port; synthetic fixtures
  only. <!-- bs: prio=high size=M labels=tests ver=0.1.0 -->
- [x] **BS-7 — The compatibility proof**: `scripts/compat.mjs` over checkouts of the
  seven repositories, roadmap byte-identical and plan identical in all seven on
  2026-10-01; it writes only to a temporary directory.
  <!-- bs: prio=high size=S labels=migration,tests ver=0.1.0 -->
- [x] **BS-8 — The repository**: CI on Node 18 to 24, the own-history leak check,
  `npm pack`, CodeQL, Pages from the README, the release and drift workflows, and this
  backlog synced by the tool itself. <!-- bs: prio=med size=M labels=project,release ver=0.1.0 -->
- [x] **BS-9 — First publish by hand, then trusted publishing**: npm cannot configure a
  trusted publisher for a package that does not exist, so the maintainer publishes 0.1.0
  from a clean checkout of `main` at the merged release commit, configures the trusted
  publisher (`Allan-Nava`, `backlogsync`, `release.yml`, no environment), then pushes the
  tag; `release.yml` skips the publish and cuts the release. CONTRIBUTING has the steps.
  Open until the publish: the maintainer ticks it with `ver=0.1.0` afterwards. Done 2026-10-03: 0.1.0 published by hand on 2026-10-01;
  the trusted publisher is confirmed by 0.1.1, which `release.yml` published over OIDC.
  <!-- bs: prio=high size=S labels=release ver=0.1.0 -->
- [x] **BS-10 — The 0.1.0 gate: one repository migrated, its sync observed**: pick one
  of BS-11 to BS-17 as the pilot and move its item here; migrate it with the action
  pinned by commit; push a backlog change and watch the sync on GitHub do what its old
  script would have — the plan printed, the issue opened or closed, nothing else
  touched. Record the run in the CHANGELOG. Done 2026-10-01: skilltrigger (BS-15), its
  PR #15 merged; the push ran `backlog-issues.yml` through the action at `974f2bd` and
  printed `1 to create · 0 to retitle · 0 to move · 0 to close · 0 to reopen · 11 ok · 11
  skipped`, then created ST-23 as issue #16 under its milestone with `project,prio-low`
  — the plan the local dry run had printed against the same issues. The reusable
  `release-drift.yml` reported "0.0.1 is marked not released" and passed.
  <!-- bs: prio=high size=M labels=migration ver=0.1.0 -->
- [x] **BS-15 — Migrate skilltrigger**: prefix `ST`, `package.json`, tags
  `skilltrigger--v<version>`; the one copy whose `prio-med` colour is `e4b429`, kept
  through its `labels`. Done 2026-10-01 as the BS-10 pilot (skilltrigger ST-22): ROADMAP
  diff the generated-by line and the regenerate command only.
  <!-- bs: prio=med size=S labels=migration ver=0.1.0 -->
- [x] **BS-19 — Running a pinned commit locally**: `npx github:Allan-Nava/backlogsync#<sha>`
  fails inside npm ("GitFetcher requires an Arborist constructor"), so a repository that
  pins a commit has no `npx` route for its contributors. Found in the BS-10 pilot. Done
  2026-10-01: the README documents the tarball URL, which works.
  <!-- bs: prio=med size=S labels=docs ver=0.1.0 -->

## v0.2.0 — Every copy replaced <!-- ms: phase=next -->

One item per repository that still carries its own `scripts/backlog.mjs`. Each one:
delete `scripts/backlog.mjs`, its test and fixtures; add the config (`prefix`, `meta`,
`name`, its label set, `regenerate`); point its `backlog-issues.yml` at the action and
its CI's backlog job at `check`; replace `release-drift.yml` with a call to the reusable
workflow; regenerate `ROADMAP.md` and confirm the diff is the generated-by line only.
Done after 0.1.0, by version tag rather than commit.

- [ ] **BS-11 — Migrate hookgate**: prefix `HG`, `package.json`, tags
  `hookgate--v<version>`. <!-- bs: prio=med size=S labels=migration -->
- [ ] **BS-12 — Migrate trimhook**: prefix `TH`, `package.json`, tags
  `trimhook--v<version>`. <!-- bs: prio=med size=S labels=migration -->
- [x] **BS-13 — Migrate transcriptmeter**: prefix `TM`, `package.json`, tags
  `transcriptmeter--v<version>`. Its copy carried the "Source of trutm" artefact in
  the issue footer. Done 2026-10-02: transcriptmeter TM-24, its PR #29; the sync dry run and the first
  run on `main` touched nothing.
  <!-- bs: prio=med size=S labels=migration ver=0.1.1 -->
- [x] **BS-14 — Migrate disclosegate**: prefix `DG`, `package.json`, tags
  `disclosegate--v<version>`. Its drift copy reads no not-released marker while its
  0.0.1 section opens with one, so it fails once the grace window passes; the reusable
  workflow fixes that. Done 2026-10-02: disclosegate DG-28, its PR #20; release drift now through the
  reusable workflow, which reads the DG-27 marker.
  <!-- bs: prio=high size=S labels=migration ver=0.1.1 -->
- [ ] **BS-16 — Migrate gpuledger**: a Go module — `.backlogsync.json`, prefix `GL`, a
  `VERSION` file, tags `v<version>`. Its copy carried the "Source of trugl" artefact.
  <!-- bs: prio=med size=S labels=migration -->
- [ ] **BS-17 — Migrate hlsdoctor**: a Go module — `.backlogsync.json`, prefix `HLD`,
  meta `hld`, a `VERSION` file, tags `v<version>`.
  <!-- bs: prio=med size=S labels=migration -->

## v0.3.0 — Later <!-- ms: phase=later -->

- [x] **BS-18 — Keep labels in step on existing issues**: today an issue's labels are
  set once, at creation, as every copy did; a label changed in the backlog afterwards
  does not reach the issue. Add a `LABELS` action that sets them, behind a config key so
  a repository that labels issues by hand is not overwritten. Done 2026-10-03:
  `"syncLabels": true`, off by default and refused without `labels`; it adds and removes
  only the declared labels and the `prio-` ones, with one `PATCH` of the issue's list, so
  a hand-added label stays and there is still no delete call. The plan prints
  `LABELS <id> <#> +added -removed`; the summary line counts `to relabel` only when the
  key is on. <!-- bs: prio=low size=S labels=sync,enhancement ver=0.1.1 -->
