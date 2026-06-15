#!/usr/bin/env node
// One-time Amazon (Prime Gaming / Amazon Games) login. Uses the Amazon Games
// launcher's Login-with-Amazon device flow (same as Nile/Heroic) — a browser
// login that registers a "device" and returns a long-lived refresh token.
//
// Flow:
//   1. Open the printed URL, sign in to Amazon.
//   2. You're redirected to an amazon.com page whose address bar contains
//      ?...&openid.oa2.authorization_code=...  — copy the WHOLE URL.
//   3. Paste it here. We register a device and save the refresh token + the
//      device serial (needed for the library's hardwareHash) to .env.
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import readline from 'node:readline'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENV = join(root, '.env')
const AUTH_CACHE = join(root, '.cache', 'amazon_auth.json')

const MARKETPLACE = 'ATVPDKIKX0DER'
const DEVICE_TYPE = 'A2UMVHOX7UP4V7'
const AMAZON_API = 'https://api.amazon.com'

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`,
}
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const exists = (p) => access(p, constants.F_OK).then(() => true, () => false)
const prompt = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question(q, (a) => { rl.close(); res(a.trim()) })
})
function setEnvValue(body, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm')
  return re.test(body) ? body.replace(re, `${key}=${value}`) : `${body}\n${key}=${value}`
}
function extractCode(input) {
  try { const u = new URL(input); const v = u.searchParams.get('openid.oa2.authorization_code'); if (v) return v } catch { /* not a URL */ }
  const m = input.match(/openid\.oa2\.authorization_code=([^&\s]+)/)
  return m ? decodeURIComponent(m[1]) : (/^[A-Za-z0-9|_.\-]+$/.test(input) ? input : '')
}

async function main() {
  console.log(c.bold('\n  TroveKeeper — Amazon (Prime Gaming) login\n'))

  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const serial = randomUUID().replace(/-/g, '').toUpperCase()
  const clientId = Buffer.from(`${serial}#${DEVICE_TYPE}`, 'ascii').toString('hex')

  const url = 'https://amazon.com/ap/signin?' + new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.mode': 'checkid_setup',
    'openid.oa2.scope': 'device_auth_access',
    'openid.ns.oa2': 'http://www.amazon.com/ap/ext/oauth/2',
    'openid.oa2.response_type': 'code',
    'openid.oa2.code_challenge_method': 'S256',
    'openid.oa2.client_id': `device:${clientId}`,
    language: 'en_US', marketPlaceId: MARKETPLACE,
    'openid.return_to': 'https://www.amazon.com',
    'openid.pape.max_auth_age': '0',
    'openid.assoc_handle': 'amzn_sonic_games_launcher',
    pageId: 'amzn_sonic_games_launcher',
    'openid.oa2.code_challenge': challenge,
  }).toString()

  console.log('  1. Open this URL and sign in to Amazon:\n')
  console.log('     ' + c.cyan(url) + '\n')
  console.log(c.dim('  2. After signing in you land on an amazon.com page. Copy its FULL'))
  console.log(c.dim('     address-bar URL (it contains openid.oa2.authorization_code=...).\n'))

  const code = extractCode(await prompt('  3. Paste the redirect URL here:\n  > '))
  if (!code) {
    console.error(c.yellow('\n  Could not find an authorization code in that input. Re-run and paste the whole redirect URL.'))
    process.exit(1)
  }

  process.stdout.write(c.dim('\n  Registering device… '))
  const res = await fetch(`${AMAZON_API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_data: {
        authorization_code: code, client_domain: 'DeviceLegacy', client_id: clientId,
        code_algorithm: 'SHA-256', code_verifier: verifier, use_global_authentication: false,
      },
      registration_data: {
        app_name: 'AGSLauncher for Windows', app_version: '1.0.0', device_model: 'Windows',
        device_name: null, device_serial: serial, device_type: DEVICE_TYPE,
        domain: 'Device', os_version: '10.0.19044.0',
      },
      requested_extensions: ['customer_info', 'device_info'],
      requested_token_type: ['bearer', 'mac_dms'], user_context_map: {},
    }),
  }).catch(() => null)
  if (!res || !res.ok) {
    console.error(c.yellow(`failed${res ? ` (${res.status})` : ''}.`))
    console.error(c.dim('  The code is single-use and expires fast — sign in again and grab a fresh redirect URL.'))
    process.exit(1)
  }
  const data = await res.json()
  const success = data?.response?.success
  const refresh = success?.tokens?.bearer?.refresh_token
  const devSerial = success?.extensions?.device_info?.device_serial_number || serial
  const name = success?.extensions?.customer_info?.given_name
  if (!refresh) {
    console.error(c.yellow('failed — no refresh token in the registration response.'))
    process.exit(1)
  }
  console.log(c.green('done.') + (name ? c.dim(`  (signed in as ${name})`) : ''))

  let body = (await exists(ENV)) ? await readFile(ENV, 'utf8') : ''
  body = setEnvValue(body, 'AMAZON_REFRESH_TOKEN', refresh)
  body = setEnvValue(body, 'AMAZON_SERIAL', devSerial)
  await writeFile(ENV, body, { mode: 0o600 })
  try { await chmod(ENV, 0o600) } catch { /* non-POSIX */ }

  await mkdir(dirname(AUTH_CACHE), { recursive: true })
  await writeFile(AUTH_CACHE, JSON.stringify({ refresh, serial: devSerial }), { mode: 0o600 })

  console.log(c.green('\n  • saved Amazon refresh token + device serial to .env (not shown)'))
  console.log(c.bold('\n  Done. ') + c.dim('Restart the dev server if it\'s running — your Amazon library appears alongside Steam.\n'))
}

main().catch((err) => { console.error('\nAmazon login failed:', err.message); process.exit(1) })
