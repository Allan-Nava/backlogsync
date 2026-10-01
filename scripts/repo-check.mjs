#!/usr/bin/env node
// The repository's own invariants, run by `npm test`; with --history, the leak check
// over every commit reachable from any ref, run by CI as `own-history`.
//
//   node scripts/repo-check.mjs             manifest, CHANGELOG, tracked files
//   node scripts/repo-check.mjs --history   the same, plus every commit's patch and message
//
// The leak shapes: a home-directory path, a file URL, an email address other than the
// public one, a private IPv4 address, something shaped like a key or token. Private
// names cannot be listed in a public file, so LEAK_TERMS may name a file outside the
// repository with one term per line, matched case-insensitively — the maintainer's
// local run uses it; CI has no such file and checks the shapes only.
//
// A finding names the file or commit and the kind, never the match: this output is
// printed in CI logs and pasted into issues.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The public address, and GitHub's own: a merge made on GitHub is committed by its
// noreply identity, which names no one.
const PUBLIC_EMAILS = new Set(['allannava95' + '@' + 'gmail.com', 'noreply' + '@' + 'github.com'])
const PUBLIC_EMAIL_DOMAINS = ['@users.noreply.github.com']

// Built from pieces so that this file does not match itself.
const SHAPES = [
  [new RegExp('(?:^|[\\s"\'`(=:])/(?:Us' + 'ers|ho' + 'me)/(?!<)[A-Za-z0-9._-]+'), 'a home directory path'],
  [new RegExp('fi' + 'le:/{2,3}[A-Za-z]'), 'a file URL'],
  [new RegExp('\\b(?:10\\.\\d{1,3}|192\\.168|172\\.(?:1[6-9]|2\\d|3[01]))\\.\\d{1,3}\\.\\d{1,3}\\b'), 'a private IPv4 address'],
  [new RegExp('\\b(?:gh' + '[pousr]_[A-Za-z0-9]{30,}|github' + '_pat_[A-Za-z0-9_]{20,}|np' + 'm_[A-Za-z0-9]{30,}|AK' + 'IA[0-9A-Z]{16}|xo' + 'x[abprs]-[A-Za-z0-9-]{10,}|sk-' + '[A-Za-z0-9_-]{20,})'), 'a key or token'],
  [new RegExp('-----BEGIN [A-Z ]*PRIV' + 'ATE KEY-----'), 'a private key'],
]
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

function terms() {
  const f = process.env.LEAK_TERMS
  if (!f) return []
  const abs = resolve(f)
  if (!relative(ROOT, abs).startsWith('..')) throw new Error('LEAK_TERMS must name a file outside the repository — what it lists must never be committed')
  return readFileSync(abs, 'utf8').split('\n').map((t) => t.trim().toLowerCase()).filter((t) => t && !t.startsWith('#'))
}

// → [kind] found in `text`, each kind once.
export function findings(text, extraTerms = []) {
  const out = []
  for (const [re, what] of SHAPES) if (re.test(text)) out.push(what)
  for (const m of text.matchAll(EMAIL)) {
    const addr = m[0].toLowerCase()
    if (addr.startsWith('git@') || PUBLIC_EMAILS.has(addr) || PUBLIC_EMAIL_DOMAINS.some((d) => addr.endsWith(d))) continue
    out.push('an email address')
    break
  }
  const lower = text.toLowerCase()
  if (extraTerms.some((t) => lower.includes(t))) out.push('a private term (LEAK_TERMS)')
  return out
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })

function trackedFiles() {
  try {
    // Tracked plus untracked-but-not-ignored, so a check before the first commit sees the tree.
    return git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

export function checkManifest() {
  const errors = []
  const fail = (m) => errors.push(m)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  if (pkg.name !== 'backlogsync') fail('package.json#name must be backlogsync')
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? '')) fail(`package.json#version is not x.y.z: ${pkg.version}`)
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) fail('no runtime dependencies — package.json#dependencies must be empty')
  if (pkg.scripts?.postinstall || pkg.scripts?.install || pkg.scripts?.preinstall) fail('no install scripts — installing must never run code')
  for (const f of ['bin', 'action.yml', 'README.md', 'CHANGELOG.md', 'LICENSE']) if (!pkg.files?.includes(f)) fail(`package.json#files is missing ${f}`)
  if (pkg.engines?.node !== '>=18') fail('package.json#engines.node must be >=18')
  if (!/^(?:git\+)?https:\/\/github\.com\/Allan-Nava\/backlogsync(?:\.git)?$/.test(pkg.repository?.url ?? '')) fail('package.json#repository must be the GitHub repository URL')
  const log = existsSync(join(ROOT, 'CHANGELOG.md')) ? readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8') : ''
  if (!/^## \[Unreleased\]/m.test(log)) fail('CHANGELOG.md needs an [Unreleased] section')
  if (pkg.version && !log.includes(`## [${pkg.version}]`)) fail(`CHANGELOG.md has no section for ${pkg.version}, the version in package.json`)
  const action = existsSync(join(ROOT, 'action.yml')) ? readFileSync(join(ROOT, 'action.yml'), 'utf8') : ''
  if (!action.includes('node "$GITHUB_ACTION_PATH/bin/backlogsync.mjs"')) fail('action.yml must run node "$GITHUB_ACTION_PATH/bin/backlogsync.mjs"')
  return errors
}

function main() {
  const extra = terms()
  const errors = checkManifest()
  let scanned = 0
  for (const f of trackedFiles()) {
    const p = join(ROOT, f)
    if (/\.(png|jpe?g|gif|ico|webp|woff2?|tgz|gz|zip|pdf)$/i.test(f) || !existsSync(p) || !statSync(p).isFile()) continue
    scanned++
    for (const what of findings(readFileSync(p, 'utf8'), extra)) errors.push(`${f}: looks like ${what} — this repository is public`)
  }
  let commits = 0
  if (process.argv.includes('--history')) {
    // One commit at a time, so a finding names its commit: message, then patch.
    const shas = git(['rev-list', '--all']).split('\n').filter(Boolean)
    for (const sha of shas) {
      commits++
      const text = git(['show', '--no-color', '--format=%an%n%ae%n%cn%n%ce%n%B', '-p', sha])
      for (const what of findings(text, extra)) errors.push(`commit ${sha.slice(0, 12)}: looks like ${what} — in its identity, message or patch`)
    }
  }
  for (const e of errors) console.error(e)
  if (errors.length) {
    console.error(`${errors.length} problem${errors.length === 1 ? '' : 's'}`)
    process.exitCode = 1
  } else console.log(`ok — manifest, CHANGELOG, ${scanned} files${commits ? `, ${commits} commits` : ''}${extra.length ? `, ${extra.length} private terms` : ''}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
