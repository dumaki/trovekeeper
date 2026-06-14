// IGDB (Twitch) time-to-beat enrichment. Official API: authenticate with a
// Twitch app's client-credentials, then query IGDB. We map Steam appids ->
// IGDB game ids via the external_games endpoint (category 1 = Steam), then pull
// main-story time-to-beat. Both queries are batched (up to 500 per request,
// 4 req/s limit) so the whole library resolves in a handful of calls.
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token'
const IGDB = 'https://api.igdb.com/v4'
const STEAM_CATEGORY = 1 // IGDB external_game category for Steam
const BATCH = 400

const clientId = () => process.env.IGDB_CLIENT_ID
const clientSecret = () => process.env.IGDB_CLIENT_SECRET
export const igdbConfigured = () => Boolean(clientId() && clientSecret())

// Twitch app-access token (client-credentials). Cached in memory until ~expiry.
let token: { value: string; expiresAt: number } | null = null
async function getToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value
  const url = new URL(TWITCH_TOKEN_URL)
  url.searchParams.set('client_id', clientId()!)
  url.searchParams.set('client_secret', clientSecret()!)
  url.searchParams.set('grant_type', 'client_credentials')
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Twitch token -> ${res.status} (check IGDB credentials)`)
  const j = (await res.json()) as any
  token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 }
  return token.value
}

async function igdbQuery(endpoint: string, body: string): Promise<any[]> {
  const res = await fetch(`${IGDB}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': clientId()!,
      Authorization: `Bearer ${await getToken()}`,
      Accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(12_000),
  })
  if (res.status === 429) throw new Error('igdb 429')
  if (!res.ok) throw new Error(`igdb ${endpoint} -> ${res.status}: ${(await res.text()).slice(0, 120)}`)
  return res.json() as Promise<any[]>
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Resolve main-story hours for each appid. Returns a full map: number of hours,
// or null when IGDB has no match / no time-to-beat for that title.
export async function fetchTimeToBeat(appids: number[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}
  for (const a of appids) out[String(a)] = null
  if (appids.length === 0) return out

  // 1) Steam appid (uid) -> IGDB game id.
  const appidToGame: Record<string, number> = {}
  for (const batch of chunk(appids, BATCH)) {
    const uids = batch.map((a) => `"${a}"`).join(',')
    const rows = await igdbQuery(
      'external_games',
      `fields game,uid; where category = ${STEAM_CATEGORY} & uid = (${uids}); limit 500;`,
    )
    for (const r of rows) if (r.game && r.uid != null) appidToGame[String(r.uid)] = r.game
  }

  // 2) IGDB game id -> main-story seconds.
  const gameIds = [...new Set(Object.values(appidToGame))]
  const hoursByGame: Record<number, number> = {}
  for (const batch of chunk(gameIds, BATCH)) {
    const rows = await igdbQuery(
      'game_time_to_beats',
      `fields game_id,normally; where game_id = (${batch.join(',')}); limit 500;`,
    )
    for (const r of rows) {
      if (r.game_id && r.normally) hoursByGame[r.game_id] = Math.round((r.normally / 3600) * 10) / 10
    }
  }

  // 3) combine
  for (const [appid, gameId] of Object.entries(appidToGame)) {
    out[appid] = hoursByGame[gameId] ?? null
  }
  return out
}
