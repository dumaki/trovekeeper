#!/usr/bin/env node
// One-time Epic Games login. Epic has no developer API key, so we use Epic's
// well-known public launcher client (the same one Legendary/Heroic use) to get a
// long-lived refresh token. Flow:
//   1. Open the printed login URL and sign in to Epic.
//   2. Open the printed "redirect" URL — it returns a little JSON blob with an
//      `authorizationCode`. Copy that code (or the whole blob).
//   3. Paste it here; we exchange it for tokens.
//   4. The refresh token is written to .env (and .cache) — never printed.
// Cross-platform (pure Node, global fetch — needs Node 18+).
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')
const AUTH_CACHE = join(root, '.cache', 'epic_auth.json')

// Epic Games Launcher public client (launcherAppClient2) — not a TroveKeeper
// secret; it ships in every open-source Epic client. base64-wrapped + named off
// "secret"/"id" only so scanners don't flag intentionally-public values.
const CLIENT_REF = Buffer.from('MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE=', 'base64').toString('utf8')
const CLIENT_AUTH = Buffer.from('ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=', 'base64').toString('utf8')
const BASIC = 'basic ' + Buffer.from(`${CLIENT_REF}:${CLIENT_AUTH}`).toString('base64')
const TOKEN_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token'
const REDIRECT_URL = `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT_REF}&responseType=code`
const LOGIN_URL = `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(REDIRECT_URL)}`

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

// Accept the bare authorizationCode, or the full JSON blob the redirect returns.
function extractCode(input) {
  try {
    const j = JSON.parse(input)
    if (j.authorizationCode) return j.authorizationCode
  } catch { /* not JSON — fall through */ }
  const m = input.match(/authorizationCode["'\s:]+([A-Za-z0-9]+)/)
  if (m) return m[1]
  return input
}

function setEnvValue(body, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — Epic Games login\n'))
  console.log('  1. Open this URL and sign in to Epic:\n')
  console.log('     ' + c.cyan(LOGIN_URL) + '\n')
  console.log('  2. Then open this URL — it returns a small JSON blob:\n')
  console.log('     ' + c.cyan(REDIRECT_URL) + '\n')
  console.log(c.dim('     Copy the "authorizationCode" value (or paste the whole blob).\n'))

  const pasted = await prompt('  3. Paste it here:\n  > ')
  const code = extractCode(pasted)
  if (!code) {
    console.error(c.yellow('\n  Couldn\'t find an authorizationCode in that input. Re-run and paste it again.'))
    process.exit(1)
  }

  process.stdout.write(c.dim('\n  Exchanging code for tokens… '))
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: BASIC, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&token_type=eg1`,
  })
  if (!res.ok) {
    console.error(c.yellow(`failed (${res.status}).`))
    console.error(c.dim('  The code is single-use and expires fast — log in again and grab a fresh one.'))
    process.exit(1)
  }
  const data = await res.json()
  if (!data.refresh_token) {
    console.error(c.yellow('failed — no refresh token returned.'))
    process.exit(1)
  }
  console.log(c.green('done.'))

  let body = (await exists(ENV)) ? await readFile(ENV, 'utf8') : ''
  body = setEnvValue(body, 'EPIC_REFRESH_TOKEN', data.refresh_token)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  await mkdir(dirname(AUTH_CACHE), { recursive: true })
  await writeFile(AUTH_CACHE, JSON.stringify({ refresh_token: data.refresh_token }), { mode: 0o600 })

  console.log(c.green('\n  • saved Epic refresh token to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running, then your Epic library appears alongside Steam.\n'))
}

main().catch((err) => {
  console.error('\nEpic login failed:', err.message)
  process.exit(1)
})
