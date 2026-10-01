// A small argument parser: util.parseArgs arrived in Node 18.3 and the floor is 18.0.
// `spec` maps a long option to 'boolean' or 'string'; anything else is an error.
export function parseArgs(argv, spec) {
  const values = {}
  const positionals = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (!a.startsWith('--')) {
      positionals.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const name = a.slice(2, eq < 0 ? undefined : eq)
    const type = spec[name]
    if (!type) throw new Error(`unknown option --${name}`)
    if (type === 'boolean') {
      if (eq >= 0) throw new Error(`--${name} takes no value`)
      values[name] = true
    } else {
      const v = eq >= 0 ? a.slice(eq + 1) : argv[++i]
      if (v === undefined || (eq < 0 && v.startsWith('--'))) throw new Error(`--${name} needs a value`)
      values[name] = v
    }
  }
  return { values, positionals }
}
