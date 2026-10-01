// The sync against a fake GitHub API on a local port — never the real one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '../bin/lib/backlog.mjs'
import { normalise } from '../bin/lib/config.mjs'
import { client } from '../bin/lib/github.mjs'
import { CLOSE_COMMENT, REOPEN_COMMENT, sync } from '../bin/lib/sync.mjs'
import { fakeGitHub } from './helpers/fake-github.mjs'

const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const cfg = normalise(JSON.parse(fixture('config.json')))
const model = parse(fixture('backlog.md'), cfg)
const seed = () => ({
  issues: JSON.parse(fixture('issues.json')),
  milestones: [{ title: 'v0.1.0 — First light' }, { title: 'v0.2.0 — Second light' }],
  labels: ['core'],
})
const quiet = () => {}

async function withFake(opts, fn) {
  const fake = await fakeGitHub(opts)
  try {
    return await fn(fake, client({ token: fake.token, repo: fake.repo, apiUrl: fake.url }))
  } finally {
    await fake.close()
  }
}

test('--dry-run reads and changes nothing', () =>
  withFake(seed(), async (fake, gh) => {
    const lines = []
    const res = await sync(model, cfg, gh, { dryRun: true, log: (l) => lines.push(l) })
    assert.deepEqual(fake.writes(), [])
    assert.equal(res.applied.length, 0)
    assert.ok(lines.includes('CREATE\tDM-3\t-'))
    assert.ok(lines.includes('(dry run — nothing changed)'))
  }))

test('a sync applies every decision, then a second sync finds nothing to do', () =>
  withFake(seed(), async (fake, gh) => {
    await sync(model, cfg, gh, { log: quiet, server: 'https://github.example' })
    const byNum = (n) => fake.state.issues.find((i) => i.number === n)

    // CREATE: title, body, milestone by number, labels plus the priority label.
    const created = fake.state.issues.find((i) => i.title === 'DM-3 — Open with no issue')
    assert.ok(created, 'DM-3 was created')
    assert.equal(created.milestone.title, 'v0.1.0 — First light')
    assert.deepEqual(created.labels.map((l) => l.name), ['core', 'docs', 'prio-med'])
    assert.ok(created.body.startsWith('the sync creates it, with a body that spans two lines'))
    assert.ok(created.body.includes('https://github.example/octo/demo/blob/main/BACKLOG.md'))
    assert.ok(!created.body.includes('<!--'), 'no metadata comment in the body')

    // Labels: the configured ones and the priority labels, created once, with colours.
    assert.deepEqual(fake.state.labels.map((l) => l.name).sort(), ['core', 'docs', 'prio-high', 'prio-low', 'prio-med'])
    assert.equal(fake.state.labels.find((l) => l.name === 'docs').color, '0075ca')

    assert.equal(byNum(11).state, 'closed', 'DM-1 closed')
    assert.equal(byNum(11).state_reason, 'completed')
    assert.equal(byNum(13).state, 'open', 'DM-4 reopened')
    assert.equal(byNum(14).title, 'DM-5 — Renamed in the backlog', 'DM-5 retitled')
    assert.equal(byNum(15).milestone.title, 'v0.2.0 — Second light', 'DM-6 moved')
    assert.deepEqual(fake.state.comments, [
      { issue: 11, body: CLOSE_COMMENT },
      { issue: 13, body: REOPEN_COMMENT },
    ])
    assert.equal(byNum(17).title, 'DM-7 — A later duplicate, ignored', 'the duplicate is left alone')
    assert.equal(byNum(18).title, 'DM-3 — A pull request is not an issue', 'the pull request is left alone')
    assert.equal(fake.state.milestones.length, 2, 'no milestone created when it exists')

    const before = fake.writes().length
    const again = await sync(model, cfg, gh, { log: quiet })
    assert.equal(fake.writes().length, before, 'the second run sent no write')
    assert.deepEqual(new Set(again.actions.map((a) => a[0])), new Set(['OK', 'SKIP']))
  }))

