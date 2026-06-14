#!/usr/bin/env node
// Resolve your SteamID64 from a vanity name or profile URL, using the API key
// already in .env. Prints ONLY the resolved id + display name — never the key.
//
//   npm run whoami -- <vanity-name | profile URL>
//   npm run whoami -- https://steamcommunity.com/id/gabelogannewell
//   npm run whoami -- gabelogannewell
import 'dotenv/config'

const key = process.env.STEAM_API_KEY
if (!key) {
  console.error('No STEAM_API_KEY found in .env — run `npm run setup` first.')
  process.exit(1)
}

const input = (process.argv[2] || '').trim()
if (!input) {
  console.error('\nUsage: npm run whoami -- <vanity-name or profile URL>\n')
  process.exit(1)
}

// A /profiles/<17 digits> URL already contains the SteamID64.
const direct = input.match(/(\d{17})/)
if (direct && (input.includes('/profiles/') || /^\d{17}$/.test(input))) {
  await report(direct[1])
  process.exit(0)
}

// Otherwise treat it as a vanity name (strip a /id/<name> URL down to the name).
const vanity = (input.match(/\/id\/([^/?#]+)/)?.[1] ?? input).replace(/\/+$/, '')

const url = new URL('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/')
url.searchParams.set('key', key)
url.searchParams.set('vanityurl', vanity)

const res = await fetch(url).catch(() => null)
const json = res && res.ok ? await res.json().catch(() => null) : null

if (json?.response?.success === 1) {
  await report(json.response.steamid)
} else {
  console.error(`\n  Could not resolve "${vanity}".`)
  console.error('  Open your Steam profile in a browser:')
  console.error('   • URL like /profiles/7656119XXXXXXXXXX  → that 17-digit number IS your SteamID64.')
  console.error('   • URL like /id/<name>                   → run: npm run whoami -- <name>\n')
  process.exit(1)
}

async function report(steamid) {
  let name = ''
  try {
    const s = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamid}`,
    ).then((r) => r.json())
    name = s?.response?.players?.[0]?.personaname ?? ''
  } catch { /* name is optional */ }

  console.log(`\n  SteamID64:  \x1b[1m${steamid}\x1b[0m${name ? `   (${name})` : ''}`)
  console.log('\n  Set it with:  npm run setup   (paste at the STEAM_ID prompt)\n')
}
