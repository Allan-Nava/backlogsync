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
