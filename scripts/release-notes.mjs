#!/usr/bin/env node
// Print the CHANGELOG section for one version — the top of that release's notes.
//
//   node scripts/release-notes.mjs 0.2.0
//
// Exit 1 when the version has no section, so release.yml stops rather than publishing
// notes without it. Repository tooling: not in the npm tarball (package.json#files).
import { readFileSync } from 'node:fs'

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The body of `## [version] — date`: everything after its heading up to the next `## [`,
// trimmed; null when the version has no section. A prefix is not a match.
export function changelogSection(text, version) {
  const lines = String(text).split('\n')
  const start = lines.findIndex((l) => new RegExp(`^## \\[${esc(version)}\\](?:\\s|$)`).test(l))
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## ['))
  if (end < 0) end = lines.length
  return lines.slice(start + 1, end).join('\n').trim()
}

if (process.argv[1]?.endsWith('release-notes.mjs')) {
  const version = process.argv[2]
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  const section = version ? changelogSection(text, version) : null
  if (!section) {
    console.error(`release-notes: CHANGELOG.md has no section for ${version ?? '(no version given)'}`)
    process.exit(1)
  }
  console.log(section)
}
