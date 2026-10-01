# Contributing

## Local loop

Nothing to build. Node 18 or later; `npm install` only for the site build.

```bash
npm test              # backlogsync check on BACKLOG.md, scripts/repo-check.mjs, node --test
npm run build:site    # site/dist/index.html from README.md
```

The tests never reach GitHub. `test/helpers/fake-github.mjs` is a REST API on a local
port — issues, labels, milestones and comments in memory, paginated with Link headers —
and it records every request, so a test asserts what was sent and what was not. A
change in how the real API behaves goes in the fake first, then in a test, then in the
code. Fixtures are synthetic: no real backlog, issue or repository name goes in
`test/`.

To try the CLI by hand against a public repository, read-only:

```bash
GITHUB_REPOSITORY=<owner>/<repo> node bin/backlogsync.mjs sync --dry-run
```

## The compatibility proof

`scripts/compat.mjs` runs over checkouts of repositories that still carry their own
`scripts/backlog.mjs`, writing only to a temporary directory:

```bash
node scripts/compat.mjs ../repo-a ../repo-b --issues
```

It derives each config from the old script, compares the generated roadmap with the
committed one byte for byte, runs `check`, and with `--issues` compares the sync plans
on the issues `gh issue list` reads. Run it before a change to the format, the lint, the
roadmap or the planner. Its output is about other repositories: never paste it into this
one, and never copy a backlog in as a fixture.

## What must not be published

This repository is public. Never commit a private repository, host or service name, a
client name, an absolute path under a home directory, a work email address or anything
that looks like a key. `npm test` refuses those shapes in any tracked file, and CI's
`own-history` job runs the same check over every commit. Private names cannot be listed
in a public file: before a push, run the check with your own list, kept outside the
repository —

```bash
LEAK_TERMS=<file outside the repo, one term per line> node scripts/repo-check.mjs --history
```

## Backlog, roadmap, issues

`BACKLOG.md` is the single source of truth, ids `BS-n`. After editing it run
`node bin/backlogsync.mjs roadmap` and commit `ROADMAP.md` in the same commit. The
issues follow on push to `main` (`backlog-issues.yml`, which runs this checkout's own
action), one way only.

## Pull requests

One concern per pull request; `npm test` green; a CHANGELOG entry under
`[Unreleased]` with the `BS-n` id; the backlog ticked with `ver=main` when an item ships.
`main` is protected: changes land through a pull request with CI green.

## Releasing

Releases run from GitHub Actions; pushing the tag is the manual step, and
`release-drift.yml` fails when `main` carries a version with no tag for two hours —
unless the CHANGELOG heading for that version says `not released`, as 0.0.1's does.

**The first publish is by hand.** npm cannot configure a trusted publisher for a package
that does not exist, so the first version, 0.1.0, is published by the maintainer (BS-9).
The release PR bumps the version and merges first; then, in this order:

1. On a clean checkout of `main` at the merged release commit, `npm login`, then
   `npm publish --access public`.
2. Configure the trusted publisher — with `npm trust` (npm 11.15 or later), or on
   npmjs.com → package → Settings → Trusted Publisher → GitHub Actions: owner
   `Allan-Nava` exactly, repository `backlogsync` (the name, not the URL), workflow
   `release.yml`, environment empty.
3. Push the tag `backlogsync--v0.1.0`. `release.yml` sees the version already on the
   registry, skips the publish, and still cuts the GitHub release and closes the
   milestone.

```bash
git checkout main && git pull --ff-only
git status --short                     # must print nothing: a clean checkout
node -p "require('./package.json').version"   # 0.1.0
npm test && npm pack --dry-run
npm login
npm publish --access public
npm trust github backlogsync --repo Allan-Nava/backlogsync --file release.yml --allow-publish
git tag backlogsync--v0.1.0 && git push origin backlogsync--v0.1.0
```

The three steps belong together, in one sitting: `release-drift.yml` fails once the
merged version has gone two hours without its tag, and the daily run keeps failing
until the tag is pushed. Then tick BS-9 with `ver=0.1.0`, and set the v0.1.0 heading's
phase to `shipped`, in a pull request. The milestone closes only with no open issue in it, so if BS-9's issue was still open when
the tag ran, re-run the release once the sync has closed it —
`gh workflow run Release -f tag=backlogsync--v0.1.0` skips everything already done.
Never give `actions/setup-node` a `registry-url`; never rename `release.yml`.

**Every later release:**

```bash
# 1. bump package.json's version (and the lockfile: npm install --package-lock-only)
#    rename CHANGELOG's [Unreleased] to [x.y.z] — date, open a new empty [Unreleased]
#    turn every ver=main in BACKLOG.md into ver=x.y.z, regenerate the roadmap
npm test
# 2. land the bump on main through a pull request, then tag that merge commit
git checkout main && git pull
git tag backlogsync--v{version} && git push origin backlogsync--v{version}
```

The tag triggers `release.yml`: version check, tests, publish over OIDC, wait for the
registry, GitHub release, close the milestone whose title starts with `v{version}`.
Re-run with `gh workflow run Release -f tag=backlogsync--v{version}`; every step is
idempotent. The notes open with the version's CHANGELOG section
(`scripts/release-notes.mjs`).

A tag is also a ref the action and the reusable workflow can be pinned to:
`uses: Allan-Nava/backlogsync@backlogsync--v{version}`.
