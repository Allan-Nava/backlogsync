// The one-way sync: BACKLOG.md → GitHub issues and milestones. The plan is computed
// first and printed in full before anything is applied, so a run's log says what it
// was about to do even when a later call fails.
import { DASH } from './backlog.mjs'
import { allLabels } from './config.mjs'
import { existingFromIssues, labelDiff, plan, summarise } from './plan.mjs'

export function issueBody(it, cfg, { server = 'https://github.com', repo }) {
  const blob = `${server}/${repo}/blob/${cfg.branch}`
  return `${it.body}

---

Planned work, tracked in [${cfg.backlogRel}](${blob}/${cfg.backlogRel}) as \`${it.id}\` under **${it.ms.title}** (priority ${it.meta.prio}, size ${it.meta.size}).

\`${cfg.backlogRel}\` is the single source of truth: it carries the stable \`${cfg.prefix}-n\` id that commits and the CHANGELOG reference, and [${cfg.roadmapRel}](${blob}/${cfg.roadmapRel}) is generated from it. This issue is a view of that item, kept in step one way by backlogsync, so closing it means ticking the item in the backlog and regenerating the roadmap in the same commit.
`
}

export const CLOSE_COMMENT = 'Shipped: the backlog item is ticked in the backlog. Closed by backlogsync.'
export const REOPEN_COMMENT = 'Reopened: the backlog item is open again in the backlog. Reopened by backlogsync.'
export const MILESTONE_DESCRIPTION = 'Backlog milestone. Source of truth: BACKLOG.md'

// → { actions, summary, applied: [lines] }. `log` receives every line as it happens.
export async function sync(model, cfg, gh, { dryRun = false, only = [], server, log = console.log } = {}) {
  const existing = existingFromIssues(await gh.issues(), cfg)
  const actions = plan(model, existing, only, cfg)
  for (const a of actions) log(a.join('\t'))
  const summary = summarise(actions, cfg)
  log('')
  log(summary)
  const todo = actions.filter((a) => !['OK', 'SKIP'].includes(a[0]))
  if (dryRun) {
    log('(dry run — nothing changed)')
    return { actions, summary, applied: [] }
  }
  const applied = []
  const note = (s) => {
    applied.push(s)
    log(s)
  }
  const byId = new Map(model.items.map((i) => [i.id, i]))

  // Labels only matter to a CREATE, or to a LABELS when `syncLabels` is on; otherwise an
  // existing issue's labels are left as they are.
  if (todo.some((a) => a[0] === 'CREATE' || a[0] === 'LABELS')) {
    const have = new Set((await gh.labels()).map((l) => l.name))
    for (const [name, { color, description }] of Object.entries(allLabels(cfg))) {
      if (have.has(name)) continue
      await gh.createLabel(name, color, description)
      have.add(name)
      note(`  created label ${name}`)
    }
    // With no `labels` configured any label is allowed; one that does not exist yet is
    // created grey rather than failing the issue.
    const used = new Set(todo.filter((a) => a[0] === 'CREATE').flatMap((a) => byId.get(a[1]).meta.labels.split(',').filter(Boolean)))
    for (const name of used) {
      if (have.has(name)) continue
      await gh.createLabel(name, 'ededed', '')
      have.add(name)
      note(`  created label ${name}`)
    }
  }

  let milestones = null
  const milestoneNumber = async (title) => {
    milestones ??= new Map((await gh.milestones()).map((m) => [m.title, m.number]))
    if (!milestones.has(title)) {
      const m = await gh.createMilestone(title, MILESTONE_DESCRIPTION.replace('BACKLOG.md', cfg.backlogRel))
      milestones.set(title, m.number)
      note(`  created milestone ${title}`)
    }
    return milestones.get(title)
  }

  const repo = gh.repo
  for (const [action, id, num, detail] of todo) {
    const it = byId.get(id)
    const title = `${id}${DASH}${it.title}`
    if (action === 'CREATE') {
      const labels = [...it.meta.labels.split(',').filter(Boolean), `prio-${it.meta.prio}`]
      const issue = await gh.createIssue({ title, body: issueBody(it, cfg, { server, repo }), milestone: await milestoneNumber(it.ms.title), labels })
      note(`  created ${id}  #${issue.number}`)
    } else if (action === 'RETITLE') {
      await gh.updateIssue(num, { title })
      note(`  retitled ${id}  #${num}  -> ${title}`)
    } else if (action === 'MILESTONE') {
      await gh.updateIssue(num, { milestone: await milestoneNumber(it.ms.title) })
      note(`  moved ${id}  #${num}  -> ${it.ms.title}`)
    } else if (action === 'LABELS') {
      // One PATCH with the issue's whole list: a label leaves an issue without a DELETE,
      // and a label outside the managed set stays in the list it was read with.
      await gh.updateIssue(num, { labels: labelDiff(it, existing.get(id), cfg).next })
      note(`  relabelled ${id}  #${num}  ${detail}`)
    } else if (action === 'CLOSE') {
      await gh.comment(num, CLOSE_COMMENT)
      await gh.updateIssue(num, { state: 'closed', state_reason: 'completed' })
      note(`  closed ${id}  #${num}`)
    } else if (action === 'REOPEN') {
      await gh.updateIssue(num, { state: 'open' })
      await gh.comment(num, REOPEN_COMMENT)
      note(`  reopened ${id}  #${num}`)
    }
  }
  return { actions, summary, applied }
}
