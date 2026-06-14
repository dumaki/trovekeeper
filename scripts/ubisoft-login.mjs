#!/usr/bin/env node
// One-time Ubisoft Connect login. Ubisoft locked down raw email/password auth
// (429), so we capture the browser's long-lived `rememberMeTicket` and let the
// server refresh it into short-lived tickets (rm_v1 scheme). The rememberMeTicket
// rotates on every use, so we validate it once here and save the ROTATED value
// the refresh returns — otherwise the saved ticket would already be spent.
//
// Flow:
//   1. Sign in at https://www.ubisoft.com (tick "stay signed in").
//   2. Open DevTools (F12) > Console, paste this one-liner and hit enter — it
//      copies your rememberMeTicket to the clipboard:
//        copy((Object.values(localStorage).map(v=>{try{return JSON.parse(v)}catch{return 0}}).find(o=>o&&o.rememberMeTicket)||{}).rememberMeTicket||'NOT FOUND')
//      (If it copies "NOT FOUND", instead capture the Network response of the
//       POST to public-ubiservices.ubi.com/v3/profiles/sessions and paste that
//       whole JSON — we'll pull rememberMeTicket out of it.)
//   3. Paste here. We verify it and write UBISOFT_REMEMBER_TOKEN to .env.
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')
const AUTH_CACHE = join(root, '.cache', 'ubisoft_auth.json')

const UBI_APPID = '74e71609-1ddf-47da-9073-71ac3aa8c90c'
const SESSIONS_URL = 'https://public-ubiservices.ubi.com/v3/profiles/sessions'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

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

// Accept the raw ticket, or a pasted JSON blob containing rememberMeTicket.
function extractTicket(input) {
  if (!input) return ''
  const m = input.match(/"?rememberMeTicket"?\s*[:=]\s*"?([A-Za-z0-9_.\-]+)"?/)
  if (m) return m[1]
  return /^[A-Za-z0-9_.\-]+$/.test(input) ? input : ''
}

function setEnvValue(body, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — Ubisoft Connect login\n'))
  console.log('  1. Sign in at ' + c.cyan('https://www.ubisoft.com') + c.dim('  (tick "stay signed in")'))
  console.log(c.dim('  2. DevTools (F12) > Console, paste the one-liner from this script\'s'))
  console.log(c.dim('     comment to copy your rememberMeTicket, then paste it below.\n'))

  const rm = extractTicket(await prompt('  3. Paste rememberMeTicket (or the sessions JSON):\n  > '))
  if (!rm) {
    console.error(c.yellow('\n  No rememberMeTicket found in that input. Re-run and paste it (or the sessions response JSON).'))
    process.exit(1)
  }

  process.stdout.write(c.dim('\n  Verifying & refreshing… '))
  const res = await fetch(SESSIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `rm_v1 t=${rm}`,
      'Ubi-AppId': UBI_APPID,
      'Ubi-RequestedPlatformType': 'uplay',
      'Content-Type': 'application/json',
      'User-Agent': UA,
    },
    body: JSON.stringify({ rememberMe: true }),
  }).catch(() => null)
  if (!res || !res.ok) {
    console.error(c.yellow(`failed${res ? ` (${res.status})` : ''}.`))
    console.error(c.dim('  That ticket was rejected — sign in again and re-copy a fresh rememberMeTicket.'))
    process.exit(1)
  }
  const data = await res.json().catch(() => ({}))
  // The refresh rotates the ticket — persist the NEW one (the pasted one is now spent).
  const rotated = data.rememberMeTicket || rm
  console.log(c.green('done.') + (data.nameOnPlatform ? c.dim(`  (signed in as ${data.nameOnPlatform})`) : ''))

  let body = (await exists(ENV)) ? await readFile(ENV, 'utf8') : ''
  body = setEnvValue(body, 'UBISOFT_REMEMBER_TOKEN', rotated)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  await mkdir(dirname(AUTH_CACHE), { recursive: true })
  await writeFile(AUTH_CACHE, JSON.stringify({ rememberMe: rotated }), { mode: 0o600 })

  console.log(c.green('\n  • saved Ubisoft rememberMe token to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running — your Ubisoft library appears alongside Steam.\n'))
}

main().catch((err) => {
  console.error('\nUbisoft login failed:', err.message)
  process.exit(1)
})
