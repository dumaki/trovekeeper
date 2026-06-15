// Amazon (Prime Gaming / Amazon Games) provider. Auth is the Amazon Games
// launcher's Login-with-Amazon device flow (same one Nile/Heroic use): a one-time
// browser OAuth (`npm run amazon-login`) registers a "device" and yields a
// long-lived refresh token + a device serial. The server refreshes that into
// short-lived bearer access tokens and reads the owned/claimed library from the
// Amazon Games entitlements service.
//
// Tokens: AMAZON_REFRESH_TOKEN (+ AMAZON_SERIAL — the registered device serial,
// needed for the entitlements hardwareHash). What Amazon exposes: owned/claimed
// games + key art + (in productDetail) developer/publisher/release/description.
// No playtime, no achievements. Games default to "Backlog".
import { createHash } from 'node:crypto'
import type { Game, GameStatus, ReviewBand, StoreKey } from '../../src/data/mockData'
import type { GameDetail } from './steam'
import { readCache, writeCache } from '../cache'

const AMAZON_API = 'https://api.amazon.com'
const ENTITLEMENTS_URL = 'https://gaming.amazon.com/api/distribution/entitlements'
const GET_ENTITLEMENTS = 'com.amazon.animusdistributionservice.entitlement.AnimusEntitlementsService.GetEntitlements'
const LAUNCHER_UA = 'com.amazon.agslauncher.win/3.0.9202.1'
// Public Amazon Games launcher constant (a UUID, not a secret).
const ENTITLEMENTS_KEY_ID = 'd5dc8b8b-86c8-4fc4-ae93-18c0def5314d'

export const configured = () => Boolean(refreshToken() && deviceSerial())

// ---- Credential management (refresh token + device serial) ----------------
interface AuthCache { refresh?: string; serial?: string }
let authMemo: AuthCache | null = null

function loadAuth(): AuthCache {
  if (authMemo) return authMemo
  authMemo = { refresh: process.env.AMAZON_REFRESH_TOKEN || undefined, serial: process.env.AMAZON_SERIAL || undefined }
  return authMemo
}
let hydrated = false
async function hydrateAuth(): Promise<void> {
  if (hydrated) return
  hydrated = true
  const disk = await readCache<AuthCache>('amazon_auth.json', {})
  const base = loadAuth()
  authMemo = { refresh: disk.refresh || base.refresh, serial: disk.serial || base.serial }
}
const refreshToken = () => loadAuth().refresh
const deviceSerial = () => loadAuth().serial

/** Persist refresh token + serial — used by the login helper only. */
export async function persistAuth(refresh: string, serial: string): Promise<void> {
  authMemo = { refresh, serial }
  hydrated = true
  await writeCache('amazon_auth.json', { refresh, serial })
}

let access: { token: string; exp: number } | null = null
let accessInflight: Promise<string> | null = null

async function accessToken(): Promise<string> {
  if (access && Date.now() < access.exp - 60_000) return access.token
  if (accessInflight) return accessInflight
  accessInflight = (async () => {
    await hydrateAuth()
    const rt = refreshToken()
    if (!rt) throw new Error('Amazon not authenticated — run `npm run amazon-login`')
    const res = await fetch(`${AMAZON_API}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': LAUNCHER_UA },
      body: JSON.stringify({
        source_token: rt, source_token_type: 'refresh_token',
        requested_token_type: 'access_token',
        app_name: 'AGSLauncher for Windows', app_version: '1.0.0',
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Amazon token refresh -> ${res.status} (refresh token may be revoked — re-run \`npm run amazon-login\`)`)
    const j = (await res.json()) as any
    if (!j.access_token) throw new Error('Amazon token refresh returned no access_token')
    access = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
    return access.token
  })().finally(() => { accessInflight = null })
  return accessInflight
}

// ---- Library (Amazon Games entitlements) ----------------------------------
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007
  return 3_100_000_000 + h
}

interface AmazonRecord extends Game {
  storeId: string
  shortDescription: string
  developer: string
  publisher: string
  releaseDate: string
  genres: string[]
  categories: string[]
}

// Amazon's productDetail.details carries no box/key art — only a transparent
// `logoUrl` and landscape `backgroundUrl1/2`. Prefer the landscape background so
// the library card looks like the other stores' header art, not a floating logo.
function pickArt(details: any): string {
  return details?.backgroundUrl1 || details?.backgroundUrl2 || details?.logoUrl
    || (Array.isArray(details?.screenshots) ? details.screenshots[0] : '') || ''
}
const asStrings = (a: any): string[] => Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []

