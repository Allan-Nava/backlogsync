// A fake GitHub REST API on a local port: issues, labels, milestones and comments in
// memory, paginated with Link headers the way the real one is. Every request is
// recorded, so a test can assert what was — and was not — sent. Nothing here talks to
// GitHub.
import http from 'node:http'

export async function fakeGitHub({ repo = 'octo/demo', token = 'test-token', pageSize = 100, issues = [], labels = [], milestones = [] } = {}) {
  const state = {
    // Labels on an issue come back as objects, the way the real API returns them.
    issues: issues.map((i) => ({ state: 'open', milestone: null, body: '', ...i, labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? { name: l } : l)) })),
    labels: labels.map((l) => (typeof l === 'string' ? { name: l, color: 'ededed', description: '' } : l)),
    milestones: milestones.map((m, i) => ({ number: i + 1, state: 'open', description: '', ...m })),
    comments: [],
    requests: [],
  }
  let nextIssue = Math.max(0, ...state.issues.map((i) => i.number)) + 1
  let nextMilestone = state.milestones.length + 1
  const base = `/repos/${repo}`

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake')
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      state.requests.push({ method: req.method, path: url.pathname, search: url.search, body, auth: req.headers.authorization ?? null, apiVersion: req.headers['x-github-api-version'] })
      const send = (status, data, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(data === undefined ? '' : JSON.stringify(data))
      }
      const page = (list) => {
        const per = Math.min(Number(url.searchParams.get('per_page') ?? 30), pageSize)
        const p = Number(url.searchParams.get('page') ?? 1)
        const slice = list.slice((p - 1) * per, p * per)
        const headers = {}
        if (p * per < list.length) {
          const next = new URL(url)
          next.searchParams.set('page', String(p + 1))
          headers.link = `<http://${req.headers.host}${next.pathname}${next.search}>; rel="next"`
        }
        send(200, slice, headers)
      }
      const writing = req.method !== 'GET'
      if (writing && req.headers.authorization !== `Bearer ${token}`) return send(401, { message: 'Bad credentials' })
      if (req.method === 'DELETE') return send(405, { message: 'the fake refuses DELETE, and the sync must never send one' })

      if (!url.pathname.startsWith(`${base}/`)) return send(404, { message: 'Not Found' })
      const rest = url.pathname.slice(base.length)
      let m
      if (rest === '/issues' && req.method === 'GET') return page(state.issues)
      if (rest === '/labels' && req.method === 'GET') return page(state.labels)
      if (rest === '/milestones' && req.method === 'GET') return page(state.milestones)
      if (rest === '/labels' && req.method === 'POST') {
        if (state.labels.some((l) => l.name === body.name)) return send(422, { message: 'Validation Failed: already_exists' })
        state.labels.push({ name: body.name, color: body.color, description: body.description })
        return send(201, state.labels.at(-1))
      }
      if (rest === '/milestones' && req.method === 'POST') {
        if (state.milestones.some((x) => x.title === body.title)) return send(422, { message: 'Validation Failed: already_exists' })
        state.milestones.push({ number: nextMilestone++, title: body.title, description: body.description, state: 'open' })
        return send(201, state.milestones.at(-1))
      }
      if (rest === '/issues' && req.method === 'POST') {
        const ms = body.milestone === undefined ? null : state.milestones.find((x) => x.number === body.milestone)
        if (body.milestone !== undefined && !ms) return send(422, { message: 'Validation Failed: milestone' })
        for (const l of body.labels ?? []) if (!state.labels.some((x) => x.name === l)) return send(422, { message: `Validation Failed: label ${l}` })
        const issue = { number: nextIssue++, title: body.title, body: body.body, state: 'open', milestone: ms ? { number: ms.number, title: ms.title } : null, labels: (body.labels ?? []).map((name) => ({ name })) }
        state.issues.push(issue)
        return send(201, issue)
      }
      if ((m = rest.match(/^\/issues\/(\d+)$/)) && req.method === 'PATCH') {
        const issue = state.issues.find((i) => i.number === Number(m[1]))
        if (!issue) return send(404, { message: 'Not Found' })
        if (body.title !== undefined) issue.title = body.title
        if (body.state !== undefined) issue.state = body.state
        if (body.state_reason !== undefined) issue.state_reason = body.state_reason
        if (body.milestone !== undefined) {
          const ms = state.milestones.find((x) => x.number === body.milestone)
          if (!ms) return send(422, { message: 'Validation Failed: milestone' })
          issue.milestone = { number: ms.number, title: ms.title }
        }
        // `labels` replaces the issue's whole set, as on GitHub. A name that is not a
        // label of the repository is refused here, so the sync must create it first.
        if (body.labels !== undefined) {
          for (const l of body.labels) if (!state.labels.some((x) => x.name === l)) return send(422, { message: `Validation Failed: label ${l}` })
          issue.labels = body.labels.map((name) => ({ name }))
        }
        return send(200, issue)
      }
      if ((m = rest.match(/^\/issues\/(\d+)\/comments$/)) && req.method === 'POST') {
        state.comments.push({ issue: Number(m[1]), body: body.body })
        return send(201, { id: state.comments.length })
      }
      send(404, { message: 'Not Found' })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url,
    repo,
    token,
    state,
    writes: () => state.requests.filter((r) => r.method !== 'GET'),
    close: () => new Promise((r) => server.close(r)),
  }
}
