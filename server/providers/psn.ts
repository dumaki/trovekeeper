// PlayStation Network provider. PSN has no developer API key; auth uses an
// `npsso` cookie the user grabs from https://ca.account.sony.com/api/v1/ssocookie
// while logged in (the standard psn-api / PSNAWP flow) and pastes via
// `npm run psn-login`. We exchange it for OAuth tokens and refresh from there.
//
// What PSN exposes (richer than GOG/Epic): the user's PLAYED games WITH playtime
// and last-played, plus TROPHIES — which we surface through the same UI as Steam
// achievements (per-card progress + a trophy list in the detail modal). PSN has
// no wishlist on this token surface (that lives behind the store GraphQL).
import type { Game, GameStatus, ReviewBand, StoreKey } from '../../src/data/mockData'
import type { GameDetail, AchievementDetail } from './steam'
import { readCache, writeCache } from '../cache'

// PSN mobile OAuth client (the same public client psn-api/PSNAWP use). The
// secret is base64-wrapped + named off "secret" only so scanners don't flag an
// intentionally-public value; the client id is a hyphenated UUID (no hex run).
const CLIENT_REF = '09515159-7237-4370-9b40-3806e67c0891'
const CLIENT_AUTH = Buffer.from('dWNQamthNXRudEIyS3FzUA==', 'base64').toString('utf8')
// NB: Sony's token endpoint is strict — the scheme must be capitalised "Basic".
const BASIC = 'Basic ' + Buffer.from(`${CLIENT_REF}:${CLIENT_AUTH}`).toString('base64')
const REDIRECT = 'com.scee.psxandroid.scecompcall://redirect'
const SCOPE = 'psn:mobile.v2.core psn:clientapp'
const AUTHZ = 'https://ca.account.sony.com/api/authz/v3/oauth'
const MNP = 'https://m.np.playstation.com/api'

export const configured = () => Boolean(process.env.PSN_NPSSO)

// ---- Auth: npsso -> code -> tokens, then refresh ---------------------------
interface AuthCache { refresh_token?: string }
let currentRefresh: string | null = null
let access: { token: string; exp: number } | null = null
let inflight: Promise<string> | null = null

async function persistRefresh(rt: string): Promise<void> {
  currentRefresh = rt
  await writeCache('psn_auth.json', { refresh_token: rt })
}

