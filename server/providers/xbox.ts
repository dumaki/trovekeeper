// Xbox (Xbox Live / Microsoft) provider. Auth is a one-time Microsoft OAuth
// login (`npm run xbox-login`) using Xbox's well-known public client (no secret),
// yielding a long-lived refresh token. Each run we refresh the MS access token,
// then run the Xbox Live token chain (user-authenticate -> XSTS) to get the
// XBL3.0 auth header + the user's XUID.
//
// What Xbox exposes: the user's PLAYED titles (with cover art, last-played, and
// an achievement summary) via titlehub, and a full per-title achievement list
// (surfaced through the same UI as Steam achievements / PSN trophies). No
// playtime total and no wishlist on this surface.
import type { Game, GameStatus, ReviewBand, StoreKey } from '../../src/data/mockData'
import type { GameDetail, AchievementDetail } from './steam'
import { readCache, writeCache } from '../cache'

// Public Xbox app client (XBOX_APP) — a public client, NO secret. The id is only
// 16 hex chars, so it doesn't trip the secret-guard's 32-hex rule.
const CLIENT_ID = '000000004C12AE6F'
const REDIRECT = 'https://login.live.com/oauth20_desktop.srf'
const SCOPE = 'Xboxlive.signin Xboxlive.offline_access'
const MS_TOKEN_URL = 'https://login.live.com/oauth20_token.srf'

export const authorizeUrl = () =>
  `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}` +
  `&response_type=code&approval_prompt=auto&scope=${encodeURIComponent(SCOPE)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}`

export const configured = () => Boolean(process.env.XBOX_REFRESH_TOKEN)

// ---- Microsoft OAuth token (long-lived refresh -> short access) -------------
interface AuthCache { refresh_token?: string }
let currentRefresh: string | null = null
let msAccess: { token: string; exp: number } | null = null
let msInflight: Promise<string> | null = null

async function persistRefresh(rt: string): Promise<void> {
  currentRefresh = rt
  await writeCache('xbox_auth.json', { refresh_token: rt })
}

async function refreshTokenValue(): Promise<string> {
  if (currentRefresh) return currentRefresh
  const disk = await readCache<AuthCache>('xbox_auth.json', {})
  currentRefresh = disk.refresh_token || process.env.XBOX_REFRESH_TOKEN || null
  if (!currentRefresh) throw new Error('Xbox not authenticated — run `npm run xbox-login`')
  return currentRefresh
}

/** Exchange an authorization code for tokens — used by the login helper only. */
export async function exchangeCode(code: string): Promise<{ refresh_token: string }> {
  const j = await msTokenRequest(
    `grant_type=authorization_code&code=${encodeURIComponent(code)}` +
    `&scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(REDIRECT)}&client_id=${CLIENT_ID}`)
    .catch(() => { throw new Error('Xbox code exchange failed — the code is single-use and expires fast; log in again.') })
  if (!j.refresh_token) throw new Error('Xbox code exchange returned no refresh token.')
  await persistRefresh(j.refresh_token)
  return { refresh_token: j.refresh_token }
}

async function msTokenRequest(body: string): Promise<any> {
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Microsoft token endpoint -> ${res.status}`)
  return res.json()
}

async function msToken(): Promise<string> {
  if (msAccess && Date.now() < msAccess.exp - 60_000) return msAccess.token
  if (msInflight) return msInflight
  msInflight = (async () => {
    const rt = await refreshTokenValue()
    const j = await msTokenRequest(`grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&scope=${encodeURIComponent(SCOPE)}&client_id=${CLIENT_ID}`)
      .catch(() => { throw new Error('Xbox token refresh failed (refresh token may be expired — re-run `npm run xbox-login`)') })
    if (!j.access_token) throw new Error('Xbox token refresh returned no access token.')
    msAccess = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
    if (j.refresh_token) await persistRefresh(j.refresh_token) // MS rotates the refresh token
    return msAccess.token
  })().finally(() => { msInflight = null })
  return msInflight
}

// ---- Xbox Live token chain (XBL3.0 header + XUID) --------------------------
// The XSTS token is short-lived, so we cache it only briefly and re-run the
// chain (user-authenticate -> XSTS) when it lapses.
let xsts: { auth: string; xuid: string; exp: number } | null = null
let xstsInflight: Promise<{ auth: string; xuid: string }> | null = null

async function xblPost(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-xbl-contract-version': '1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401) {
    const xerr = ((await res.json().catch(() => ({}))) as any)?.XErr
    const reason = xerr === 2148916233 ? 'this account has no Xbox profile'
      : xerr === 2148916238 ? 'this is a child account not in a Family'
      : `XSTS denied (${xerr ?? '401'})`
    throw new Error(`Xbox auth failed — ${reason}`)
  }
  if (!res.ok) throw new Error(`Xbox auth ${url} -> ${res.status}`)
  return res.json()
}

async function xblAuth(): Promise<{ auth: string; xuid: string }> {
  if (xsts && Date.now() < xsts.exp - 60_000) return { auth: xsts.auth, xuid: xsts.xuid }
  if (xstsInflight) return xstsInflight
  xstsInflight = (async () => {
    const access = await msToken()
    const user = await xblPost('https://user.auth.xboxlive.com/user/authenticate', {
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${access}` },
    })
    const userToken = user.Token
    const auth = await xblPost('https://xsts.auth.xboxlive.com/xsts/authorize', {
      RelyingParty: 'http://xboxlive.com',
      TokenType: 'JWT',
      Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
    })
    const uhs = auth.DisplayClaims?.xui?.[0]?.uhs
    const xuid = auth.DisplayClaims?.xui?.[0]?.xid
    if (!uhs || !auth.Token || !xuid) throw new Error('Xbox XSTS response missing token/uhs/xuid')
    xsts = { auth: `XBL3.0 x=${uhs};${auth.Token}`, xuid, exp: Date.now() + 2.5 * 60 * 60 * 1000 }
    return { auth: xsts.auth, xuid }
  })().finally(() => { xstsInflight = null })
  return xstsInflight
}

