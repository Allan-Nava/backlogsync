// Every failure mode of a sync is a wrong decision — a duplicate opened on every
// push, an issue closed for open work — so the planner is tested on its own.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '../bin/lib/backlog.mjs'
import { normalise } from '../bin/lib/config.mjs'
import { existingFromIssues, plan, summarise } from '../bin/lib/plan.mjs'

const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const cfg = normalise(JSON.parse(fixture('config.json')))
const model = parse(fixture('backlog.md'), cfg)
const issues = JSON.parse(fixture('issues.json'))
const existing = existingFromIssues(issues, cfg)

export const EXPECTED = [
  ['CLOSE', 'DM-1', '11'],
  ['SKIP', 'DM-2', '-'],
  ['CREATE', 'DM-3', '-'],
  ['REOPEN', 'DM-4', '13'],
  ['RETITLE', 'DM-5', '14'],
  ['OK', 'DM-5', '14'],
  ['MILESTONE', 'DM-6', '15'],
  ['OK', 'DM-6', '15'],
  ['OK', 'DM-7', '16'],
]

test('one decision per case, in backlog order', () => {
  assert.deepEqual(plan(model, existing), EXPECTED)
  assert.deepEqual(plan(model, existing), plan(model, existing), 'deterministic')
})

test('the issues read: pull requests, other prefixes and hand-filed issues are left out', () => {
  assert.deepEqual([...existing.keys()].sort(), ['DM-1', 'DM-4', 'DM-5', 'DM-6', 'DM-7'])
})

test('two issues with one id: the oldest wins, whatever order the API returns', () => {
  assert.equal(existing.get('DM-7').num, '16')
  assert.equal(existingFromIssues([...issues].reverse(), cfg).get('DM-7').num, '16')
})

test('an issue with no milestone is moved under its heading', () => {
  const ex = existingFromIssues([{ number: 1, title: 'DM-7 — Already right', state: 'open', milestone: null }], cfg)
  assert.deepEqual(plan(model, ex).filter((a) => a[1] === 'DM-7'), [['MILESTONE', 'DM-7', '1'], ['OK', 'DM-7', '1']])
})

test('a state in capitals, as gh prints it, still reads', () => {
  const ex = existingFromIssues([{ number: 4, title: 'DM-4 — Open whose issue was closed', state: 'CLOSED', milestone: { title: 'v0.1.0 — First light' } }], cfg)
  assert.deepEqual(plan(model, ex).filter((a) => a[1] === 'DM-4'), [['REOPEN', 'DM-4', '4']])
})

test('--milestones limits the plan by version', () => {
  assert.deepEqual(plan(model, existing, ['v0.2.0']).map((a) => a[1]), ['DM-5', 'DM-5', 'DM-6', 'DM-6', 'DM-7'])
  assert.deepEqual(plan(model, existing, ['v9.0.0']), [])
})

test('an issue whose item left the backlog is never touched', () => {
  const gone = existingFromIssues([...issues, { number: 30, title: 'DM-40 — Removed from the backlog', state: 'open', milestone: null }], cfg)
  assert.ok(!plan(model, gone).some((a) => a[1] === 'DM-40'))
})

test('no action deletes anything', () => {
  const kinds = new Set(plan(model, new Map()).concat(EXPECTED).map((a) => a[0]))
  for (const k of kinds) assert.ok(['CREATE', 'RETITLE', 'MILESTONE', 'CLOSE', 'REOPEN', 'OK', 'SKIP'].includes(k))
})

test('the summary line counts each kind', () => {
  assert.equal(summarise(EXPECTED), '1 to create · 1 to retitle · 1 to move · 1 to close · 1 to reopen · 3 ok · 1 skipped')
})

