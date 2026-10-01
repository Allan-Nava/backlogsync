// A minimal GitHub REST client on node:http(s) — no fetch, which Node 18 still marks
// experimental and warns about on every run. Only the calls the sync makes, and no
// DELETE among them.
import http from 'node:http'
import https from 'node:https'

export class GitHubError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export function client({ token, repo, apiUrl = 'https://api.github.com', userAgent = 'backlogsync' }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new GitHubError(`GITHUB_REPOSITORY must be owner/name, got ${JSON.stringify(repo ?? '')}`)
  const base = new URL(apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`)

  function request(method, pathOrUrl, body) {
    const url = new URL(pathOrUrl, base)
    // A pagination link that points elsewhere must not receive the token.
    if (url.origin !== base.origin) return Promise.reject(new GitHubError(`refusing to follow ${url.origin}: not ${base.origin}`))
    const payload = body === undefined ? null : JSON.stringify(body)
    const headers = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': userAgent,
    }
    if (token) headers.authorization = `Bearer ${token}`
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = Buffer.byteLength(payload)
    }
    const lib = url.protocol === 'http:' ? http : https
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = text
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve({ data, headers: res.headers })
          else {
            const msg = (data && typeof data === 'object' && data.message) || `HTTP ${res.statusCode}`
            reject(new GitHubError(`${method} ${url.pathname}: ${res.statusCode} ${msg}`, res.statusCode))
          }
        })
      })
      req.on('error', (e) => reject(new GitHubError(`${method} ${url.pathname}: ${e.message}`)))
      if (payload) req.write(payload)
      req.end()
    })
  }

  // Follows rel="next" until there is none.
  async function all(path) {
    const out = []
    let next = path
    while (next) {
      const { data, headers } = await request('GET', next)
      if (!Array.isArray(data)) throw new GitHubError(`GET ${path}: expected a list`)
      out.push(...data)
      next = String(headers.link ?? '').match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null
    }
    return out
  }

  const r = `repos/${repo}`
  return {
    repo,
    request,
    issues: () => all(`${r}/issues?state=all&per_page=100`),
    labels: () => all(`${r}/labels?per_page=100`),
    milestones: () => all(`${r}/milestones?state=all&per_page=100`),
    createLabel: (name, color, description) => request('POST', `${r}/labels`, { name, color, description }).then((x) => x.data),
    createMilestone: (title, description) => request('POST', `${r}/milestones`, { title, description }).then((x) => x.data),
    createIssue: (fields) => request('POST', `${r}/issues`, fields).then((x) => x.data),
    updateIssue: (num, fields) => request('PATCH', `${r}/issues/${num}`, fields).then((x) => x.data),
    comment: (num, body) => request('POST', `${r}/issues/${num}/comments`, { body }).then((x) => x.data),
  }
}
