#!/usr/bin/env node
// One-time itch.io login. itch has the simplest auth of any store: a personal
// API key (no OAuth, no browser redirect). Generate one and paste it here.
//
// Flow:
//   1. Open https://itch.io/user/settings/api-keys (sign in if needed).
//   2. Click "Generate new API key", copy the key.
//   3. Paste it here. We verify it against /profile, then write ITCH_API_KEY
//      to .env (never shown). The key is long-lived (revoke it any time).
import { readFile, writeFile, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false)

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

function setEnvValue(body, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — itch.io login\n'))
  console.log('  1. Open ' + c.cyan('https://itch.io/user/settings/api-keys'))
  console.log(c.dim('  2. "Generate new API key", then copy it.\n'))

  const key = await prompt('  3. Paste your itch.io API key:\n  > ')
  if (!key) {
    console.error(c.yellow('\n  No key entered. Re-run and paste the API key.'))
    process.exit(1)
  }

  process.stdout.write(c.dim('\n  Verifying key… '))
  const res = await fetch('https://api.itch.io/profile', {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  }).catch(() => null)
  if (!res || !res.ok) {
    console.error(c.yellow(`failed${res ? ` (${res.status})` : ''}.`))
    console.error(c.dim('  That key was rejected — generate a fresh one and try again.'))
    process.exit(1)
  }
  const who = await res.json().catch(() => ({}))
  console.log(c.green('done.') + (who?.user?.username ? c.dim(`  (signed in as ${who.user.username})`) : ''))

  let body = (await exists(ENV)) ? await readFile(ENV, 'utf8') : ''
  body = setEnvValue(body, 'ITCH_API_KEY', key)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  console.log(c.green('\n  • saved itch.io API key to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running — your itch.io library appears alongside Steam.\n'))
}

main().catch((err) => {
  console.error('\nitch.io login failed:', err.message)
  process.exit(1)
})
