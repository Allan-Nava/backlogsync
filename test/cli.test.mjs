// The CLI from the outside: a child process, a temporary repository, exit codes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fakeGitHub } from './helpers/fake-github.mjs'

const CLI = fileURLToPath(new URL('../bin/backlogsync.mjs', import.meta.url))
const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url))
const cleanup = []
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })))

// A Go-style repository: no package.json, only .backlogsync.json.
function repo() {
  const d = mkdtempSync(join(tmpdir(), 'bs-cli-'))
  cleanup.push(d)
  copyFileSync(join(FIX, 'config.json'), join(d, '.backlogsync.json'))
  copyFileSync(join(FIX, 'backlog.md'), join(d, 'BACKLOG.md'))
  return d
}

// Asynchronous on purpose: the fake API lives in this process, and a synchronous
// spawn would block the event loop it answers on.
function run(args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GITHUB_|GH_)/.test(k)))
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...clean, ...env } })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (c) => (stdout += c))
    p.stderr.on('data', (c) => (stderr += c))
    p.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

test('roadmap writes ROADMAP.md, and check then passes', async () => {
  const d = repo()
  const w = await run(['roadmap'], { cwd: d })
  assert.equal(w.status, 0, w.stderr)
  assert.equal(readFileSync(join(d, 'ROADMAP.md'), 'utf8'), readFileSync(join(FIX, 'roadmap.expected.md'), 'utf8'))
  const c = await run(['check'], { cwd: d })
  assert.equal(c.status, 0, c.stderr)
  assert.match(c.stdout, /ok — 7 items, 2 milestones; ROADMAP\.md is in step with BACKLOG\.md/)
})

test('check fails on a stale roadmap and on a missing one, naming the fix', async () => {
  const d = repo()
  const missing = await run(['check'], { cwd: d })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /ROADMAP\.md is missing — run `npx backlogsync roadmap`/)
  writeFileSync(join(d, 'ROADMAP.md'), 'old\n')
  const stale = await run(['check'], { cwd: d })
  assert.equal(stale.status, 1)
  assert.match(stale.stderr, /ROADMAP\.md is stale/)
})

test('a backlog problem fails every command with file:line, before anything is written', async () => {
  const d = repo()
  writeFileSync(join(d, 'BACKLOG.md'), '## v1.0.0 — A <!-- ms: phase=now -->\n- [ ] **DM-1 — a**: b.\n')
  for (const cmd of ['check', 'roadmap', 'sync']) {
    const r = await run([cmd], { cwd: d, env: { GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'octo/demo', GITHUB_API_URL: 'http://127.0.0.1:9' } })
    assert.equal(r.status, 1, cmd)
    assert.match(r.stderr, /BACKLOG\.md:2: DM-1 has no <!-- dm: \.\.\. --> metadata/)
  }
  assert.throws(() => readFileSync(join(d, 'ROADMAP.md')), /ENOENT/)
})

test('usage and configuration errors exit 2', async () => {
  const d = repo()
  assert.equal((await run(['nope'], { cwd: d })).status, 2)
  assert.equal((await run(['check', '--bogus'], { cwd: d })).status, 2)
  assert.equal((await run(['check', 'extra'], { cwd: d })).status, 2)
  assert.equal((await run(['check', '--dry-run'], { cwd: d })).status, 2, '--dry-run belongs to sync')
  const empty = mkdtempSync(join(tmpdir(), 'bs-cli-'))
  cleanup.push(empty)
  const none = await run(['check'], { cwd: empty })
  assert.equal(none.status, 2)
  assert.match(none.stderr, /no configuration/)
})

test('help and --version exit 0', async () => {
  const h = await run(['help'])
  assert.equal(h.status, 0)
  assert.match(h.stdout, /backlogsync sync/)
  const v = await run(['--version'])
  assert.equal(v.stdout.trim(), JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
})

test('sync without a token refuses to change anything, exit 2', async () => {
  const d = repo()
  const r = await run(['sync'], { cwd: d, env: { GITHUB_REPOSITORY: 'octo/demo', GITHUB_API_URL: 'http://127.0.0.1:9' } })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /GITHUB_TOKEN is not set/)
})

test('sync from the environment against the fake API, with a step summary', async () => {
  const d = repo()
  const fake = await fakeGitHub({ issues: JSON.parse(readFileSync(join(FIX, 'issues.json'), 'utf8')) })
  try {
    const summary = join(d, 'summary.md')
    const env = { GITHUB_TOKEN: fake.token, GITHUB_REPOSITORY: fake.repo, GITHUB_API_URL: fake.url, GITHUB_STEP_SUMMARY: summary }
    const dry = await run(['sync', '--dry-run'], { cwd: d, env })
    assert.equal(dry.status, 0, dry.stderr)
    assert.equal(fake.writes().length, 0)
    assert.match(readFileSync(summary, 'utf8'), /### Backlog issue sync — dry run/)

    const only = await run(['sync', '--milestones', 'v0.2.0'], { cwd: d, env })
    assert.equal(only.status, 0, only.stderr)
    assert.ok(!fake.state.issues.some((i) => i.title.startsWith('DM-3 — Open with no issue')), 'v0.1.0 untouched')
    assert.equal(fake.state.issues.find((i) => i.number === 14).title, 'DM-5 — Renamed in the backlog')

    const full = await run(['sync'], { cwd: d, env })
    assert.equal(full.status, 0, full.stderr)
    assert.match(full.stdout, /created DM-3 {2}#\d+/)
    assert.match(full.stdout, /1 to create · 0 to retitle · 0 to move · 1 to close · 1 to reopen/)
  } finally {
    await fake.close()
  }
})

test('an API failure exits 1 with the status', async () => {
  const d = repo()
  const fake = await fakeGitHub({})
  try {
    const r = await run(['sync'], { cwd: d, env: { GITHUB_TOKEN: 'wrong', GITHUB_REPOSITORY: fake.repo, GITHUB_API_URL: fake.url } })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /401 Bad credentials/)
  } finally {
    await fake.close()
  }
})
