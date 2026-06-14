#!/usr/bin/env node
// Redacted diagnostics — SAFE to paste into a GitHub issue.
// Never prints any secret value (not even a partial). Use this instead of
// sharing your .env when troubleshooting.
import { readFile, access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exists = (p) => access(p, constants.F_OK).then(() => true, () => false)
const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`
const bad = (s) => `\x1b[31m✗ ${s}\x1b[0m`
const warn = (s) => `\x1b[33m! ${s}\x1b[0m`

let problems = 0

function parseEnv(body) {
  const map = {}
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) map[m[1]] = m[2]
  }
  return map
}

function git(args) {
  try { return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }
  catch { return null }
}

console.log('\n  Steam Dashboard — doctor (redacted, safe to share)\n')

// 1) .env presence + permissions
const hasEnv = await exists(join(root, '.env'))
if (!hasEnv) {
  console.log('  ' + warn('.env not found — run `npm run setup`'))
} else {
  const mode = (await stat(join(root, '.env')).then((s) => s.mode & 0o777))
  const tight = mode === 0o600 || process.platform === 'win32'
  console.log('  ' + (tight ? ok(`.env present (mode ${mode.toString(8)})`)
                              : warn(`.env present but mode is ${mode.toString(8)} — prefer 600`)))
}

// 2) Per-provider env status — secrets shown as set/missing ONLY, no characters.
const providers = JSON.parse(await readFile(join(root, 'providers.json'), 'utf8')).providers
const env = hasEnv ? parseEnv(await readFile(join(root, '.env'), 'utf8')) : {}
console.log('\n  Providers')
for (const p of providers) {
  const ready = p.env.filter((e) => e.required).every((e) => env[e.key])
  console.log(`    ${ready ? ok(p.label) : warn(p.label + ' (incomplete — will use mock data)')}`)
  for (const e of p.env) {
    const val = env[e.key]
    let status
    if (!val) { status = e.required ? bad('missing') : warn('unset (optional)'); if (e.required) problems++ }
    else if (e.secret) status = ok('set') // never reveal any portion of a secret
    else status = ok(`set (${maskId(val)})`) // non-secret id: masked middle
    console.log(`      ${e.key.padEnd(16)} ${status}`)
  }
}

// 3) Git safety: .env must NOT be tracked.
console.log('\n  Git safety')
const tracked = git(['ls-files', '.env'])
if (tracked) { console.log('    ' + bad('.env is TRACKED by git — remove it: git rm --cached .env')); problems++ }
else console.log('    ' + ok('.env is not tracked'))

const ignored = git(['check-ignore', '.env'])
console.log('    ' + (ignored ? ok('.env is git-ignored') : warn('.env not matched by .gitignore')))

const hooks = git(['config', 'core.hooksPath'])
console.log('    ' + (hooks === '.githooks' ? ok('secret-guard hook active')
                                            : warn('pre-commit hook not active — run `npm run setup`')))

console.log('')
if (problems) { console.log(`  ${bad(problems + ' issue(s) need attention')}\n`); process.exit(1) }
console.log('  \x1b[32mAll good.\x1b[0m\n')

// Mask a non-secret identifier: keep first 4 + last 2, hide the middle.
function maskId(v) {
  if (v.length <= 6) return '••••'
  return v.slice(0, 4) + '•'.repeat(Math.max(3, v.length - 6)) + v.slice(-2)
}