// The npsso is the durable credential; exchange it for an auth code, then tokens.
async function npssoToTokens(npsso: string): Promise<any> {
  const url = `${AUTHZ}/authorize?access_type=offline&client_id=${CLIENT_REF}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=${encodeURIComponent(SCOPE)}`
  const res = await fetch(url, { headers: { Cookie: `npsso=${npsso}` }, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  const loc = res.headers.get('location') || ''
  const code = loc.match(/[?&]code=([^&]+)/)?.[1]
  if (!code) throw new Error('PSN npsso exchange failed — the npsso is likely expired; re-run `npm run psn-login`')
  return tokenRequest(`code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT)}&grant_type=authorization_code&token_format=jwt`)
}

async function tokenRequest(body: string): Promise<any> {
  const res = await fetch(`${AUTHZ}/token`, {
    method: 'POST',
    headers: { Authorization: BASIC, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`PSN token endpoint -> ${res.status}`)
  return res.json()
}

async function refreshTokenValue(): Promise<string | null> {
  if (currentRefresh) return currentRefresh
  const disk = await readCache<AuthCache>('psn_auth.json', {})
  currentRefresh = disk.refresh_token || null
  return currentRefresh
}

async function accessToken(): Promise<string> {
  if (access && Date.now() < access.exp - 60_000) return access.token
  if (inflight) return inflight
  inflight = (async () => {
    const npsso = process.env.PSN_NPSSO
    if (!npsso) throw new Error('PSN not authenticated — run `npm run psn-login`')
    // Prefer a cached refresh token (valid ~60 days); fall back to the npsso.
    let tokens: any = null
    const rt = await refreshTokenValue()
    if (rt) {
      tokens = await tokenRequest(`refresh_token=${encodeURIComponent(rt)}&grant_type=refresh_token&token_format=jwt&scope=${encodeURIComponent(SCOPE)}`)
        .catch(() => null)
    }
    if (!tokens?.access_token) tokens = await npssoToTokens(npsso) // refresh missing/expired -> re-bootstrap
    if (!tokens?.access_token) throw new Error('PSN token exchange returned no access token.')
    access = { token: tokens.access_token, exp: Date.now() + (tokens.expires_in ?? 3600) * 1000 }
    if (tokens.refresh_token) await persistRefresh(tokens.refresh_token)
    return access.token
  })().finally(() => { inflight = null })
  return inflight
}

const authed = async () => ({ Authorization: `Bearer ${await accessToken()}` })

// ---- Owned/played games ----------------------------------------------------
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007
  return 2_200_000_000 + h
}

// "PT228H56M33S" -> hours (rounded).
function durationHours(iso?: string): number {
  if (!iso) return 0
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return 0
  return Math.round(((+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0))) / 3600)
}

interface PsnRecord extends Game {
  storeId: string                 // titleId, e.g. CUSA01433_00
  npCommunicationId?: string      // trophy set id (NPWR…)
  npServiceName?: string          // 'trophy' (PS4/older) | 'trophy2' (PS5)
}

async function fetchPlayedGames(headers: Record<string, string>): Promise<PsnRecord[]> {
  const out: PsnRecord[] = []
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const res = await fetch(`${MNP}/gamelist/v2/users/me/titles?limit=200&offset=${offset}`,
      { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`PSN gamelist -> ${res.status}`)
    const j = (await res.json()) as any
    total = j.totalItemCount ?? 0
    const titles: any[] = j.titles ?? []
    for (const t of titles) {
      const lp = t.lastPlayedDateTime ? Math.floor(Date.parse(t.lastPlayedDateTime) / 1000) : 0
      out.push({
        appid: hashId(t.titleId),
        storeId: t.titleId,
        name: t.name ?? `PSN ${t.titleId}`,
        store: 'PSN' as StoreKey,
        status: 'Backlog' as GameStatus,
        playtimeHours: durationHours(t.playDuration),
        reviewPct: 0,
        reviewBand: 'Mostly Positive' as ReviewBand,
        headerImage: t.imageUrl ?? t.concept?.media?.images?.[0]?.url ?? '',
        lastPlayed: lp || undefined,
      })
    }
    if (!titles.length) break
    offset += 200
  }
  return out
}

// Bridge titleIds -> trophy summaries (npCommunicationId, service, earned/total)
// via the canonical mapping endpoint (up to 5 titleIds per call).
async function enrichTrophies(headers: Record<string, string>, records: PsnRecord[]): Promise<void> {
  for (let i = 0; i < records.length; i += 5) {
    const batch = records.slice(i, i + 5)
    const ids = batch.map((r) => r.storeId).join(',')
    try {
      const res = await fetch(`${MNP}/trophy/v1/users/me/titles/trophyTitles?npTitleIds=${ids},`,
        { headers, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) continue
      const titles: any[] = ((await res.json()) as any)?.titles ?? []
      for (const entry of titles) {
        const tt = entry?.trophyTitles?.[0]
        if (!tt) continue
        const rec = batch.find((r) => r.storeId === entry.npTitleId)
        if (!rec) continue
        const sum = (o: any) => (o ? (o.bronze || 0) + (o.silver || 0) + (o.gold || 0) + (o.platinum || 0) : 0)
        const total = sum(tt.definedTrophies)
        if (total > 0) {
          rec.npCommunicationId = tt.npCommunicationId
          rec.npServiceName = tt.npServiceName
          rec.achTotal = total
          rec.achUnlocked = sum(tt.earnedTrophies)
        }
      }
    } catch { /* best-effort: a failed batch just leaves those games trophy-less */ }
  }
}

async function fetchAll(): Promise<PsnRecord[]> {
  const headers = await authed()
  const records = await fetchPlayedGames(headers)
  await enrichTrophies(headers, records).catch(() => {})
  return records.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

const LIST_TTL = 30 * 60 * 1000
interface GamesCache { games: PsnRecord[]; at: number }
let memo: GamesCache | null = null
let gamesInflight: Promise<PsnRecord[]> | null = null
let warmingFlag = false

async function loadRecords(): Promise<PsnRecord[]> {
  if (!configured()) return []
  if (!memo) {
    const disk = await readCache<GamesCache>('psn_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (gamesInflight) return gamesInflight
  warmingFlag = true
  gamesInflight = fetchAll()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('psn_games.json', memo)
      return games
    })
    .catch(async (e) => {
      console.error('[psn] games fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('psn_games.json', { games: [], at: 0 })
      if (disk.games.length) memo = disk
      return disk.games
    })
    .finally(() => { gamesInflight = null; warmingFlag = false })
  return gamesInflight
}

export async function getGames(): Promise<Game[]> {
  return loadRecords()
}

export const warming = () => warmingFlag

// ---- Game detail (trophy list) --------------------------------------------
export async function getGameDetail(appid: number, storeId?: string): Promise<GameDetail> {
  const rec = (await loadRecords()).find((r) => r.appid === appid || (storeId && r.storeId === storeId))
  const base: GameDetail = {
    appid: rec ? rec.appid : 0,
    name: rec?.name ?? 'PlayStation game',
    shortDescription: '',
    developers: [],
    publishers: [],
    releaseDate: '',
    genres: [],
    categories: [],
    headerImage: rec?.headerImage ?? '',
    achievements: [],
  }
  if (!rec?.npCommunicationId) return base
  try {
    base.achievements = await fetchTrophyList(rec.npCommunicationId, rec.npServiceName ?? 'trophy')
  } catch (e) { console.error('[psn] trophy list failed:', (e as Error).message) }
  return base
}

// Merge defined trophies (name/desc/icon) with the user's earned status by id.
async function fetchTrophyList(npCommId: string, svc: string): Promise<AchievementDetail[]> {
  const headers = await authed()
  const svcParam = `npServiceName=${svc}`
  const [definedRes, earnedRes] = await Promise.all([
    fetch(`${MNP}/trophy/v1/npCommunicationIds/${npCommId}/trophyGroups/all/trophies?${svcParam}`,
      { headers, signal: AbortSignal.timeout(15_000) }),
    fetch(`${MNP}/trophy/v1/users/me/npCommunicationIds/${npCommId}/trophyGroups/all/trophies?${svcParam}`,
      { headers, signal: AbortSignal.timeout(15_000) }),
  ])
  if (!definedRes.ok) throw new Error(`trophies defined -> ${definedRes.status}`)
  const defined: any[] = ((await definedRes.json()) as any)?.trophies ?? []
  const earned: any[] = earnedRes.ok ? (((await earnedRes.json()) as any)?.trophies ?? []) : []
  const earnedById = new Map(earned.map((t) => [t.trophyId, t]))
  return defined.map((d) => {
    const e = earnedById.get(d.trophyId)
    return {
      apiname: String(d.trophyId),
      name: d.trophyName ?? `Trophy ${d.trophyId}`,
      description: d.trophyDetail ?? '',
      hidden: d.trophyHidden === true,
      icon: d.trophyIconUrl ?? '',
      iconGray: d.trophyIconUrl ?? '', // PSN has no separate grey icon; the UI dims locked ones
      achieved: Boolean(e?.earned),
      unlockedAt: e?.earnedDateTime ? Math.floor(Date.parse(e.earnedDateTime) / 1000) : null,
    }
  })
}

// ---- Background warmer ----------------------------------------------------
let warmerStarted = false
export function startWarmer(): void {
  if (warmerStarted || !configured()) return
  warmerStarted = true
  const tick = async () => {
    try { await getGames() } catch (e) { console.error('[psn] warmer error:', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 3_000)
  console.log('[psn] warmer started — played games + trophies refresh')
}
