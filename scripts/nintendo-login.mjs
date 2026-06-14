#!/usr/bin/env node
// Periodic Nintendo login. Nintendo has no developer API; the eShop site
// (ec.nintendo.com) is a Next.js/NextAuth app, so we capture its SESSION COOKIE.
// The server calls /api/auth/session with it to mint short-lived id_tokens. The
// cookie lasts ~30 days, so re-run this roughly monthly (the library keeps
// serving its last cache in the meantime).
//
// Flow (two separate cookies — the eShop and the Store use different sessions):
//   1. Sign in at https://ec.nintendo.com/my/transactions/1 (eShop history).
//   2. Open DevTools > Network, reload, click any ec.nintendo.com request (e.g.
//      `session`), right-click > Copy > "Copy as cURL". Paste the whole thing.
//   3. (Optional) Repeat on your nintendo.com Store wishlist page for the
//      wishlist cookie.
// We pull the `Cookie:` header out of the cURL and write it to .env (never shown).
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')
const AUTH_CACHE = join(root, '.cache', 'nintendo_auth.json')

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

// Accept either a full "Copy as cURL" blob or a bare `Cookie` value.
function extractCookie(input) {
  if (!input) return ''
  // curl: -H 'Cookie: a=b; c=d'  (single or double quotes, optional -b form)
  const m = input.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i)
    || input.match(/-b\s+['"]([^'"]+)['"]/i)
    || input.match(/cookie:\s*([^\n'"]+)/i)
  if (m) return m[1].trim()
  // Otherwise assume they pasted the cookie string itself.
  return input.includes('=') ? input : ''
}

function setEnvValue(body, key, value) {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, line) : `${body}\n${line}`
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — Nintendo (eShop) login\n'))
  console.log(c.dim('  Nintendo has no API token — we capture your browser session cookie'))
  console.log(c.dim('  (good for ~30 days). Re-run this when your library stops updating.\n'))

  console.log('  1. Sign in at ' + c.cyan('https://ec.nintendo.com/my/transactions/1'))
  console.log(c.dim('  2. DevTools (F12) > Network > reload > click any ec.nintendo.com request'))
  console.log(c.dim('     > right-click > Copy > "Copy as cURL", then paste it below.\n'))
  const cookie = extractCookie(await prompt('  Paste eShop cURL (or Cookie value):\n  > '))
  if (!cookie) {
    console.error(c.yellow('\n  Could not find a Cookie in that input. Re-run and paste the full "Copy as cURL".'))
    process.exit(1)
  }

  // The Store wishlist endpoint isn't wired up yet (its API is still unverified),
  // so the wishlist stays dormant until both a cookie AND NINTENDO_WISHLIST_URL
  // are known. We skip prompting for it to avoid saving a credential that does
  // nothing — revisit once the endpoint is captured.
  const storeCookie = ''

  let body = (await exists(ENV)) ? await readFile(ENV, 'utf8') : ''
  body = setEnvValue(body, 'NINTENDO_COOKIE', cookie)
  if (storeCookie) body = setEnvValue(body, 'NINTENDO_STORE_COOKIE', storeCookie)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  await mkdir(dirname(AUTH_CACHE), { recursive: true })
  await writeFile(AUTH_CACHE, JSON.stringify({ cookie, ...(storeCookie ? { storeCookie } : {}) }), { mode: 0o600 })

  console.log(c.green('\n  • saved Nintendo eShop cookie to .env (not shown)'))
  if (storeCookie) console.log(c.green('  • saved Nintendo Store (wishlist) cookie to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running — your Nintendo library appears alongside Steam.\n'))
}

main().catch((err) => {
  console.error('\nNintendo login failed:', err.message)
  process.exit(1)
})