// Headers the official Xbox app sends — some titlehub deployments need them.
const xblHeaders = (auth: string, contract: string) => ({
  Authorization: auth,
  'x-xbl-contract-version': contract,
  Accept: 'application/json',
  'Accept-Language': 'en-US',
  'x-xbl-client-name': 'XboxApp',
  'x-xbl-client-type': 'UWA',
  'x-xbl-client-version': '39.39.22001.0',
})

// ---- Library (titlehub: played games + achievement summary) ---------------
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007
  return 2_300_000_000 + h
}

interface XboxRecord extends Game {
  storeId: string // titleId (decimal), the achievements join key
}

async function fetchLibrary(): Promise<XboxRecord[]> {
  const { auth, xuid } = await xblAuth()
  const res = await fetch(
    `https://titlehub.xboxlive.com/users/xuid(${xuid})/titles/titlehistory/decoration/achievement,image,detail`,
    { headers: xblHeaders(auth, '2'), signal: AbortSignal.timeout(20_000) },
  )
  if (!res.ok) throw new Error(`Xbox titlehub -> ${res.status}`)
  const titles: any[] = ((await res.json()) as any)?.titles ?? []
  const out: XboxRecord[] = []
  for (const t of titles) {
    if (t.type && t.type !== 'Game') continue // skip apps (Netflix etc.)
    const titleId = String(t.titleId)
    const lp = t.titleHistory?.lastTimePlayed ? Math.floor(Date.parse(t.titleHistory.lastTimePlayed) / 1000) : 0
    const total = t.achievement?.totalAchievements ?? 0
    out.push({
      appid: hashId(titleId),
      storeId: titleId,
      name: t.name ?? `Xbox ${titleId}`,
      store: 'Xbox' as StoreKey,
      status: 'Backlog' as GameStatus,
      playtimeHours: 0, // titlehub exposes last-played, not total playtime
      reviewPct: 0,
      reviewBand: 'Mostly Positive' as ReviewBand,
      headerImage: t.displayImage ?? '',
      lastPlayed: lp || undefined,
      ...(total > 0 ? { achTotal: total, achUnlocked: t.achievement?.currentAchievements ?? 0 } : {}),
    })
  }
  await fetchPlaytime(auth, xuid, out).catch(() => {}) // best-effort; not all titles report it
  return out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
}

