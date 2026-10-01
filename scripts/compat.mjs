#!/usr/bin/env node
// Compatibility proof against repositories that still carry their own
// scripts/backlog.mjs. Contributor tooling: it reads other checkouts and writes only
// to a temporary directory, and nothing it reads or prints belongs in this repository.
//
//   node scripts/compat.mjs <repo dir> [<repo dir> …]
//     --issues    also compare the sync plan with the old script's, on the same
//                 issue list (read with `gh issue list`; read-only, no --apply)
//     --keep      keep the temporary directory and print its path
//
// For each repository: the config is derived from its scripts/backlog.mjs (prefix,
// meta key, roadmap name, labels), `backlogsync roadmap` runs over its BACKLOG.md into
// the temporary directory, and the result is compared byte for byte with the
// ROADMAP.md it has committed. `backlogsync check` runs too, so the stricter lint is
// tried on a real backlog. Exit 1 if any repository differs.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../bin/lib/backlog.mjs'
import { normalise } from '../bin/lib/config.mjs'
import { existingFromIssues, plan } from '../bin/lib/plan.mjs'

const CLI = fileURLToPath(new URL('../bin/backlogsync.mjs', import.meta.url))
const argv = process.argv.slice(2)
const withIssues = argv.includes('--issues')
const keep = argv.includes('--keep')
const dirs = argv.filter((a) => !a.startsWith('--')).map((d) => resolve(d))
if (!dirs.length) {
  console.error('usage: node scripts/compat.mjs <repo dir> [<repo dir> …] [--issues] [--keep]')
  process.exit(2)
}

// What the old script hard-codes, read off its source without running it.
export function deriveConfig(src) {
  const prefix = src.match(/\\\*\\\*\(([A-Z][A-Z0-9]*)-\(\\d\+\)\)/)?.[1]
  const meta = src.match(/meta\(raw, '([a-z0-9-]+)'\)/)?.[1]
  const name = src.match(/'# Roadmap — ([^']+)'/)?.[1]
  const repo = src.match(/REPO_BLOB = 'https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//)?.[1]
  const block = src.match(/const LABELS = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const labels = {}
  for (const m of block.matchAll(/^\s*'?([\w-]+)'?: \['([0-9a-fA-F]{6})', '((?:[^'\\]|\\.)*)'\],?$/gm)) labels[m[1]] = [m[2], m[3]]
  if (!prefix || !meta || !name) throw new Error('could not read prefix, meta key and name off scripts/backlog.mjs')
  return { config: { prefix, meta, name, labels, regenerate: 'node scripts/backlog.mjs roadmap' }, repo }
}

const tmp = mkdtempSync(join(tmpdir(), 'backlogsync-compat-'))
let failed = 0
const rows = []

for (const dir of dirs) {
  const label = basename(dir)
  const out = join(tmp, label)
  const report = { repo: label, roadmap: '', check: '', plan: withIssues ? '' : 'not run' }
  try {
    const old = join(dir, 'scripts', 'backlog.mjs')
    if (!existsSync(old)) throw new Error('no scripts/backlog.mjs')
    const { config, repo } = deriveConfig(readFileSync(old, 'utf8'))
    execFileSync('mkdir', ['-p', out])
    const cfgPath = join(out, 'backlogsync.json')
    writeFileSync(cfgPath, JSON.stringify(config, null, 2))
    const run = (cmd, roadmapPath) =>
      spawnSync(process.execPath, [CLI, cmd, '--config', cfgPath, '--backlog', join(dir, 'BACKLOG.md'), '--roadmap', roadmapPath], { encoding: 'utf8' })

    const gen = run('roadmap', join(out, 'ROADMAP.md'))
    if (gen.status !== 0) throw new Error(`roadmap exited ${gen.status}:\n${gen.stderr.trim()}`)
    const want = readFileSync(join(dir, 'ROADMAP.md'), 'utf8')
    const got = readFileSync(join(out, 'ROADMAP.md'), 'utf8')
    if (got === want) report.roadmap = `identical (${Buffer.byteLength(got)} bytes)`
    else {
      failed++
      const d = spawnSync('diff', ['-u', join(dir, 'ROADMAP.md'), join(out, 'ROADMAP.md')], { encoding: 'utf8' })
      report.roadmap = `DIFFERS\n${d.stdout}`
    }

    const chk = run('check', join(dir, 'ROADMAP.md'))
    report.check = chk.status === 0 ? 'ok' : `exit ${chk.status}: ${(chk.stderr || chk.stdout).trim()}`
    if (chk.status !== 0) failed++

    if (withIssues) {
      if (!repo) throw new Error('no REPO_BLOB to read the repository from')
      const list = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', repo, '--state', 'all', '--limit', '500', '--json', 'number,title,state,milestone'], { encoding: 'utf8' }))
      const tsv = list.map((i) => [i.title.split(' — ')[0], i.number, i.state.toLowerCase(), i.title, i.milestone?.title ?? ''].join('\t')).join('\n')
      const snap = join(out, 'issues.tsv')
      writeFileSync(snap, `${tsv}\n`)
      const oldPlan = spawnSync(process.execPath, [old, 'issues'], {
        encoding: 'utf8',
        env: { ...process.env, BACKLOG_FILE: join(dir, 'BACKLOG.md'), ROADMAP_FILE: join(out, 'unused.md'), BACKLOG_ISSUES_SNAPSHOT: snap },
      })
      if (oldPlan.status !== 0) throw new Error(`old planner exited ${oldPlan.status}: ${oldPlan.stderr.trim()}`)
      const oldActions = oldPlan.stdout.split('\n').filter((l) => /^[A-Z]+\t/.test(l)).map((l) => l.split('\t'))
      const cfg = normalise(config, { root: dir })
      const model = parse(readFileSync(join(dir, 'BACKLOG.md'), 'utf8'), cfg)
      const newActions = plan(model, existingFromIssues(list.map((i) => ({ ...i, state: i.state.toLowerCase() })), cfg))
      const same = JSON.stringify(oldActions) === JSON.stringify(newActions)
      const busy = newActions.filter((a) => !['OK', 'SKIP'].includes(a[0])).length
      report.plan = same ? `same ${newActions.length} actions as the old planner (${busy} would change something), ${list.length} issues read` : `DIFFERS\nold: ${JSON.stringify(oldActions)}\nnew: ${JSON.stringify(newActions)}`
      if (!same) failed++
    }
  } catch (e) {
    failed++
    report.roadmap ||= `error: ${e.message}`
  }
  rows.push(report)
}

for (const r of rows) {
  console.log(`== ${r.repo}`)
  console.log(`   roadmap: ${r.roadmap}`)
  console.log(`   check:   ${r.check}`)
  console.log(`   plan:    ${r.plan}`)
}
if (keep) console.log(`\nkept ${tmp}`)
else rmSync(tmp, { recursive: true, force: true })
console.log(`\n${rows.length - new Set(rows.filter((r) => !/^identical/.test(r.roadmap) || r.check !== 'ok' || /^DIFFERS/.test(r.plan)).map((r) => r.repo)).size}/${rows.length} repositories in step`)
process.exitCode = failed ? 1 : 0
