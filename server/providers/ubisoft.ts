// Ubisoft Connect provider. Ubisoft has no developer API and locked down raw
// email/password login (429 since 2026), so the durable credential is the
// browser's `rememberMeTicket` (captured once via `npm run ubisoft-login`). The
// server refreshes it into short-lived `Ubi_v1` tickets via
// POST /v3/profiles/sessions with `Authorization: rm_v1 t=<rememberMeTicket>`
// (the rememberMeTicket rotates on each refresh — we persist the new one).
//
// Data is assembled from three public-ubiservices endpoints (verified live):
//   - gamesplayed : the user's played games (spaceId + last-played) — backbone
//   - catalog     : spaceId -> displayName + cover art + release, with
//                   siblingGames grouping cross-platform duplicates
//   - stats       : per-game Playtime (seconds) -> hours
// Result: owned/played games + names + art + playtime + last-played (Xbox/PSN
// tier). No achievements on this surface. Games default to "Backlog".
import type { Game, GameStatus, ReviewBand, StoreKey } from '../../src/data/mockData'
import type { GameDetail } from './steam'
import { readCache, writeCache } from '../cache'

const BASE = 'https://public-ubiservices.ubi.com'
const SESSIONS_URL = `${BASE}/v3/profiles/sessions`
// Ubisoft web AppId (the one that issues the web rememberMeTicket). A hyphenated
// UUID, so it never trips the pre-commit 32-hex secret-guard.
const UBI_APPID = '74e71609-1ddf-47da-9073-71ac3aa8c90c'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export const configured = () => Boolean(rememberToken())

// ---- Credential management (rememberMeTicket -> Ubi_v1 ticket, cached) ------
interface AuthCache { rememberMe?: string }
let authMemo: AuthCache | null = null

function loadAuth(): AuthCache {
  if (authMemo) return authMemo
  authMemo = { rememberMe: process.env.UBISOFT_REMEMBER_TOKEN || undefined }
  return authMemo
}
let hydrated = false
async function hydrateAuth(): Promise<void> {
  if (hydrated) return
  hydrated = true
  const disk = await readCache<AuthCache>('ubisoft_auth.json', {})
  authMemo = { rememberMe: disk.rememberMe || loadAuth().rememberMe }
}
const rememberToken = () => loadAuth().rememberMe

/** Persist a (rotated or freshly-captured) rememberMeTicket — login helper + refresh. */
export async function persistRemember(rm: string): Promise<void> {
  authMemo = { rememberMe: rm }
  hydrated = true
  await writeCache('ubisoft_auth.json', { rememberMe: rm })
}

let session: { ticket: string; sessionId: string; exp: number } | null = null
let sessionInflight: Promise<{ ticket: string; sessionId: string }> | null = null

async function getSession(): Promise<{ ticket: string; sessionId: string }> {
  if (session && Date.now() < session.exp - 60_000) return { ticket: session.ticket, sessionId: session.sessionId }
  if (sessionInflight) return sessionInflight
  sessionInflight = (async () => {
    await hydrateAuth()
    const rm = rememberToken()
    if (!rm) throw new Error('Ubisoft not authenticated — run `npm run ubisoft-login`')
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
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Ubisoft session refresh -> ${res.status} (rememberMe ticket may be expired — re-run \`npm run ubisoft-login\`)`)
    const j = (await res.json()) as any
    if (!j.ticket || !j.sessionId) throw new Error('Ubisoft session refresh returned no ticket')
    const exp = j.expiration ? Date.parse(j.expiration) : Date.now() + 2 * 60 * 60 * 1000
    session = { ticket: j.ticket, sessionId: j.sessionId, exp }
    if (j.rememberMeTicket && j.rememberMeTicket !== rm) await persistRemember(j.rememberMeTicket) // rotates
    return { ticket: session.ticket, sessionId: session.sessionId }
  })().finally(() => { sessionInflight = null })
  return sessionInflight
}

function apiHeaders(s: { ticket: string; sessionId: string }) {
  return {
    Authorization: `Ubi_v1 t=${s.ticket}`,
    'Ubi-AppId': UBI_APPID,
    'Ubi-SessionId': s.sessionId,
    'Ubi-LocaleCode': 'en-US',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www.ubisoft.com',
    Referer: 'https://www.ubisoft.com/',
    'User-Agent': UA,
  }
}

// ---- Library (gamesplayed + catalog + stats) ------------------------------
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007
  return 2_900_000_000 + h
}

interface UbiRecord extends Game {
  storeId: string // primary spaceId
  shortDescription: string
  releaseDate: string
}

