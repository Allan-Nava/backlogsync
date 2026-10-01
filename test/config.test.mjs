import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test, { after } from 'node:test'
import { allLabels, ConfigError, loadConfig, normalise } from '../bin/lib/config.mjs'

const dir = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'bs-config-'))
  for (const [f, v] of Object.entries(files)) writeFileSync(join(d, f), typeof v === 'string' ? v : JSON.stringify(v))
  return d
}
const cleanup = []
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })))

test('.backlogsync.json alone is enough — a Go repository has no package.json', () => {
  const d = dir({ '.backlogsync.json': { prefix: 'GO' } })
  cleanup.push(d)
  const c = loadConfig({ cwd: d })
  assert.equal(c.prefix, 'GO')
  assert.equal(c.meta, 'go', 'the meta key defaults to the lower-cased prefix')
  assert.equal(c.name, basename(d), 'the name defaults to the directory')
  assert.equal(c.backlog, join(c.root, 'BACKLOG.md'))
  assert.equal(c.roadmap, join(c.root, 'ROADMAP.md'))
  assert.equal(c.branch, 'main')
  assert.equal(c.regenerate, 'npx backlogsync roadmap')
  assert.equal(c.labels, null)
})

test('package.json#backlogsync, with the package name as the default name', () => {
  const d = dir({ 'package.json': { name: 'demo-pkg', backlogsync: { prefix: 'DP', meta: 'dp' } } })
  cleanup.push(d)
  const c = loadConfig({ cwd: d })
  assert.equal(c.name, 'demo-pkg')
  assert.equal(c.prefix, 'DP')
})

test('both sources at once is an error, not a precedence rule', () => {
  const d = dir({ 'package.json': { name: 'x', backlogsync: { prefix: 'A' } }, '.backlogsync.json': { prefix: 'B' } })
  cleanup.push(d)
  assert.throws(() => loadConfig({ cwd: d }), /both \.backlogsync\.json and package\.json#backlogsync/)
})

test('no configuration at all says what to add', () => {
  const d = dir({ 'package.json': { name: 'x' } })
  cleanup.push(d)
  assert.throws(() => loadConfig({ cwd: d }), (e) => e instanceof ConfigError && /\{"prefix": "XX"\}/.test(e.message))
})

test('--config names a file anywhere; paths resolve against its directory', () => {
  const d = dir({ 'other.json': { prefix: 'OT', backlog: 'plan/BACKLOG.md' } })
  cleanup.push(d)
  const c = loadConfig({ cwd: tmpdir(), configPath: join(d, 'other.json') })
  assert.equal(c.backlog, join(d, 'plan', 'BACKLOG.md'))
  assert.equal(c.backlogRel, 'plan/BACKLOG.md')
})

test('a broken file is reported with its path', () => {
  const d = dir({ '.backlogsync.json': '{ nope' })
  cleanup.push(d)
  assert.throws(() => loadConfig({ cwd: d }), /\.backlogsync\.json: /)
})

test('validation: required prefix, shapes, unknown keys', () => {
  assert.throws(() => normalise({}), /prefix is required/)
  assert.throws(() => normalise({ prefix: 'st' }), /prefix must be upper-case/)
  assert.throws(() => normalise({ prefix: 'ST', meta: 'S T' }), /meta must be/)
  assert.throws(() => normalise({ prefix: 'ST', labelz: {} }), /unknown key "labelz"/)
  assert.throws(() => normalise({ prefix: 'ST', labels: { a: { color: '#fff' } } }), /labels\.a\.color must be six hex digits/)
  assert.throws(() => normalise({ prefix: 'ST', labels: [] }), /labels must be an object/)
  assert.throws(() => normalise([]), /must be a JSON object/)
})

test('labels take the object form and the [color, description] form of the old scripts', () => {
  const c = normalise({ prefix: 'ST', labels: { a: { color: 'ABCDEF', description: 'A' }, b: ['123456', 'B'], c: { color: '000000' } } })
  assert.deepEqual(c.labels, { a: { color: 'abcdef', description: 'A' }, b: { color: '123456', description: 'B' }, c: { color: '000000', description: '' } })
})

test('the priority labels are always there, and a configured one wins', () => {
  const plain = allLabels(normalise({ prefix: 'ST' }))
  assert.deepEqual(Object.keys(plain), ['prio-high', 'prio-med', 'prio-low'])
  assert.equal(plain['prio-med'].color, 'fbca04')
  const own = allLabels(normalise({ prefix: 'ST', labels: { x: ['111111', ''], 'prio-med': ['e4b429', 'Medium'] } }))
  assert.equal(own['prio-med'].color, 'e4b429')
  assert.ok(own.x && own['prio-high'])
})
