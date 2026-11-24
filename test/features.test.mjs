// BS-20 to BS-23: closing finished milestones, the phase warnings, the next id, and the
// issue body kept in step. Each is off or silent unless asked for, so the tests also check
// that a repository without the keys sees exactly what it saw before.
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main } from '../bin/backlogsync.mjs'
import { nextId, parse, phaseWarnings, roadmap } from '../bin/lib/backlog.mjs'
import { normalise } from '../bin/lib/config.mjs'
import { client } from '../bin/lib/github.mjs'
import { existingFromIssues, existingMilestones, plan, summarise } from '../bin/lib/plan.mjs'
import { issueBody, sync } from '../bin/lib/sync.mjs'
import { fakeGitHub } from './helpers/fake-github.mjs'

const base = { prefix: 'DM', name: 'demo' }
const BACKLOG = `# Backlog — demo

## v0.1.0 — Done and released <!-- ms: phase=shipped -->

- [x] **DM-1 — Shipped**: done. <!-- dm: prio=high size=S labels=core ver=0.1.0 -->
- [x] **DM-2 — Shipped too**: done. <!-- dm: prio=low size=S labels=core ver=0.1.0 -->

## v0.2.0 — Done, not released <!-- ms: phase=now -->

- [x] **DM-3 — Merged**: on main. <!-- dm: prio=med size=M labels=core ver=main -->

## v0.3.0 — Shipped, then reopened <!-- ms: phase=shipped -->

- [ ] **DM-5 — Reopened**: work again. <!-- dm: prio=med size=S labels=core -->

## v0.4.0 — In progress <!-- ms: phase=next -->

- [ ] **DM-4 — Open**: body text. <!-- dm: prio=med size=S labels=core -->
`
const model = parse(BACKLOG, normalise(base))

test('phase warnings: shipped with open items, and done but not shipped (BS-21)', () => {
  const w = phaseWarnings(model, normalise(base))
  assert.deepEqual(w, [
    'BACKLOG.md:8: warning: every item of "v0.2.0 — Done, not released" is done but its phase is now: phase=shipped once it is released',
    'BACKLOG.md:12: warning: "v0.3.0 — Shipped, then reopened" is phase=shipped but 1 of its 1 items is open',
  ])
})

test('next is one past the highest id, a gap is not reused (BS-22)', () => {
  assert.equal(nextId(model, normalise(base)), 'DM-6')
  const fenced = parse('# B\n\n```\n- [ ] **DM-99 — Example**: x. <!-- dm: prio=low size=S labels=core -->\n```\n', normalise(base))
  assert.equal(nextId(fenced, normalise(base)), 'DM-1', 'an example in a fenced block does not count')
})

test('the CLI: next prints the id, check warns on stderr and still exits 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-features-'))
  writeFileSync(join(dir, '.backlogsync.json'), JSON.stringify(base))
  writeFileSync(join(dir, 'BACKLOG.md'), BACKLOG)
  writeFileSync(join(dir, 'ROADMAP.md'), roadmap(model, normalise({ ...base })))
  const out = []
  const err = []
  const run = (...argv) => main([...argv, '--config', join(dir, '.backlogsync.json')], {}, (l) => out.push(l), (l) => err.push(l))
  assert.equal(await run('next'), 0)
  assert.equal(out.at(-1), 'DM-6')
  assert.equal(await run('check'), 0)
  assert.equal(err.filter((l) => l.includes('warning:')).length, 2)
})