async function fetchLibrary(): Promise<UbiRecord[]> {
  const s = await getSession()
  const H = apiHeaders(s)

  // 1. played games (spaceId + last-played + profileId)
  const gpRes = await fetch(`${BASE}/v1/profiles/me/gamesplayed?spaceIds=&spacePlatformTypes=&applicationPlatformTypes=`, { headers: H, signal: AbortSignal.timeout(20_000) })
  if (gpRes.status === 401) throw new Error('Ubisoft ticket rejected — re-run `npm run ubisoft-login`')
  if (!gpRes.ok) throw new Error(`Ubisoft gamesplayed -> ${gpRes.status}`)
  const played: any[] = ((await gpRes.json()) as any)?.gamesPlayed ?? []
  const spaceIds = [...new Set(played.map((p) => p.spaceId).filter(Boolean))]
  const lastBySpace = new Map<string, string>()
  const profBySpace = new Map<string, string>()
  for (const p of played) {
    if (p.lastPlayed?.updatedAt) lastBySpace.set(p.spaceId, p.lastPlayed.updatedAt)
    if (p.profileId) profBySpace.set(p.spaceId, p.profileId)
  }
  if (!spaceIds.length) return []

  // 2. catalog resolves spaceId -> name/art (+ sibling grouping). Batch to keep URLs sane.
  const primaryOf = new Map<string, any>()
  for (let i = 0; i < spaceIds.length; i += 40) {
    const batch = spaceIds.slice(i, i + 40)
    const cRes = await fetch(`${BASE}/v1/spaces/global/ubiconnect/games/api/catalog?spaceIds=${batch.join(',')}`, { headers: H, signal: AbortSignal.timeout(20_000) })
    if (!cRes.ok) { console.error('[ubisoft] catalog batch ->', cRes.status); continue }
    for (const g of ((await cRes.json()) as any)?.games ?? []) {
      primaryOf.set(g.spaceId, g)
      for (const sib of g.siblingGames ?? []) primaryOf.set(sib.spaceId, g)
    }
  }

  // 3. dedup played spaceIds into catalog games (cross-platform installments merge).
  // Track each game's PLAYED (spaceId, profileId) members — playtime is recorded
  // under the spaceId actually played, which may be a sibling of the catalog primary.
  const lib = new Map<string, UbiRecord & { _members: { space: string; prof: string }[] }>()
  let unresolved = 0
  for (const sid of spaceIds) {
    const g = primaryOf.get(sid)
    if (!g) { unresolved++; continue }
    const key = g.spaceId
    let rec = lib.get(key)
    if (!rec) {
      rec = {
        appid: hashId(key), storeId: key,
        name: g.displayName ?? 'Ubisoft game',
        store: 'Ubisoft' as StoreKey, status: 'Backlog' as GameStatus,
        playtimeHours: 0, reviewPct: 0, reviewBand: 'Mostly Positive' as ReviewBand,
        headerImage: g.imageUrls?.highThumbnail || g.imageUrls?.highBoxArt || g.imageUrls?.lowThumbnail || '',
        shortDescription: g.displayDescription ?? '',
        releaseDate: typeof g.releaseAt === 'string' ? g.releaseAt.slice(0, 10) : '',
        lastPlayed: undefined,
        _members: [],
      }
      lib.set(key, rec)
    }
    const lp = lastBySpace.get(sid)
    if (lp) { const t = Math.floor(Date.parse(lp) / 1000); if (!rec.lastPlayed || t > rec.lastPlayed) rec.lastPlayed = t }
    const prof = profBySpace.get(sid)
    if (prof) rec._members.push({ space: sid, prof })
  }
  if (unresolved) console.log(`[ubisoft] ${unresolved} played spaceId(s) had no catalog entry (delisted) — skipped`)

  // 4. per-game playtime: sum the Playtime stat (seconds) across the game's played
  // spaceIds. Best-effort, sequential.
  for (const rec of lib.values()) {
    let secs = 0
    for (const m of rec._members) {
      try {
        const stRes = await fetch(`${BASE}/v1/profiles/${m.prof}/stats?spaceId=${m.space}&statNames=Playtime`, { headers: H, signal: AbortSignal.timeout(12_000) })
        if (!stRes.ok) continue
        const v = Number(((await stRes.json()) as any)?.stats?.Playtime?.value)
        if (Number.isFinite(v) && v > 0) secs += v
      } catch { /* best-effort */ }
    }
    if (secs > 0) rec.playtimeHours = Math.round(secs / 3600)
  }

  const out = [...lib.values()].map(({ _members, ...r }) => r)
  return out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

const LIST_TTL = 6 * 60 * 60 * 1000
interface GamesCache { games: UbiRecord[]; at: number }
let memo: GamesCache | null = null
let inflight: Promise<UbiRecord[]> | null = null
let warmingFlag = false

async function loadRecords(): Promise<UbiRecord[]> {
  if (!configured()) return []
  if (!memo) {
    const disk = await readCache<GamesCache>('ubisoft_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (inflight) return inflight
  warmingFlag = true
  inflight = fetchLibrary()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('ubisoft_games.json', memo)
      return games
    })
    .catch(async (e) => {
      console.error('[ubisoft] library fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('ubisoft_games.json', { games: [], at: 0 })
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
    name: rec?.name ?? 'Ubisoft game',
    shortDescription: rec?.shortDescription ?? '',
    developers: [],
    publishers: ['Ubisoft'],
    releaseDate: rec?.releaseDate ?? '',
    genres: [],
    categories: [],
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
    try { await getGames() } catch (e) { console.error('[ubisoft] warmer error:', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 5_000)
  console.log('[ubisoft] warmer started — played library + playtime refresh')
}
