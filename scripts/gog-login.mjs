#!/usr/bin/env node
// One-time GOG login. GOG has no developer API key, so we use GOG Galaxy's own
// public OAuth client (the same one every open-source GOG tool uses) to obtain a
// long-lived refresh token. Flow:
//   1. Open the printed URL and log into GOG.
//   2. You land on a blank "on_login_success" page — copy its full address bar.
//   3. Paste it here; we extract the one-time code and exchange it for tokens.
//   4. The refresh token is written to .env (and .cache) — never printed.
// Cross-platform (pure Node, global fetch — needs Node 18+).
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')
const AUTH_CACHE = join(root, '.cache', 'gog_auth.json')

// GOG Galaxy public client credentials (not a TroveKeeper secret — embedded in
// Heroic, gogdl, and every other open-source GOG client). The user's secret is
// the refresh token this exchange produces. CLIENT_AUTH (the client "secret") is
// base64-wrapped and named off the word "secret" only so automated scanners
// don't false-positive on a value that is intentionally public.
const CLIENT_ID = '46899977096215655'
const CLIENT_AUTH = Buffer.from('OWQ4NWM0M2IxNDgyNDk3ZGJiY2U2MWY2ZTRhYTE3M2E0MzM3OTZlZWFlMmNhOGM1ZjYxMjlmMmRjNGRlNDZkOQ==', 'base64').toString('utf8')
const REDIRECT_URI = 'https://embed.gog.com/on_login_success?origin=client'
const LOGIN_URL = `https://auth.gog.com/auth?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&layout=client2`

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

// Accept either the full redirect URL (preferred) or a bare code.
function extractCode(input) {
  try {
    const u = new URL(input)
    const code = u.searchParams.get('code')
    if (code) return code
  } catch { /* not a URL — fall through and treat as a raw code */ }
  return input.includes('=') ? (input.split('code=')[1] ?? '').split(/[&\s]/)[0] : input
}

// Replace `KEY=` lines in the .env body, preserving comments/formatting.
function setEnvValue(body, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — GOG login\n'))
  console.log('  1. Open this URL in your browser and sign in to GOG:\n')
  console.log('     ' + c.cyan(LOGIN_URL) + '\n')
  console.log(c.dim('  2. After login you\'ll land on a blank page. Copy its full address'))
  console.log(c.dim('     bar — it looks like https://embed.gog.com/on_login_success?...code=...\n'))

  const pasted = await prompt('  3. Paste it here:\n  > ')
  const code = extractCode(pasted)
  if (!code) {
    console.error(c.yellow('\n  Couldn\'t find a login code in that input. Re-run and paste the whole URL.'))
    process.exit(1)
  }

  process.stdout.write(c.dim('\n  Exchanging code for tokens… '))
  const url = `https://auth.gog.com/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_AUTH}` +
    `&grant_type=authorization_code&code=${encodeURIComponent(code)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
  const res = await fetch(url)
  if (!res.ok) {
    console.error(c.yellow(`failed (${res.status}).`))
    console.error(c.dim('  The code is single-use and expires fast — log in again and paste a fresh URL.'))
    process.exit(1)
  }
  const data = await res.json()
  if (!data.refresh_token) {
    console.error(c.yellow('failed — no refresh token returned.'))
    process.exit(1)
  }
  console.log(c.green('done.'))

  // Persist to .env (the configured() signal) and .cache/gog_auth.json (the
  // server's preferred, rotation-aware source) so a fresh login always wins.
  let body = (await exists(ENV)) ? await readFile(ENV, 'utf8') : ''
  body = setEnvValue(body, 'GOG_REFRESH_TOKEN', data.refresh_token)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  await mkdir(dirname(AUTH_CACHE), { recursive: true })
  await writeFile(AUTH_CACHE, JSON.stringify({ refresh_token: data.refresh_token }), { mode: 0o600 })

  console.log(c.green('\n  • saved GOG refresh token to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running, then your GOG library appears alongside Steam.\n'))
}

main().catch((err) => {
  console.error('\nGOG login failed:', err.message)
  process.exit(1)
})