async function fetchLibrary(): Promise<AmazonRecord[]> {
  await hydrateAuth()
  const serial = deviceSerial()
  if (!serial) throw new Error('Amazon not authenticated — run `npm run amazon-login`')
  const token = await accessToken()
  const hardwareHash = createHash('sha256').update(serial).digest('hex').toUpperCase()

  const byId = new Map<string, AmazonRecord>()
  let nextToken: string | null = null
  for (let page = 0; page < 40; page++) {
    const res: Response = await fetch(ENTITLEMENTS_URL, {
      method: 'POST',
      headers: {
        'X-Amz-Target': GET_ENTITLEMENTS,
        'x-amzn-token': token,
        'User-Agent': LAUNCHER_UA,
        'Content-Type': 'application/json',
        'Content-Encoding': 'amz-1.0',
      },
      body: JSON.stringify({
        Operation: 'GetEntitlements', clientId: 'Sonic',
        syncPoint: null, nextToken, maxResults: 50,
        productIdFilter: null, keyId: ENTITLEMENTS_KEY_ID, hardwareHash,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 401 || res.status === 403) throw new Error('Amazon token rejected — re-run `npm run amazon-login`')
    if (!res.ok) throw new Error(`Amazon entitlements -> ${res.status}`)
    const j = (await res.json()) as any
    for (const ent of j.entitlements ?? []) {
      const p = ent?.product
      const id = String(p?.id ?? p?.asin ?? '')
      if (!id || byId.has(id)) continue
      const d = p?.productDetail?.details ?? {}
      byId.set(id, {
        appid: hashId(id), storeId: id,
        name: p?.title ?? d?.title ?? 'Amazon game',
        store: 'Amazon' as StoreKey, status: 'Backlog' as GameStatus,
        playtimeHours: 0, reviewPct: 0, reviewBand: 'Mostly Positive' as ReviewBand,
        headerImage: pickArt(d),
        shortDescription: d?.shortDescription ?? '',
        developer: d?.developer ?? '',
        publisher: d?.publisher ?? '',
        releaseDate: typeof d?.releaseDate === 'string' ? d.releaseDate.slice(0, 10) : '',
        genres: asStrings(d?.genres),
        categories: asStrings(d?.gameModes),
      })
    }
    nextToken = j.nextToken ?? null
    if (!nextToken) break
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const LIST_TTL = 6 * 60 * 60 * 1000
interface GamesCache { games: AmazonRecord[]; at: number }
let memo: GamesCache | null = null
let inflight: Promise<AmazonRecord[]> | null = null
let warmingFlag = false

async function loadRecords(): Promise<AmazonRecord[]> {
  if (!configured()) return []
  if (!memo) {
    const disk = await readCache<GamesCache>('amazon_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (inflight) return inflight
  warmingFlag = true
  inflight = fetchLibrary()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('amazon_games.json', memo)
      return games
    })
    .catch(async (e) => {
      console.error('[amazon] library fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('amazon_games.json', { games: [], at: 0 })
      if (disk.games.length) memo = disk
      return disk.games
    })
    .finally(() => { inflight = null; warmingFlag = false })
  return inflight
}

export async function getGames(): Promise<Game[]> {
  return loadRecords()
}

export const warming = () => warmingFlag

export async function getGameDetail(appid: number, storeId?: string): Promise<GameDetail> {
  const rec = (await loadRecords()).find((r) => r.appid === appid || (storeId && r.storeId === storeId))
  return {
    appid: rec ? rec.appid : 0,
    name: rec?.name ?? 'Amazon game',
    shortDescription: rec?.shortDescription ?? '',
    developers: rec?.developer ? [rec.developer] : [],
    publishers: rec?.publisher ? [rec.publisher] : [],
    releaseDate: rec?.releaseDate ?? '',
    genres: rec?.genres ?? [],
    categories: rec?.categories ?? [],
    headerImage: rec?.headerImage ?? '',
    achievements: [], // not on this surface
  }
}

// ---- Background warmer ----------------------------------------------------
let warmerStarted = false
export function startWarmer(): void {
  if (warmerStarted || !configured()) return
  warmerStarted = true
  const tick = async () => {
    try { await getGames() } catch (e) { console.error('[amazon] warmer error:', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 5_500)
  console.log('[amazon] warmer started — owned/claimed library refresh')
}