test('milestones: closed when finished, reopened when not, only with closeMilestones (BS-20)', () => {
  const ms = existingMilestones([
    { title: 'v0.1.0 — Done and released', number: 1, state: 'open' },
    { title: 'v0.2.0 — Done, not released', number: 2, state: 'open' },
    { title: 'v0.3.0 — Shipped, then reopened', number: 3, state: 'closed' },
    { title: 'v0.4.0 — In progress', number: 4, state: 'open' },
  ])
  const on = normalise({ ...base, closeMilestones: true })
  const actions = plan(model, new Map(), [], on, { milestones: ms }).filter((a) => a[0].endsWith('MILESTONE'))
  assert.deepEqual(actions, [
    ['CLOSE-MILESTONE', 'v0.1.0 — Done and released', '1'],
    ['REOPEN-MILESTONE', 'v0.3.0 — Shipped, then reopened', '3'],
  ])
  assert.match(summarise(actions, on), / · 1 milestones to close · 1 to reopen$/)
  const off = normalise(base)
  assert.deepEqual(plan(model, new Map(), [], off, { milestones: ms }).filter((a) => a[0].endsWith('MILESTONE')), [])
  assert.doesNotMatch(summarise([], off), /milestones/, 'the summary keeps its old shape without the key')
})

test('body: rewritten when the item changed, only with syncBody (BS-23)', () => {
  const on = normalise({ ...base, syncBody: true })
  const it = model.items.find((i) => i.id === 'DM-4')
  const want = issueBody(it, on, { repo: 'octo/demo' })
  const issues = [{ number: 9, title: 'DM-4 — Open', state: 'open', milestone: { title: 'v0.4.0 — In progress' }, body: 'old text' }]
  const existing = existingFromIssues(issues, on)
  assert.deepEqual(plan(model, existing, [], on, { bodies: new Map([['DM-4', want]]) }).filter((a) => a[0] === 'BODY'), [['BODY', 'DM-4', '9']])
  const same = existingFromIssues([{ ...issues[0], body: want.replace(/\n/g, '\r\n') }], on)
  assert.deepEqual(plan(model, same, [], on, { bodies: new Map([['DM-4', want]]) }).filter((a) => a[0] === 'BODY'), [], 'CRLF from GitHub is not a change')
  assert.deepEqual(plan(model, existing, [], normalise(base), { bodies: new Map([['DM-4', want]]) }).filter((a) => a[0] === 'BODY'), [])
})

test('config: both keys are booleans, off by default', () => {
  assert.equal(normalise(base).closeMilestones, false)
  assert.equal(normalise(base).syncBody, false)
  assert.throws(() => normalise({ ...base, closeMilestones: 'yes' }), /closeMilestones must be true or false/)
  assert.throws(() => normalise({ ...base, syncBody: 1 }), /syncBody must be true or false/)
})

test('a sync with both keys: PATCHes the milestone and the body, never a DELETE; a dry run writes nothing', async () => {
  const fake = await fakeGitHub({
    issues: [{ number: 9, title: 'DM-4 — Open', state: 'open', milestone: { number: 4, title: 'v0.4.0 — In progress' }, body: 'old text', labels: ['core', 'prio-med'] }],
    milestones: [
      { title: 'v0.1.0 — Done and released' },
      { title: 'v0.2.0 — Done, not released' },
      { title: 'v0.3.0 — Shipped, then reopened', state: 'closed' },
      { title: 'v0.4.0 — In progress' },
    ],
    labels: ['core', 'prio-med'],
  })
  try {
    const gh = client({ token: fake.token, repo: fake.repo, apiUrl: fake.url })
    const cfg = normalise({ ...base, closeMilestones: true, syncBody: true })
    await sync(model, cfg, gh, { dryRun: true, log: () => {} })
    assert.deepEqual(fake.writes(), [])

    await sync(model, cfg, gh, { log: () => {}, server: 'https://github.example' })
    assert.equal(fake.state.milestones[0].state, 'closed')
    assert.equal(fake.state.milestones[2].state, 'open')
    assert.equal(fake.state.milestones[3].state, 'open')
    assert.ok(fake.state.issues[0].body.startsWith('body text.'))
    assert.ok(fake.writes().every((r) => r.method !== 'DELETE'))

    const again = []
    await sync(model, cfg, gh, { log: (l) => again.push(l), server: 'https://github.example' })
    assert.match(again.find((l) => l.includes(' ok ')), /0 to rewrite .* 0 milestones to close · 0 to reopen$/, 'a second run finds nothing to do')
  } finally {
    await fake.close()
  }
})