test('a missing milestone is created once, with the source-of-truth description', () =>
  withFake({}, async (fake, gh) => {
    await sync(model, cfg, gh, { log: quiet })
    assert.deepEqual(fake.state.milestones.map((m) => m.title), ['v0.1.0 — First light', 'v0.2.0 — Second light'])
    assert.equal(fake.state.milestones[0].description, 'Backlog milestone. Source of truth: BACKLOG.md')
    assert.equal(fake.state.issues.length, 5, 'one issue per open item; shipped items with no issue are skipped')
    assert.equal(fake.writes().filter((r) => r.path.endsWith('/milestones')).length, 2)
  }))

test('the sync never sends DELETE, and every write carries the token and the API version', () =>
  withFake(seed(), async (fake, gh) => {
    await sync(model, cfg, gh, { log: quiet })
    assert.ok(fake.state.requests.length > 0)
    assert.ok(!fake.state.requests.some((r) => r.method === 'DELETE'))
    for (const r of fake.writes()) assert.equal(r.auth, `Bearer ${fake.token}`)
    for (const r of fake.state.requests) assert.equal(r.apiVersion, '2022-11-28')
  }))

test('pagination follows the Link header across every page', () =>
  withFake(
    {
      pageSize: 2,
      issues: Array.from({ length: 7 }, (_, i) => ({ number: i + 1, title: `Filed by hand ${i}`, state: 'open', milestone: null })).concat([
        { number: 9, title: 'DM-7 — Already right', state: 'open', milestone: { title: 'v0.2.0 — Second light' } },
      ]),
    },
    async (fake, gh) => {
      const res = await sync(model, cfg, gh, { dryRun: true, log: quiet })
      assert.deepEqual(res.actions.find((a) => a[1] === 'DM-7'), ['OK', 'DM-7', '9'], 'the issue on the last page was seen')
      assert.equal(fake.state.requests.filter((r) => r.path.endsWith('/issues')).length, 4)
    },
  ))

test('with no labels configured, an unknown label is created grey rather than failing', () =>
  withFake({}, async (fake, gh) => {
    const open = normalise({ prefix: 'DM' })
    const m = parse('## v1.0.0 — A <!-- ms: phase=now -->\n- [ ] **DM-1 — a**: b. <!-- dm: prio=low size=S labels=fresh -->\n', open)
    await sync(m, open, gh, { log: quiet })
    assert.equal(fake.state.labels.find((l) => l.name === 'fresh').color, 'ededed')
    assert.deepEqual(fake.state.issues[0].labels.map((l) => l.name), ['fresh', 'prio-low'])
  }))

test('a rejected write stops the sync with the status, and never prints the token', () =>
  withFake(seed(), async (fake) => {
    const gh = client({ token: 'wrong', repo: fake.repo, apiUrl: fake.url })
    await assert.rejects(sync(model, cfg, gh, { log: quiet }), (e) => e.status === 401 && /401 Bad credentials/.test(e.message) && !e.message.includes('wrong'))
  }))

test('a pagination link to another origin is refused, so the token cannot follow it', async () => {
  const http = await import('node:http')
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', link: '<http://elsewhere.invalid/steal?page=2>; rel="next"' })
    res.end('[]')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const gh = client({ token: 'x', repo: 'octo/demo', apiUrl: `http://127.0.0.1:${server.address().port}` })
    await assert.rejects(gh.issues(), /refusing to follow http:\/\/elsewhere\.invalid/)
  } finally {
    await new Promise((r) => server.close(r))
  }
})

test('the repository must be owner/name', () => {
  assert.throws(() => client({ repo: 'nope' }), /GITHUB_REPOSITORY must be owner\/name/)
  assert.throws(() => client({}), /GITHUB_REPOSITORY must be owner\/name/)
})
