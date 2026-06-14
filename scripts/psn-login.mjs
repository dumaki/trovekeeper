#!/usr/bin/env node
// One-time PlayStation login. PSN has no developer API key; auth uses an `npsso`
// cookie. Flow:
//   1. Sign in to PlayStation in your browser.
//   2. Open https://ca.account.sony.com/api/v1/ssocookie — it returns a small
//      JSON blob {"npsso":"<token>"}.
//   3. Paste it here; we write the npsso to .env (the server exchanges it for
//      OAuth tokens). Set your trophy/game privacy to "Anyone" so data loads.
// Cross-platform (pure Node — needs Node 18+).
import { readFile, writeFile, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')
const SSO_URL = 'https://ca.account.sony.com/api/v1/ssocookie'

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

// Accept the bare npsso token or the full {"npsso":"..."} blob.
function extractNpsso(input) {
  try {
    const j = JSON.parse(input)
    if (j.npsso) return j.npsso
  } catch { /* not JSON */ }
  const m = input.match(/npsso["'\s:=]+([A-Za-z0-9]+)/)
  if (m) return m[1]
  return input
}

function setEnvValue(body, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — PlayStation login\n'))
  console.log('  1. Sign in to PlayStation in your browser, then open:\n')
  console.log('     ' + c.cyan(SSO_URL) + '\n')
  console.log(c.dim('     It returns a blob like {"npsso":"<64-char token>"}.'))
  console.log(c.dim('     Tip: set trophy/game privacy to "Anyone" so your library loads.\n'))

  const pasted = await prompt('  2. Paste it here:\n  > ')
  const npsso = extractNpsso(pasted)
  if (!npsso || npsso.length < 16) {
    console.error(c.yellow('\n  That doesn\'t look like an npsso. Re-run and paste the token (or the whole blob).'))
    process.exit(1)
  }

  let body = (await exists(ENV)) ? await readFile(ENV, 'utf8') : ''
  body = setEnvValue(body, 'PSN_NPSSO', npsso)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  console.log(c.green('\n  • saved PSN npsso to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running, then your PlayStation library + trophies appear alongside Steam.\n'))
}

main().catch((err) => {
  console.error('\nPSN login failed:', err.message)
  process.exit(1)
})
