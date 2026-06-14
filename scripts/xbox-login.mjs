#!/usr/bin/env node
// One-time Xbox (Microsoft) login. Uses Xbox's public OAuth client (no secret).
// Flow:
//   1. Open the printed URL and sign in with your Microsoft account.
//   2. You land on a blank "Working..." page at login.live.com/oauth20_desktop.srf
//      whose address bar has ?code=... — copy the whole URL (or just the code).
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
const AUTH_CACHE = join(root, '.cache', 'xbox_auth.json')

// Public Xbox app client (XBOX_APP) — public client, no secret. 16-hex id.
const CLIENT_ID = '000000004C12AE6F'
const REDIRECT = 'https://login.live.com/oauth20_desktop.srf'
const SCOPE = 'Xboxlive.signin Xboxlive.offline_access'
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf'
const AUTH_URL = `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}` +
  `&response_type=code&approval_prompt=auto&scope=${encodeURIComponent(SCOPE)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}`

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

// MS codes contain dots/dashes, so grab the full `code` param (not just \w).
function extractCode(input) {
  try {
    const u = new URL(input)
    const code = u.searchParams.get('code')
    if (code) return code
  } catch { /* not a URL */ }
  return input.includes('code=') ? (input.split('code=')[1] ?? '').split('&')[0] : input
}

function setEnvValue(body, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — Xbox (Microsoft) login\n'))
  console.log('  1. Open this URL and sign in with your Microsoft account:\n')
  console.log('     ' + c.cyan(AUTH_URL) + '\n')
  console.log(c.dim('  2. You land on a blank "Working..." page. Copy its full address bar'))
  console.log(c.dim('     (https://login.live.com/oauth20_desktop.srf?code=...).\n'))

  const pasted = await prompt('  3. Paste it here:\n  > ')
  const code = extractCode(pasted)
  if (!code) {
    console.error(c.yellow('\n  Couldn\'t find a code in that input. Re-run and paste the whole redirect URL.'))
    process.exit(1)
  }

  process.stdout.write(c.dim('\n  Exchanging code for tokens… '))
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}` +
      `&scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(REDIRECT)}&client_id=${CLIENT_ID}`,
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
  body = setEnvValue(body, 'XBOX_REFRESH_TOKEN', data.refresh_token)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  await mkdir(dirname(AUTH_CACHE), { recursive: true })
  await writeFile(AUTH_CACHE, JSON.stringify({ refresh_token: data.refresh_token }), { mode: 0o600 })

  console.log(c.green('\n  • saved Xbox refresh token to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running, then your Xbox library appears alongside Steam.\n'))
}

main().catch((err) => {
  console.error('\nXbox login failed:', err.message)
  process.exit(1)
})
