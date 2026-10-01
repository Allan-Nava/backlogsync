// Configuration: `.backlogsync.json`, or the `backlogsync` key of package.json, or the
// file named by --config. One source only — two that could disagree is an error, not a
// precedence rule, because a repository that carries both has already drifted.
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export class ConfigError extends Error {}

// The three vocabularies are the same in every copy this tool replaces, so they are
// fixed rather than configurable (README, "Decisions").
export const PRIOS = ['high', 'med', 'low']
export const SIZES = ['S', 'M', 'L', 'XL']
export const PHASES = ['now', 'next', 'later', 'shipped']

// The priority labels every copy adds on creation. The colours are the majority's;
// a `labels` entry of the same name overrides one.
export const PRIO_LABELS = {
  'prio-high': { color: 'b60205', description: 'High priority in BACKLOG.md' },
  'prio-med': { color: 'fbca04', description: 'Medium priority in BACKLOG.md' },
  'prio-low': { color: 'c2e0c6', description: 'Low priority in BACKLOG.md' },
}

export const DEFAULT_REGENERATE = 'npx backlogsync roadmap'
const KEYS = new Set(['prefix', 'meta', 'name', 'backlog', 'roadmap', 'labels', 'branch', 'regenerate'])

// → { root, source, prefix, meta, name, backlog, roadmap, labels, branch, regenerate }
// `backlog` and `roadmap` are absolute; `backlogRel` is the path the documents print.
export function loadConfig({ cwd = process.cwd(), configPath } = {}) {
  let raw
  let root
  let source
  const pkgPath = join(cwd, 'package.json')
  const pkg = existsSync(pkgPath) ? readJson(pkgPath) : null
  if (configPath) {
    source = resolve(cwd, configPath)
    raw = readJson(source)
    root = dirname(source)
  } else {
    const file = join(cwd, '.backlogsync.json')
    const inPkg = pkg && Object.hasOwn(pkg, 'backlogsync')
    if (existsSync(file) && inPkg) throw new ConfigError('both .backlogsync.json and package.json#backlogsync exist — keep one')
    if (existsSync(file)) {
      source = file
      raw = readJson(file)
    } else if (inPkg) {
      source = `${pkgPath}#backlogsync`
      raw = pkg.backlogsync
    } else throw new ConfigError('no configuration: add .backlogsync.json or a "backlogsync" key to package.json (at least {"prefix": "XX"})')
    root = cwd
  }
  return normalise(raw, { root, source, pkgName: pkg?.name })
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new ConfigError(`${path}: ${e.code === 'ENOENT' ? 'not found' : e.message}`)
  }
}

export function normalise(raw, { root = process.cwd(), source = '(inline)', pkgName } = {}) {
  const bad = (msg) => {
    throw new ConfigError(`${source}: ${msg}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('must be a JSON object')
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) bad(`unknown key "${k}" (known: ${[...KEYS].join(', ')})`)
  const str = (k, re, what) => {
    if (raw[k] === undefined) return undefined
    if (typeof raw[k] !== 'string' || !re.test(raw[k])) bad(`${k} must be ${what}, got ${JSON.stringify(raw[k])}`)
    return raw[k]
  }
  const prefix = str('prefix', /^[A-Z][A-Z0-9]*$/, 'upper-case letters and digits, starting with a letter (e.g. "ST")')
  if (!prefix) bad('prefix is required (e.g. "ST" for ST-1, ST-2 …)')
  const meta = str('meta', /^[a-z][a-z0-9-]*$/, 'lower-case letters, digits and dashes') ?? prefix.toLowerCase()
  const name = str('name', /\S/, 'a non-empty string') ?? pkgName ?? basename(resolve(root))
  const backlogRel = str('backlog', /\S/, 'a path') ?? 'BACKLOG.md'
  const roadmapRel = str('roadmap', /\S/, 'a path') ?? 'ROADMAP.md'
  const branch = str('branch', /^[\w./-]+$/, 'a branch name') ?? 'main'
  const regenerate = str('regenerate', /\S/, 'the command a reader runs to regenerate the roadmap') ?? DEFAULT_REGENERATE

  let labels = null
  if (raw.labels !== undefined) {
    if (!raw.labels || typeof raw.labels !== 'object' || Array.isArray(raw.labels)) bad('labels must be an object of name → {color, description}')
    labels = {}
    for (const [lname, v] of Object.entries(raw.labels)) {
      // [color, description] is the shape the replaced scripts used; both are accepted.
      const [color, description = ''] = Array.isArray(v) ? v : [v?.color, v?.description ?? '']
      if (typeof color !== 'string' || !/^[0-9a-fA-F]{6}$/.test(color)) bad(`labels.${lname}.color must be six hex digits, no #`)
      if (typeof description !== 'string') bad(`labels.${lname}.description must be a string`)
      labels[lname] = { color: color.toLowerCase(), description }
    }
  }
  return {
    root,
    source,
    prefix,
    meta,
    name,
    backlogRel,
    roadmapRel,
    backlog: resolve(root, backlogRel),
    roadmap: resolve(root, roadmapRel),
    labels,
    branch,
    regenerate,
  }
}

// Every label the sync may need to create: the configured ones plus the priority
// labels, a configured entry winning over the default of the same name.
export function allLabels(cfg) {
  return { ...(cfg.labels ?? {}), ...Object.fromEntries(Object.entries(PRIO_LABELS).filter(([k]) => !cfg.labels?.[k])) }
}