// Xbox doesn't expose playtime in titlehub, but the user-stats service tracks a
// per-title "MinutesPlayed" stat for most modern titles (360/apps often omit it).
async function fetchPlaytime(auth: string, xuid: string, records: XboxRecord[]): Promise<void> {
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100)
    try {
      const res = await fetch('https://userstats.xboxlive.com/batch', {
        method: 'POST',
        headers: { ...xblHeaders(auth, '2'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          arrangebyfield: 'xuid',
          xuids: [xuid],
          groups: [],
          stats: batch.map((r) => ({ name: 'MinutesPlayed', titleId: Number(r.storeId) })),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) continue
      const j = (await res.json()) as any
      const mins = new Map<string, number>()
      for (const coll of j.statlistscollection ?? []) {
        for (const s of coll.stats ?? []) {
          if (s.name === 'MinutesPlayed' && s.value != null) mins.set(String(s.titleid), Number(s.value))
        }
      }
      for (const r of batch) {
        const m = mins.get(r.storeId)
        if (m && m > 0) r.playtimeHours = Math.round(m / 60)
      }
    } catch { /* best-effort: a failed batch just leaves those games at 0h */ }
  }
}

const LIST_TTL = 30 * 60 * 1000
interface GamesCache { games: XboxRecord[]; at: number }
let memo: GamesCache | null = null
let inflight: Promise<XboxRecord[]> | null = null
let warmingFlag = false

async function loadRecords(): Promise<XboxRecord[]> {
  if (!configured()) return []
  if (!memo) {
    const disk = await readCache<GamesCache>('xbox_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (inflight) return inflight
  warmingFlag = true
  inflight = fetchLibrary()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('xbox_games.json', memo)
      return games
    })
    .catch(async (e) => {
      console.error('[xbox] library fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('xbox_games.json', { games: [], at: 0 })
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

// ---- Achievement detail (per title) ---------------------------------------
export async function getGameDetail(appid: number, storeId?: string): Promise<GameDetail> {
  const rec = (await loadRecords()).find((r) => r.appid === appid || (storeId && r.storeId === storeId))
  const titleId = rec?.storeId ?? storeId
  const base: GameDetail = {
    appid: rec ? rec.appid : 0,
    name: rec?.name ?? 'Xbox game',
    shortDescription: '',
    developers: [],
    publishers: [],
    releaseDate: '',
    genres: [],
    categories: [],
    headerImage: rec?.headerImage ?? '',
    achievements: [],
  }
  if (titleId) {
    try { base.achievements = await fetchAchievements(titleId) }
    catch (e) { console.error('[xbox] achievements failed:', (e as Error).message) }
  }
  // Xbox 360 only exposes EARNED achievements per user, so the list comes back
  // short of the real total. Pad the remainder as locked placeholders (only when
  // we got some real ones) so the count matches the card instead of showing
  // a misleading "31 / 31".
  const total = rec?.achTotal ?? 0
  if (base.achievements.length > 0 && base.achievements.length < total) {
    for (let i = base.achievements.length; i < total; i++) {
      base.achievements.push({
        apiname: `locked-${i}`,
        name: 'Locked achievement',
        description: 'Locked — full details aren’t available for Xbox 360 titles.',
        hidden: false, icon: '', iconGray: '', achieved: false, unlockedAt: null,
      })
    }
  }
  return base
}

// Modern (Xbox One/Series/PC) achievements via contract v2; Xbox 360 titles
// return [] there, so fall back to the legacy v1 endpoint + shape.
async function fetchAchievements(titleId: string): Promise<AchievementDetail[]> {
  const v2 = await fetchAchV2(titleId)
  return v2.length ? v2 : fetchAchV1(titleId)
}

async function fetchAchV2(titleId: string): Promise<AchievementDetail[]> {
  const { auth, xuid } = await xblAuth()
  const out: AchievementDetail[] = []
  let cont = ''
  do {
    const url = `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${titleId}&maxItems=1000` +
      (cont ? `&continuationToken=${encodeURIComponent(cont)}` : '')
    const res = await fetch(url, { headers: xblHeaders(auth, '2'), signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`achievements v2 -> ${res.status}`)
    const j = (await res.json()) as any
    for (const a of j.achievements ?? []) {
      const achieved = a.progressState === 'Achieved'
      const icon = (a.mediaAssets ?? []).find((m: any) => m.type === 'Icon')?.url ?? ''
      out.push({
        apiname: String(a.id),
        name: a.name ?? '',
        description: achieved ? (a.description ?? '') : (a.lockedDescription ?? a.description ?? ''),
        hidden: a.isSecret === true,
        icon,
        iconGray: icon, // Xbox ships one icon; the UI dims locked ones
        achieved,
        unlockedAt: a.progression?.timeUnlocked && !a.progression.timeUnlocked.startsWith('0001')
          ? Math.floor(Date.parse(a.progression.timeUnlocked) / 1000) : null,
      })
    }
    cont = j.pagingInfo?.continuationToken ?? ''
  } while (cont)
  return out
}

// Legacy Xbox 360 shape: `unlocked` bool, `imageId` (no usable icon URL), etc.
async function fetchAchV1(titleId: string): Promise<AchievementDetail[]> {
  const { auth, xuid } = await xblAuth()
  const res = await fetch(
    `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements?titleId=${titleId}&maxItems=1000`,
    { headers: xblHeaders(auth, '1'), signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) return []
  const list: any[] = ((await res.json()) as any)?.achievements ?? []
  return list.map((a) => ({
    apiname: String(a.id),
    name: a.name ?? '',
    description: a.unlocked ? (a.description ?? '') : (a.lockedDescription ?? a.description ?? ''),
    hidden: a.isSecret === true,
    icon: '',      // 360 exposes only a numeric imageId, no usable URL
    iconGray: '',
    achieved: a.unlocked === true,
    unlockedAt: a.timeUnlocked && !String(a.timeUnlocked).startsWith('0001')
      ? Math.floor(Date.parse(a.timeUnlocked) / 1000) : null,
  }))
}

// ---- Background warmer ----------------------------------------------------
let warmerStarted = false
export function startWarmer(): void {
  if (warmerStarted || !configured()) return
  warmerStarted = true
  const tick = async () => {
    try { await getGames() } catch (e) { console.error('[xbox] warmer error:', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 3_500)
  console.log('[xbox] warmer started — played games + achievements refresh')
}
