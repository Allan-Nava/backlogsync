#!/usr/bin/env node
// backlogsync — BACKLOG.md as the single source of truth: a generated ROADMAP.md and a
// one-way sync to GitHub issues and milestones.
//
//   backlogsync roadmap      write ROADMAP.md from BACKLOG.md
//   backlogsync check        validate BACKLOG.md and fail if ROADMAP.md is stale
//   backlogsync sync         sync the issues and milestones (GITHUB_TOKEN, GITHUB_REPOSITORY)
//     --dry-run              print the plan, change nothing
//     --milestones v0.1.0,…  limit to these milestones, by version
//
// Options for every command:
//   --config <file>          a config file instead of .backlogsync.json / package.json
//   --backlog <file>         read this backlog instead of the configured one
//   --roadmap <file>         write or compare this roadmap instead of the configured one
//
// Exit codes: 0 ok, 1 a problem found (or a failed API call), 2 usage or configuration.
import { appendFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/args.mjs'
import { lint, parse, roadmap } from './lib/backlog.mjs'
import { ConfigError, loadConfig } from './lib/config.mjs'
import { client, GitHubError } from './lib/github.mjs'
import { sync } from './lib/sync.mjs'

const SELF = fileURLToPath(import.meta.url)
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const usage = () =>
  readFileSync(SELF, 'utf8')
    .split('\n')
    .slice(1, 16)
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n')

class UsageError extends Error {}

export async function main(argv = process.argv.slice(2), env = process.env, out = console.log, errOut = console.error) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    out(usage())
    return 0
  }
  if (cmd === '--version' || cmd === '-v') {
    out(VERSION)
    return 0
  }
  try {
    if (!['roadmap', 'check', 'sync'].includes(cmd)) throw new UsageError(`unknown command "${cmd}" — try roadmap, check or sync`)
    const spec = { config: 'string', backlog: 'string', roadmap: 'string' }
    if (cmd === 'sync') Object.assign(spec, { 'dry-run': 'boolean', milestones: 'string' })
    let args
    try {
      args = parseArgs(rest, spec)
    } catch (e) {
      throw new UsageError(e.message)
    }
    if (args.positionals.length) throw new UsageError(`unexpected argument "${args.positionals[0]}"`)
    const cfg = loadConfig({ configPath: args.values.config })
    if (args.values.backlog) cfg.backlog = resolve(args.values.backlog)
    if (args.values.roadmap) cfg.roadmap = resolve(args.values.roadmap)

    let text
    try {
      text = readFileSync(cfg.backlog, 'utf8')
    } catch {
      throw new ConfigError(`cannot read the backlog at ${args.values.backlog ?? cfg.backlogRel}`)
    }
    const model = parse(text, cfg)
    const errors = lint(model, cfg)
    if (errors.length) {
      for (const e of errors) errOut(e)
      errOut(`${errors.length} problem${errors.length === 1 ? '' : 's'} in ${cfg.backlogRel}`)
      return 1
    }

    if (cmd === 'roadmap') {
      writeFileSync(cfg.roadmap, roadmap(model, cfg))
      out(`wrote ${args.values.roadmap ?? cfg.roadmapRel} — ${model.items.length} items, ${model.milestones.length} milestones`)
      return 0
    }

    if (cmd === 'check') {
      let current = null
      try {
        current = readFileSync(cfg.roadmap, 'utf8')
      } catch {}
      if (current !== roadmap(model, cfg)) {
        errOut(`${cfg.roadmapRel} is ${current === null ? 'missing' : 'stale'} — run \`${cfg.regenerate}\` and commit the result`)
        return 1
      }
      out(`ok — ${model.items.length} items, ${model.milestones.length} milestones; ${cfg.roadmapRel} is in step with ${cfg.backlogRel}`)
      return 0
    }

    // sync
    const dryRun = Boolean(args.values['dry-run'])
    const token = env.GITHUB_TOKEN || env.GH_TOKEN || ''
    if (!token && !dryRun) throw new ConfigError('GITHUB_TOKEN is not set — a sync that changes issues needs one (--dry-run can do without on a public repository)')
    let gh
    try {
      gh = client({ token, repo: env.GITHUB_REPOSITORY, apiUrl: env.GITHUB_API_URL || undefined, userAgent: `backlogsync/${VERSION}` })
    } catch (e) {
      throw new ConfigError(e.message)
    }
    const only = (args.values.milestones ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const res = await sync(model, cfg, gh, { dryRun, only, server: env.GITHUB_SERVER_URL || undefined, log: out })
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        appendFileSync(env.GITHUB_STEP_SUMMARY, `### Backlog issue sync${dryRun ? ' — dry run' : ''}\n\n\`\`\`\n${res.summary}\n\`\`\`\n`)
      } catch {}
    }
    return 0
  } catch (e) {
    if (e instanceof UsageError || e instanceof ConfigError) {
      errOut(`backlogsync: ${e.message}`)
      if (e instanceof UsageError) errOut('run `backlogsync help` for usage')
      return 2
    }
    if (e instanceof GitHubError) {
      errOut(`backlogsync: ${e.message}`)
      return 1
    }
    throw e
  }
}

// Through npm's bin symlink argv[1] is the link, not this file.
const invoked = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)
  } catch {
    return false
  }
})()
if (invoked) {
  main().then((code) => {
    process.exitCode = code
  })
}