// BS-18: labels kept in step on existing issues, behind `syncLabels`.
const cfgOn = { ...cfg, syncLabels: true } // normalise() validates the key: test/config.test.mjs
const labelled = [
  { number: 11, title: 'DM-1 — Shipped with an issue still open', state: 'open', milestone: { title: 'v0.1.0 — First light' }, labels: [{ name: 'core' }, { name: 'prio-high' }] },
  { number: 13, title: 'DM-4 — Open whose issue was closed', state: 'closed', milestone: { title: 'v0.1.0 — First light' }, labels: [{ name: 'docs' }, { name: 'prio-high' }] },
  { number: 16, title: 'DM-7 — Already right', state: 'open', milestone: { title: 'v0.2.0 — Second light' }, labels: [{ name: 'docs' }, { name: 'prio-high' }, { name: 'by-hand' }] },
]

test('labels: off by default, so an issue whose labels drifted is left alone', () => {
  const ex = existingFromIssues(labelled, cfg)
  assert.ok(!plan(model, ex).some((a) => a[0] === 'LABELS'))
  assert.ok(!plan(model, ex, [], cfg).some((a) => a[0] === 'LABELS'))
})

test('labels: with syncLabels, adds the missing, removes the stale, leaves an unmanaged label', () => {
  const actions = plan(model, existingFromIssues(labelled, cfgOn), [], cfgOn)
  assert.deepEqual(actions.filter((a) => a[1] === 'DM-7'), [['LABELS', 'DM-7', '16', '+core +prio-med -docs -prio-high'], ['OK', 'DM-7', '16']], 'by-hand is not in the label set, so it is neither added nor removed')
  assert.deepEqual(actions.filter((a) => a[1] === 'DM-4'), [['LABELS', 'DM-4', '13', '+core -docs'], ['REOPEN', 'DM-4', '13']], 'a closed issue is kept in step too')
  assert.deepEqual(actions.filter((a) => a[1] === 'DM-1'), [['CLOSE', 'DM-1', '11']], 'already in step: no LABELS')
})

test('labels: exactly one prio- label, the one prio= names', () => {
  const ex = existingFromIssues([{ number: 5, title: 'DM-7 — Already right', state: 'open', milestone: { title: 'v0.2.0 — Second light' }, labels: ['core', 'prio-low', 'prio-med', 'prio-high'] }], cfgOn)
  assert.deepEqual(plan(model, ex, [], cfgOn).filter((a) => a[1] === 'DM-7'), [['LABELS', 'DM-7', '5', '-prio-low -prio-high'], ['OK', 'DM-7', '5']])
})

test('labels: an issue read without its labels is not relabelled', () => {
  const ex = existingFromIssues([{ number: 5, title: 'DM-7 — Already right', state: 'open', milestone: { title: 'v0.2.0 — Second light' } }], cfgOn)
  assert.deepEqual(plan(model, ex, [], cfgOn).filter((a) => a[1] === 'DM-7'), [['OK', 'DM-7', '5']])
})

test('the summary line counts relabels only when syncLabels is on, so it reads as before otherwise', () => {
  const actions = plan(model, existingFromIssues(labelled, cfgOn), [], cfgOn)
  assert.equal(summarise(actions, cfgOn), '3 to create · 0 to retitle · 0 to move · 2 to relabel · 1 to close · 1 to reopen · 1 ok · 1 skipped')
  assert.equal(summarise(EXPECTED, cfgOn), '1 to create · 1 to retitle · 1 to move · 0 to relabel · 1 to close · 1 to reopen · 3 ok · 1 skipped')
  assert.equal(summarise(EXPECTED, cfg), summarise(EXPECTED))
})

test('no action deletes anything, LABELS included: it sets the list, it removes no label from the repository', () => {
  const kinds = new Set(plan(model, existingFromIssues(labelled, cfgOn), [], cfgOn).map((a) => a[0]))
  assert.ok(kinds.has('LABELS'))
  for (const k of kinds) assert.ok(['CREATE', 'RETITLE', 'MILESTONE', 'LABELS', 'CLOSE', 'REOPEN', 'OK', 'SKIP'].includes(k))
})
