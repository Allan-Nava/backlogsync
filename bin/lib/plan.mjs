// The planner: the backlog and the issues that exist → what to do. Pure, so every
// decision is tested without a network — each failure mode of a sync is a wrong
// decision here: a duplicate opened on every push, an issue closed for open work.
import { DASH } from './backlog.mjs'
import { PRIO_LABELS } from './config.mjs'

// GitHub issues (REST shape) → Map(id → { num, state, title, milestone, labels }). The id is
// the title's prefix, the only durable link back to the backlog. Pull requests are
// issues to the REST API and are left out. When two issues carry one id the oldest
// wins, so a stray duplicate never takes over the item's history.
export function existingFromIssues(list, cfg) {
  const idRe = new RegExp(`^${cfg.prefix}-\\d+$`)
  const map = new Map()
  for (const i of [...list].sort((a, b) => a.number - b.number)) {
    if (i.pull_request) continue
    const id = String(i.title).split(DASH)[0]
    if (!idRe.test(id) || map.has(id)) continue
    // `labels` stays undefined when the list carried none, so nothing is planned from it.
    const labels = Array.isArray(i.labels) ? i.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean) : undefined
    map.set(id, { num: String(i.number), state: String(i.state).toLowerCase(), title: i.title, milestone: i.milestone?.title ?? '', labels, body: typeof i.body === 'string' ? i.body : undefined })
  }
  return map
}

// BS-18: the labels an existing issue should carry, against the ones it has. Only the
// managed set is compared — the declared `labels` and the three `prio-` labels — so a
// label outside it, added by hand, is neither added nor removed. `next` is the issue's
// whole new list: what it had, less the stale, plus the missing, in that order.
export function labelDiff(it, ex, cfg) {
  const managed = new Set([...Object.keys(cfg.labels ?? {}), ...Object.keys(PRIO_LABELS)])
  const want = [...new Set([...it.meta.labels.split(',').filter(Boolean), `prio-${it.meta.prio}`])]
  const have = ex.labels ?? []
  const add = want.filter((l) => !have.includes(l))
  const remove = have.filter((l) => managed.has(l) && !want.includes(l))
  return { add, remove, next: [...have.filter((l) => !remove.includes(l)), ...add] }
}

// GitHub milestones (REST shape) → Map(title → { num, state }). A milestone is found by
// title, as the sync has always found it.
export function existingMilestones(list) {
  return new Map(list.map((m) => [m.title, { num: String(m.number), state: String(m.state).toLowerCase() }]))
}

// BS-23: line endings are the one thing GitHub may change in a body it stores.
const sameBody = (a, b) => String(a ?? '').replace(/\r\n/g, '\n').trim() === String(b ?? '').replace(/\r\n/g, '\n').trim()

// BS-20: a milestone is finished when its phase says shipped and none of its items is open.
// Phase alone is not enough (an item may still be open under it), and items alone are not
// either (every item ticked but the release not out yet is phase=now).
export const finished = (ms) => ms.phase === 'shipped' && ms.items.length > 0 && ms.items.every((i) => i.status === 'shipped')

// One or more actions per item, in backlog order:
//   CREATE     open item with no issue          REOPEN   open item whose issue is closed
//   CLOSE      shipped item whose issue is open  RETITLE  title drifted (any state)
//   MILESTONE  the issue sits under another milestone than the item's heading
//   LABELS     the issue's labels differ from the item's (any state; only with
//              `syncLabels`), with a fourth field: `+added -removed`
//   BODY       the issue's body differs from the item's (any state; only with `syncBody`,
//              and only when the wanted bodies are passed in `extra.bodies`)
//   OK         already right                    SKIP     shipped and never had an issue
// then, with `closeMilestones` and the milestones passed in `extra.milestones`, one action
// per milestone that GitHub has and the backlog disagrees with:
//   CLOSE-MILESTONE   finished (phase=shipped, no open item) but open on GitHub
//   REOPEN-MILESTONE  not finished but closed on GitHub
// A milestone GitHub does not have is created only by a CREATE, as before.
// Nothing is ever deleted: there is no action for it. An issue whose item left the
// backlog is not touched at all.
export function plan(model, existing, only = [], cfg = {}, extra = {}) {
  const actions = []
  for (const it of model.items) {
    if (only.length && !only.includes(it.ms?.version)) continue
    const ex = existing.get(it.id)
    const want = `${it.id}${DASH}${it.title}`
    if (ex && ex.title !== want) actions.push(['RETITLE', it.id, ex.num])
    if (ex && ex.milestone !== undefined && it.ms && ex.milestone !== it.ms.title) actions.push(['MILESTONE', it.id, ex.num])
    if (ex && cfg.syncLabels && ex.labels !== undefined) {
      const { add, remove } = labelDiff(it, ex, cfg)
      if (add.length || remove.length) actions.push(['LABELS', it.id, ex.num, [...add.map((l) => `+${l}`), ...remove.map((l) => `-${l}`)].join(' ')])
    }
    if (ex && cfg.syncBody && extra.bodies?.has(it.id) && ex.body !== undefined && !sameBody(ex.body, extra.bodies.get(it.id))) {
      actions.push(['BODY', it.id, ex.num])
    }
    if (it.status === 'open') {
      if (!ex) actions.push(['CREATE', it.id, '-'])
      else if (ex.state === 'closed') actions.push(['REOPEN', it.id, ex.num])
      else actions.push(['OK', it.id, ex.num])
    } else {
      if (!ex) actions.push(['SKIP', it.id, '-'])
      else if (ex.state === 'open') actions.push(['CLOSE', it.id, ex.num])
      else actions.push(['OK', it.id, ex.num])
    }
  }
  if (cfg.closeMilestones && extra.milestones) {
    for (const ms of model.milestones) {
      if (only.length && !only.includes(ms.version)) continue
      const gh = extra.milestones.get(ms.title)
      if (!gh) continue
      if (finished(ms) && gh.state === 'open') actions.push(['CLOSE-MILESTONE', ms.title, gh.num])
      else if (!finished(ms) && gh.state === 'closed') actions.push(['REOPEN-MILESTONE', ms.title, gh.num])
    }
  }
  return actions
}

// The relabel count appears only when `syncLabels` is on, so with the key off the line
// reads exactly as before — and its shape follows the config, never the data.
export function summarise(actions, cfg = {}) {
  const count = (k) => actions.filter((a) => a[0] === k).length
  const relabel = cfg.syncLabels ? ` · ${count('LABELS')} to relabel` : ''
  const body = cfg.syncBody ? ` · ${count('BODY')} to rewrite` : ''
  const ms = cfg.closeMilestones ? ` · ${count('CLOSE-MILESTONE')} milestones to close · ${count('REOPEN-MILESTONE')} to reopen` : ''
  return `${count('CREATE')} to create · ${count('RETITLE')} to retitle · ${count('MILESTONE')} to move${relabel}${body} · ${count('CLOSE')} to close · ${count('REOPEN')} to reopen · ${count('OK')} ok · ${count('SKIP')} skipped${ms}`
}
