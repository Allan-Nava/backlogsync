// BACKLOG.md, read and checked. Pure functions: text and config in, a model or a list
// of errors out. No filesystem, no network — the CLI and the sync pass the text in.
import { PHASES, PRIOS, SIZES } from './config.mjs'

export const DASH = ' — '
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `<!-- tag: k=v k=v -->` → { k: v }; null when the comment is absent. A value may
// itself carry `=`; only the first one splits.
export function meta(s, tag) {
  const m = s.match(new RegExp(`<!--\\s*${esc(tag)}:([\\s\\S]*?)-->`))
  if (!m) return null
  const out = {}
  for (const kv of m[1].trim().split(/\s+/).filter(Boolean)) {
    const [k, ...v] = kv.split('=')
    out[k] = v.join('=')
  }
  return out
}

// Strip every HTML comment, including an unterminated one, so nothing that reads as
// markup survives into an issue body. Loop: one pass can leave a `<!--` behind.
export function stripComments(s) {
  let body = s
  for (let prev = null; prev !== body; ) {
    prev = body
    body = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  }
  return body.trim()
}

// → { milestones: [{ line, title, version, phase, items }], items: [...], errors }
//
// A milestone is a `## ` heading carrying `<!-- ms: phase=… -->`; any other `## `
// heading ends the current milestone. An item is `- [ ] **XX-n — Title**: body` and
// its indented continuation lines; fenced blocks are skipped whole.
export function parse(text, cfg) {
  const { prefix, meta: tag } = cfg
  const file = cfg.backlogRel ?? 'BACKLOG.md'
  const errors = []
  const err = (line, msg) => errors.push(`${file}:${line}: ${msg}`)
  const milestones = []
  const items = []
  const itemRe = new RegExp(`^- \\[( |x)\\] \\*\\*(${esc(prefix)}-(\\d+))\\s+—\\s+(.+?)\\*\\*:?\\s*([\\s\\S]*)$`)
  const startRe = new RegExp(`^- \\[[ x]\\] \\*\\*${esc(prefix)}-`)
  // An item line under another prefix is a typo that would otherwise vanish silently.
  const foreignRe = /^- \[[ xX]\] \*\*([A-Z][A-Z0-9]*)-\d+/
  let ms = null
  let fenced = false
  let cur = null

  const flush = () => {
    if (!cur) return
    const raw = cur.lines.join(' ').replace(/\s+/g, ' ').trim()
    const m = raw.match(itemRe)
    if (!m) err(cur.line, `item does not match \`- [ ] **${prefix}-n — Title**: body <!-- ${tag}: ... -->\``)
    else {
      items.push({
        line: cur.line,
        status: m[1] === 'x' ? 'shipped' : 'open',
        id: m[2],
        num: Number(m[3]),
        title: m[4].trim(),
        body: stripComments(m[5]),
        meta: meta(raw, tag),
        ms,
      })
    }
    cur = null
  }

  text.split('\n').forEach((line, i) => {
    const n = i + 1
    if (line.startsWith('```')) {
      fenced = !fenced
      flush()
      return
    }
    if (fenced) return
    const h = line.match(/^## (.+?)\s*(<!--[\s\S]*-->)?\s*$/)
    if (h) {
      flush()
      const mm = meta(line, 'ms')
      if (mm) {
        const title = h[1].trim()
        const version = title.match(/^(v\d+\.\d+\.\d+)\b/)?.[1] ?? null
        ms = { line: n, title, version, phase: mm.phase ?? null, items: [] }
        milestones.push(ms)
      } else ms = null
      return
    }
    if (startRe.test(line)) {
      flush()
      cur = { line: n, lines: [line] }
      return
    }
    const f = line.match(foreignRe)
    if (f && f[1] !== prefix) err(n, `item id prefix "${f[1]}" is not the configured "${prefix}"`)
    else if (/^- \[X\] \*\*/.test(line)) err(n, 'use a lower-case [x] to tick an item')
    if (cur && /^\s+\S/.test(line)) {
      cur.lines.push(line.trim())
      return
    }
    flush()
  })
  flush()

  for (const it of items) if (it.ms) it.ms.items.push(it)
  return { milestones, items, errors }
}

// → ["BACKLOG.md:<line>: <problem>"]; empty when the backlog is sound.
export function lint(model, cfg) {
  const file = cfg.backlogRel ?? 'BACKLOG.md'
  const errors = [...model.errors]
  const err = (line, msg) => errors.push(`${file}:${line}: ${msg}`)
  const seen = new Map()
  const titles = new Map()
  for (const m of model.milestones) {
    if (!m.version) err(m.line, `milestone heading must start with a version, vX.Y.Z — Theme: "${m.title}"`)
    if (!PHASES.includes(m.phase)) err(m.line, `milestone phase must be one of ${PHASES.join('|')}, got "${m.phase}"`)
    // The sync finds a milestone by its title; two headings with one title are one milestone.
    if (titles.has(m.title)) err(m.line, `milestone "${m.title}" is already a heading on line ${titles.get(m.title)}`)
    titles.set(m.title, m.line)
  }
  for (const it of model.items) {
    if (seen.has(it.id)) err(it.line, `${it.id} is already used on line ${seen.get(it.id)}`)
    seen.set(it.id, it.line)
    if (!it.ms) err(it.line, `${it.id} is not under a milestone heading`)
    if (!it.meta) {
      err(it.line, `${it.id} has no <!-- ${cfg.meta}: ... --> metadata`)
      continue
    }
    if (!PRIOS.includes(it.meta.prio)) err(it.line, `${it.id}: prio must be ${PRIOS.join('|')}`)
    if (!SIZES.includes(it.meta.size)) err(it.line, `${it.id}: size must be ${SIZES.join('|')}`)
    const labels = (it.meta.labels ?? '').split(',').filter(Boolean)
    if (!labels.length) err(it.line, `${it.id}: at least one label`)
    for (const l of labels) {
      if (l.startsWith('prio-')) err(it.line, `${it.id}: "${l}" is added from prio=, do not list it`)
      else if (cfg.labels && !cfg.labels[l]) err(it.line, `${it.id}: unknown label "${l}"`)
    }
    if (it.status === 'shipped' && !it.meta.ver) err(it.line, `${it.id} is shipped but has no ver=`)
    if (it.status === 'open' && it.meta.ver) err(it.line, `${it.id} is open but carries ver=${it.meta.ver}`)
    if (!it.body) err(it.line, `${it.id} has no body`)
  }
  return errors
}

// The comment line names the generator without its runner: `node x.mjs roadmap` and
// `npx backlogsync roadmap` print as `x.mjs roadmap` and `backlogsync roadmap`.
const generatedBy = (cmd) => cmd.replace(/^(?:node|npx)\s+/, '')

// The layout every replaced copy produced, byte for byte, given the same name and
// regenerate command (README, "Compatibility").
export function roadmap(model, cfg) {
  const all = model.items
  const shipped = all.filter((i) => i.status === 'shipped').length
  const bar = (done, total) => {
    const n = total ? Math.round((10 * done) / total) : 0
    return `\`${'#'.repeat(n)}${'.'.repeat(10 - n)}\` ${total ? Math.round((100 * done) / total) : 0}%`
  }
  const backlog = cfg.backlogRel ?? 'BACKLOG.md'
  const out = []
  out.push(`# Roadmap — ${cfg.name}`, '', `<!-- GENERATED by ${generatedBy(cfg.regenerate)} — do not edit by hand. -->`, '')
  out.push(`> This page is **generated** from [${backlog}](${backlog}), the single source of truth for planned work. Regenerate it with \`${cfg.regenerate}\` after editing the backlog — CI fails when the two disagree.`, '')
  out.push(`**${all.length} items · ${shipped} shipped · ${all.length - shipped} open · ${model.milestones.length} milestones.**`, '')
  out.push('## At a glance', '', '| Milestone | Phase | Progress | Open | Shipped |', '|---|---|---|---|---|')
  for (const m of model.milestones) {
    const s = m.items.filter((i) => i.status === 'shipped').length
    out.push(`| **${m.title}** | ${m.phase} | ${bar(s, m.items.length)} | ${m.items.length - s} | ${s} |`)
  }
  out.push('')
  for (const m of model.milestones) {
    out.push(`## ${m.title}`, '')
    for (const it of m.items) {
      const tick = it.status === 'shipped' ? 'x' : ' '
      const ver = it.meta?.ver ? ` · \`${it.meta.ver}\`` : ''
      out.push(`- [${tick}] **${it.id}** — ${it.title} · ${it.meta?.prio ?? '?'} · ${it.meta?.size ?? '?'} · ${(it.meta?.labels ?? '').split(',').join(', ')}${ver}`)
    }
    out.push('')
  }
  return out.join('\n')
}
