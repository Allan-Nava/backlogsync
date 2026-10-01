// The planner: the backlog and the issues that exist → what to do. Pure, so every
// decision is tested without a network — each failure mode of a sync is a wrong
// decision here: a duplicate opened on every push, an issue closed for open work.
import { DASH } from './backlog.mjs'

// GitHub issues (REST shape) → Map(id → { num, state, title, milestone }). The id is
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
    map.set(id, { num: String(i.number), state: String(i.state).toLowerCase(), title: i.title, milestone: i.milestone?.title ?? '' })
  }
  return map
}

// One or more actions per item, in backlog order:
//   CREATE     open item with no issue          REOPEN   open item whose issue is closed
//   CLOSE      shipped item whose issue is open  RETITLE  title drifted (any state)
//   MILESTONE  the issue sits under another milestone than the item's heading
//   OK         already right                    SKIP     shipped and never had an issue
// Nothing is ever deleted: there is no action for it. An issue whose item left the
// backlog is not touched at all.
export function plan(model, existing, only = []) {
  const actions = []
  for (const it of model.items) {
    if (only.length && !only.includes(it.ms?.version)) continue
    const ex = existing.get(it.id)
    const want = `${it.id}${DASH}${it.title}`
    if (ex && ex.title !== want) actions.push(['RETITLE', it.id, ex.num])
    if (ex && ex.milestone !== undefined && it.ms && ex.milestone !== it.ms.title) actions.push(['MILESTONE', it.id, ex.num])
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
  return actions
}

export function summarise(actions) {
  const count = (k) => actions.filter((a) => a[0] === k).length
  return `${count('CREATE')} to create · ${count('RETITLE')} to retitle · ${count('MILESTONE')} to move · ${count('CLOSE')} to close · ${count('REOPEN')} to reopen · ${count('OK')} ok · ${count('SKIP')} skipped`
}
