// Steam provider + multi-store aggregation hub. When STEAM_API_KEY + STEAM_ID
// are set, fetches live data from the Steam Web API; otherwise returns the
// bundled mock so the app runs out of the box. The request paths here also merge
// in other configured providers (currently GOG via ./gog) so the library and
// dashboard span every connected store. The mock is the single source of truth
// shared with the frontend.
//
// Architecture:
//   - Request paths (getLibrary/getDashboard/getWishlist/getProgress) are
//     READ-ONLY over the disk caches, so they're fast and never race.
//   - A single background WARMER (startWarmer) is the sole cache writer. It
//     enriches a small batch on a paced interval, staying under Steam's
//     storefront rate limit (~200 / 5 min) and backing off on a 429.
import * as mock from '../../src/data/mockData'
import type {
  Game, WishlistItem, GameStatus, ReviewBand, StoreKey,
} from '../../src/data/mockData'
import { readCache, writeCache } from '../cache'
import { igdbConfigured, fetchTimeToBeat } from './igdb'
import * as gog from './gog'

const API = 'https://api.steampowered.com'
const hdr = (appid: number) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`

const key = () => process.env.STEAM_API_KEY
const id = () => process.env.STEAM_ID
export const configured = () => Boolean(key() && id())

export type Source = 'live' | 'mock'

interface DashboardPayload {
  source: Source
  profile: typeof mock.profile
  trending: typeof mock.trending
  libraryByStore: { key: StoreKey; value: number; color: string }[]
  statusBreakdown: { key: GameStatus; value: number; color: string }[] | null
  // keyed by Steam's review descriptor (e.g. "Very Positive") in live mode
  reviewSentiment: { key: string; value: number; color: string }[] | null
}

const STATUS_COLOR: Record<GameStatus, string> = {
  Backlog: '#ef4444', Playing: '#f5c518', Finished: '#22c55e', Next: '#38bdf8', Skip: '#64748b',
}

// Per-store donut colors for the "Library by Store" chart (merged across providers).
const STORE_COLOR: Partial<Record<StoreKey, string>> = {
  Steam: '#5ab0e8', GOG: '#7b3ff2',
}

// Play-status is app-side state keyed per game. Steam keys stay bare (the appid)
// for backward compatibility with existing caches; other stores are namespaced
// so a GOG product id can't collide with a Steam appid.
function statusKey(store: StoreKey, appid: number): string {
  return store === 'Steam' ? String(appid) : `${store}:${appid}`
}

// Steam's review descriptors -> donut colors (green = good, amber = mixed, red = bad).
const SENTIMENT_COLOR: Record<string, string> = {
  'Overwhelmingly Positive': '#15803d',
  'Very Positive': '#22c55e',
  'Positive': '#4ade80',
  'Mostly Positive': '#86efac',
  'Mixed': '#f5c518',
  'Mostly Negative': '#fb923c',
  'Negative': '#ef4444',
  'Very Negative': '#dc2626',
  'Overwhelmingly Negative': '#991b1b',
}

// ---- Freshness windows + boot threshold ----------------------------------
const PRICE_TTL = 6 * 60 * 60 * 1000        // re-check price/discount every 6h (catch sales)
const REVIEW_TTL = 7 * 24 * 60 * 60 * 1000  // review % drifts slowly -> weekly
const MISS_TTL = 6 * 60 * 60 * 1000         // region-locked/delisted items: back off 6h
const REVIEW_GATE = 100                     // boot gate releases after this many most-played reviews

const ACH_TTL = 24 * 60 * 60 * 1000         // achievements change as you play -> refresh daily
const ACH_PER_STEP = 12                      // achievements use the Web API (generous), so fetch more per tick
const TTB_TTL = 30 * 24 * 60 * 60 * 1000     // time-to-beat barely changes -> refresh monthly
const TTB_PER_STEP = 500                      // appids resolved per IGDB step (batched internally)
const TYPE_TTL = 90 * 24 * 60 * 60 * 1000    // an app's type never changes -> refresh rarely

// Steam app types that aren't "games" — filtered from the library so the count
// matches Steam (soundtracks=music, plus demos/videos/DLC/etc.). Apps whose type
// is unknown (not yet fetched, or no store page) default to "game" so genuinely
// delisted games (e.g. old GTA titles) are never wrongly dropped.
const NON_GAME_TYPES = new Set(['music', 'video', 'movie', 'demo', 'dlc', 'mod', 'advertising', 'episode', 'series', 'hardware'])
// Demos / beta branches / test builds have no store page (so appdetails can't
// type them) but are clearly not games — match them by name. Kept tight to
// avoid catching real titles (verified against the library: 0 false positives).
const NON_GAME_NAME_RE = /\bdemo\b|\bbeta\b|\bplaytest\b|public test|staging branch|\bunstable\b|dev branch|\bSDK\b|dedicated server|authoring tools|\bbenchmark\b/i

interface ReviewEntry { pct: number; desc: string; reviewedAt: number }
interface ReviewCache { items: Record<string, ReviewEntry> }
interface CachedItem extends WishlistItem { pricedAt: number; reviewedAt: number; cachedAt: number }
interface WishlistCache { items: Record<string, CachedItem>; misses: Record<string, number> }
interface AchEntry { unlocked: number; total: number; at: number } // total 0 = game has no achievements
interface AchCache { items: Record<string, AchEntry> }
interface TtbEntry { hours: number | null; at: number }            // null = IGDB has no time-to-beat
interface TtbCache { items: Record<string, TtbEntry> }
interface TypeEntry { type: string; at: number }
interface TypeCache { items: Record<string, TypeEntry> }

const emptyWishlistCache = (): WishlistCache => ({ items: {}, misses: {} })
const emptyReviewCache = (): ReviewCache => ({ items: {} })
const emptyAchCache = (): AchCache => ({ items: {} })
const emptyTtbCache = (): TtbCache => ({ items: {} })
const emptyTypeCache = (): TypeCache => ({ items: {} })

function bandFromDesc(desc: string): ReviewBand {
  if (desc.includes('Overwhelmingly Positive')) return 'Overwhelmingly Positive'
  if (desc.includes('Very Positive')) return 'Very Positive'
  if (desc.includes('Mixed') || desc.includes('Negative')) return 'Mixed'
  return 'Mostly Positive'
}

// ---- Web API helpers ------------------------------------------------------
async function steamGet(path: string, params: Record<string, string>) {
  const url = new URL(`${API}${path}`)
  url.searchParams.set('key', key()!)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`Steam API ${path} responded ${res.status}`)
  return res.json() as Promise<any>
}

async function fetchOwnedGames(): Promise<Game[]> {
  const data = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
    steamid: id()!,
    include_appinfo: '1',
    include_played_free_games: '1',
  })
  const games: any[] = data?.response?.games ?? []
  return games
    .map((g): Game => ({
      appid: g.appid,
      name: g.name ?? `App ${g.appid}`,
      store: 'Steam' as StoreKey,
      status: 'Backlog' as GameStatus, // Steam doesn't expose play-status
      playtimeHours: Math.round((g.playtime_forever ?? 0) / 60),
      reviewPct: 0,
      reviewBand: 'Mostly Positive' as ReviewBand,
      headerImage: hdr(g.appid),
      lastPlayed: g.rtime_last_played || 0,
    }))
    .sort((a, b) => b.playtimeHours - a.playtimeHours) // most-played first
}

async function fetchProfile(games: Game[]): Promise<typeof mock.profile> {
  const summary = await steamGet('/ISteamUser/GetPlayerSummaries/v2/', {
    steamids: id()!,
  }).catch(() => null)
  const player = summary?.response?.players?.[0]
  const playedHours = games.reduce((s, g) => s + g.playtimeHours, 0)
  return {
    ...mock.profile, // sensible defaults for fields Steam can't provide
    personaName: player?.personaname ?? 'Steam User',
    avatar: player?.avatarfull ?? '',
    totalGames: games.length,
    steamGames: games.length,
    storesConnected: 1,
    playedHours,
    backlogHours: 0,
    completePct: 0,
  }
}

function breakdown<K extends string>(
  games: Game[], pick: (g: Game) => K, color: (k: K) => string,
): { key: K; value: number; color: string }[] {
  const counts = new Map<K, number>()
  for (const g of games) counts.set(pick(g), (counts.get(pick(g)) ?? 0) + 1)
  return [...counts.entries()].map(([k, n]) => ({
    key: k, value: Math.round((n / games.length) * 100), color: color(k),
  }))
}

// ---- Memoized source lists (cheap Web API) -------------------------------
// Memoize briefly so the warmer ticks + progress polling don't refetch the
// owned-games / wishlist lists every few seconds.
const LIST_TTL = 5 * 60 * 1000
let ownedMemo: { at: number; games: Game[] } | null = null
let ownedInflight: Promise<Game[]> | null = null
// Full owned-apps list straight from Steam (includes soundtracks/demos/etc.).
// Used by the type warmer, which must see everything to classify it.
async function ownedGamesRaw(): Promise<Game[]> {
  if (ownedMemo && Date.now() - ownedMemo.at < LIST_TTL) return ownedMemo.games
  if (ownedInflight) return ownedInflight
  ownedInflight = fetchOwnedGames()
    .then((g) => { ownedMemo = { at: Date.now(), games: g }; return g })
    .finally(() => { ownedInflight = null })
  return ownedInflight
}

async function getAppTypes(): Promise<Record<string, TypeEntry>> {
  return (await readCache<TypeCache>('apptypes.json', emptyTypeCache())).items
}

// The "games" view: the raw list minus anything classified as a non-game type.
// Everything downstream (library, dashboard, review/achievement warmers) uses
// this, so the count and stats match Steam's game count.
async function ownedGames(): Promise<Game[]> {
  const raw = await ownedGamesRaw()
  const types = await getAppTypes()
  return raw.filter((g) =>
    !NON_GAME_TYPES.has(types[String(g.appid)]?.type ?? 'game') &&
    !NON_GAME_NAME_RE.test(g.name),
  )
}

let wishMemo: { at: number; appids: number[] } | null = null
let wishInflight: Promise<number[]> | null = null
async function wishlistAppids(): Promise<number[]> {
  if (wishMemo && Date.now() - wishMemo.at < LIST_TTL) return wishMemo.appids
  if (wishInflight) return wishInflight
  wishInflight = (async () => {
    const list = await steamGet('/IWishlistService/GetWishlist/v1/', { steamid: id()! })
    const entries: any[] = list?.response?.items ?? []
    return entries.slice()
      .sort((a, b) => (b.date_added ?? 0) - (a.date_added ?? 0))
      .map((e) => e.appid as number)
  })()
    .then((a) => { wishMemo = { at: Date.now(), appids: a }; return a })
    .finally(() => { wishInflight = null })
  return wishInflight
}

// ---- User-set play status (persisted) ------------------------------------
// Steam doesn't track Backlog/Playing/Finished/etc., so it's app-side state.
// Default heuristic: a game with playtime is "Playing", an unplayed one is
// "Backlog" — the user refines from there, and choices persist to disk.
const STATUS_VALUES: GameStatus[] = ['Backlog', 'Playing', 'Finished', 'Next', 'Skip']
interface StatusCache { items: Record<string, GameStatus> }

async function getStatuses(): Promise<Record<string, GameStatus>> {
  return (await readCache<StatusCache>('statuses.json', { items: {} })).items
}

function defaultStatus(g: Game): GameStatus {
  return g.playtimeHours > 0 ? 'Playing' : 'Backlog'
}

export async function setStatus(appid: unknown, status: unknown, store?: unknown): Promise<{ ok: true }> {
  const idNum = Number(appid)
  if (!Number.isFinite(idNum)) throw new Error('invalid appid')
  if (typeof status !== 'string' || !STATUS_VALUES.includes(status as GameStatus)) {
    throw new Error('invalid status')
  }
  // Unknown/missing store falls back to Steam (bare key) for backward compatibility.
  const s: StoreKey = (typeof store === 'string' && store in mock.storeMeta) ? (store as StoreKey) : 'Steam'
  const cache = await readCache<StatusCache>('statuses.json', { items: {} })
  cache.items[statusKey(s, idNum)] = status as GameStatus
  await writeCache('statuses.json', cache)
  return { ok: true }
}

// ---- Achievements (official Steam Web API) --------------------------------
async function getAchievements(): Promise<Record<string, AchEntry>> {
  return (await readCache<AchCache>('achievements.json', emptyAchCache())).items
}

// Returns unlocked/total for one game. total 0 => no achievements (or the game's
// stats aren't public). Throws on a transient failure so the warmer retries.
async function fetchAchievements(appid: number): Promise<{ unlocked: number; total: number }> {
  const url = new URL(`${API}/ISteamUserStats/GetPlayerAchievements/v1/`)
  url.searchParams.set('key', key()!)
  url.searchParams.set('steamid', id()!)
  url.searchParams.set('appid', String(appid))
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (res.status === 429) throw new Error('achievements 429')
  if (!res.ok) throw new Error(`achievements ${appid} -> ${res.status}`)
  const ps = ((await res.json()) as any)?.playerstats
  if (!ps?.success) return { unlocked: 0, total: 0 } // no stats / private game details
  const list: any[] = ps.achievements ?? []
  return { unlocked: list.filter((a) => a.achieved).length, total: list.length }
}

// ---- Read-only request paths ---------------------------------------------
export async function getLibrary(): Promise<{ source: Source; games: Game[] }> {
  if (!configured() && !gog.configured()) return { source: 'mock', games: mock.library }
  const statuses = await getStatuses()
  const out: Game[] = []

  if (configured()) {
    const games = await ownedGames()
    const rcache = await readCache<ReviewCache>('reviews.json', emptyReviewCache())
    const acache = await getAchievements()
    const tcache = await readCache<TtbCache>('timetobeat.json', emptyTtbCache())
    for (const g of games) {
      const r = rcache.items[String(g.appid)]
      const a = acache[String(g.appid)]
      const t = tcache.items[String(g.appid)]
      out.push({
        ...g,
        status: statuses[statusKey('Steam', g.appid)] ?? defaultStatus(g),
        ...(r ? { reviewPct: r.pct, reviewBand: bandFromDesc(r.desc) } : {}),
        ...(a ? { achUnlocked: a.unlocked, achTotal: a.total } : {}),
        ...(t?.hours != null ? { ttbHours: t.hours } : {}),
      })
    }
  }

  if (gog.configured()) {
    const gogGames = await gog.getGames().catch(() => [] as Game[])
    for (const g of gogGames) {
      out.push({ ...g, status: statuses[statusKey('GOG', g.appid)] ?? defaultStatus(g) })
    }
  }

  return { source: 'live', games: out }
}

export async function getDashboard(): Promise<DashboardPayload> {
  const steamLive = configured()
  const gogLive = gog.configured()
  if (!steamLive && !gogLive) {
    return {
      source: 'mock', profile: mock.profile, trending: mock.trending,
      libraryByStore: mock.libraryByStore, statusBreakdown: mock.statusBreakdown,
      reviewSentiment: mock.reviewSentiment,
    }
  }

  const games = steamLive ? await ownedGames() : []
  const gogGames = gogLive ? await gog.getGames().catch(() => [] as Game[]) : []
  const totalGames = games.length + gogGames.length
  const rcache = await readCache<ReviewCache>('reviews.json', emptyReviewCache())

  // Profile is Steam-derived when available (persona/avatar/playtime); otherwise
  // a minimal GOG-only profile. The store-spanning fields are overridden below.
  const baseProfile = steamLive
    ? await fetchProfile(games)
    : {
        ...mock.profile, personaName: 'GOG User', avatar: '', totalGames: 0,
        steamGames: 0, storesConnected: 0, playedHours: 0, backlogHours: 0, completePct: 0,
      }

  // Sentiment donut + average from cached reviews of currently-owned (Steam) games.
  const ownedSet = new Set(games.map((g) => String(g.appid)))
  const counts = new Map<string, number>()
  let pctSum = 0, pctN = 0
  for (const [appid, r] of Object.entries(rcache.items)) {
    if (!ownedSet.has(appid) || !r.desc || r.desc === 'No user reviews') continue
    counts.set(r.desc, (counts.get(r.desc) ?? 0) + 1)
    if (r.pct > 0) { pctSum += r.pct; pctN++ }
  }
  const totalRated = [...counts.values()].reduce((a, b) => a + b, 0)
  const reviewSentiment = totalRated > 0
    ? [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([desc, n]) => ({
        key: desc, value: Math.round((n / totalRated) * 100),
        color: SENTIMENT_COLOR[desc] ?? '#64748b',
      }))
    : null

  // Library-by-store donut, merged across configured providers.
  const libraryByStore: { key: StoreKey; value: number; color: string }[] = []
  if (totalGames) {
    if (games.length) libraryByStore.push({ key: 'Steam', value: Math.round((games.length / totalGames) * 100), color: STORE_COLOR.Steam! })
    if (gogGames.length) libraryByStore.push({ key: 'GOG', value: Math.round((gogGames.length / totalGames) * 100), color: STORE_COLOR.GOG! })
  }

  return {
    source: 'live',
    profile: {
      ...baseProfile,
      totalGames,
      storesConnected: (steamLive ? 1 : 0) + (gogLive ? 1 : 0),
      avgReviewPct: pctN ? Math.round(pctSum / pctN) : 0,
    },
    trending: mock.trending, // no public "trending in your library" endpoint
    libraryByStore,
    statusBreakdown: games.length ? breakdown(games, (g) => g.status, (k) => STATUS_COLOR[k]) : null,
    reviewSentiment,
  }
}

export async function getWishlist(): Promise<{
  source: Source; items: WishlistItem[]; total: number; pending: number; gog: WishlistItem[]
}> {
  // GOG wishlist (separate tab on the frontend) — independent of Steam's warming.
  const gogItems = gog.configured() ? await gog.getWishlist().catch(() => [] as WishlistItem[]) : []
  if (!configured()) {
    if (gog.configured()) return { source: 'live', items: [], total: 0, pending: 0, gog: gogItems }
    return { source: 'mock', items: mock.wishlist, total: mock.wishlist.length, pending: 0, gog: mock.gogWishlist }
  }
  const appids = await wishlistAppids()
  const cache = await readCache<WishlistCache>('wishlist.json', emptyWishlistCache())
  const now = Date.now()
  const items = appids.map((a) => cache.items[String(a)]).filter(Boolean) as WishlistItem[]
  const activeMisses = appids.filter((a) => {
    const m = cache.misses?.[String(a)]; return m !== undefined && now - m < MISS_TTL
  }).length
  const pending = Math.max(0, appids.length - items.length - activeMisses)
  return { source: 'live', items, total: appids.length, pending, gog: gogItems }
}

// ---- Game detail (on-demand, for the Library detail card) -----------------
export interface AchievementDetail {
  apiname: string
  name: string
  description: string
  hidden: boolean
  icon: string       // unlocked (color) icon
  iconGray: string   // locked (grey) icon
  achieved: boolean
  unlockedAt: number | null // unix seconds
}
export interface GameDetail {
  appid: number
  name: string
  shortDescription: string
  developers: string[]
  publishers: string[]
  releaseDate: string
  genres: string[]
  categories: string[]
  headerImage: string
  achievements: AchievementDetail[]
}

// Small in-memory cache so reopening a card doesn't refetch (10 min).
const detailMem = new Map<number, { at: number; data: GameDetail }>()
const DETAIL_TTL = 10 * 60_000

export async function getGameDetail(appid: number, store?: string): Promise<GameDetail> {
  if (!Number.isFinite(appid)) throw new Error('invalid appid')
  // GOG product ids live in their own namespace — route them to the GOG fetcher
  // rather than Steam's storefront (which would 404 on a GOG id).
  if (store === 'GOG') return gog.getGameDetail(appid)
  const cached = detailMem.get(appid)
  if (cached && Date.now() - cached.at < DETAIL_TTL) return cached.data

  // appdetails (storefront) + schema + player achievements (Web API) in parallel.
  const [adJson, schema, player] = await Promise.all([
    fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
      { signal: AbortSignal.timeout(12_000) }).then((r) => r.json()).catch(() => null) as Promise<any>,
    configured()
      ? steamGet('/ISteamUserStats/GetSchemaForGame/v2/', { appid: String(appid) }).catch(() => null)
      : Promise.resolve(null),
    configured()
      ? steamGet('/ISteamUserStats/GetPlayerAchievements/v1/', { steamid: id()!, appid: String(appid) }).catch(() => null)
      : Promise.resolve(null),
  ])

  const ad = adJson?.[String(appid)]?.data ?? {}
  const defs: any[] = schema?.game?.availableGameStats?.achievements ?? []
  const playerAch: any[] = player?.playerstats?.achievements ?? []
  const byName = new Map(playerAch.map((a) => [a.apiname, a]))

  const achievements: AchievementDetail[] = defs.map((d) => {
    const p = byName.get(d.name)
    return {
      apiname: d.name,
      name: d.displayName ?? d.name,
      description: d.description ?? '',
      hidden: d.hidden === 1,
      icon: d.icon ?? '',
      iconGray: d.icongray ?? '',
      achieved: Boolean(p?.achieved),
      unlockedAt: p?.unlocktime || null,
    }
  })

  const detail: GameDetail = {
    appid,
    name: ad.name ?? `App ${appid}`,
    shortDescription: ad.short_description ?? '',
    developers: ad.developers ?? [],
    publishers: ad.publishers ?? [],
    releaseDate: ad.release_date?.date ?? '',
    genres: (ad.genres ?? []).map((g: any) => g.description),
    categories: (ad.categories ?? []).map((c: any) => c.description),
    headerImage: ad.header_image ?? hdr(appid),
    achievements,
  }
  detailMem.set(appid, { at: Date.now(), data: detail })
  return detail
}

// ---- Boot progress --------------------------------------------------------
export interface Progress {
  configured: boolean
  ready: boolean
  warming: boolean
  wishlist: { cached: number; total: number }
  library: { cached: number; total: number }
}

export async function getProgress(): Promise<Progress> {
  if (!configured()) {
    return { configured: false, ready: true, warming: false, wishlist: { cached: 0, total: 0 }, library: { cached: 0, total: 0 } }
  }
  const now = Date.now()
  const appids = await wishlistAppids()
  const wcache = await readCache<WishlistCache>('wishlist.json', emptyWishlistCache())
  const wishCached = appids.filter((a) => wcache.items[String(a)]).length
  const activeMisses = appids.filter((a) => {
    const m = wcache.misses?.[String(a)]; return m !== undefined && now - m < MISS_TTL
  }).length
  const wishPending = Math.max(0, appids.length - wishCached - activeMisses)

  const games = await ownedGames()
  const rcache = await readCache<ReviewCache>('reviews.json', emptyReviewCache())
  const reviewCached = games.filter((g) => rcache.items[String(g.appid)]).length

  const ready = wishPending === 0 && reviewCached >= Math.min(REVIEW_GATE, games.length)
  return {
    configured: true, ready, warming: (await countStorefrontRemaining(now)) > 0,
    wishlist: { cached: wishCached, total: appids.length },
    library: { cached: reviewCached, total: games.length },
  }
}

// ---- Background warmer (sole cache writer) -------------------------------
const STEP_CALLS = 6              // storefront calls per tick ...
const STEP_INTERVAL_MS = 10_000   // ... every 10s  => ~36/min, safely under ~40/min
const ACH_INTERVAL_MS = 9_000     // achievements pacer (Web API — generous limit)
const COOLDOWN_MS = 5 * 60_000    // pause after a throttle
const IDLE_MS = 5 * 60_000        // when fully warm, re-check this often for stale/new items

let warmerStarted = false
export function startWarmer(): void {
  if (warmerStarted) return
  warmerStarted = true
  gog.startWarmer() // self-guards on GOG credentials; runs independently of Steam
  if (!configured()) return

  // Two independent pacers: storefront (appdetails/appreviews, ~40/min cap) and
  // achievements (Steam Web API, generous). Decoupled so a storefront throttle
  // never stalls achievement progress, and vice-versa.
  const storefront = async () => {
    let delay = STEP_INTERVAL_MS
    try {
      const { throttled, remaining } = await enrichmentStep(STEP_CALLS)
      if (throttled) { console.log('[warmer] storefront throttled — cooling down 5m'); delay = COOLDOWN_MS }
      else if (remaining === 0) delay = IDLE_MS
    } catch (e) { console.log('[warmer] storefront error:', (e as Error).message); delay = COOLDOWN_MS }
    setTimeout(storefront, delay)
  }
  const achievements = async () => {
    let delay = ACH_INTERVAL_MS
    try {
      const { throttled, remaining } = await achievementStep()
      if (throttled) { console.log('[warmer] achievements throttled — cooling down 5m'); delay = COOLDOWN_MS }
      else if (remaining === 0) delay = IDLE_MS
    } catch (e) { console.log('[warmer] achievements error:', (e as Error).message); delay = COOLDOWN_MS }
    setTimeout(achievements, delay)
  }
  const igdb = async () => {
    let delay = STEP_INTERVAL_MS
    try {
      const { throttled, remaining } = await igdbStep()
      if (throttled) { console.log('[warmer] IGDB throttled — cooling down 5m'); delay = COOLDOWN_MS }
      else if (remaining === 0) delay = IDLE_MS
    } catch (e) { console.log('[warmer] IGDB error:', (e as Error).message); delay = COOLDOWN_MS }
    setTimeout(igdb, delay)
  }
  setTimeout(storefront, 2_000)
  setTimeout(achievements, 3_000)
  if (igdbConfigured()) setTimeout(igdb, 4_000)
  console.log(`[warmer] started — storefront + achievements${igdbConfigured() ? ' + IGDB' : ''} pacers`)
}

function isThrottle(e: unknown): boolean {
  return e instanceof Error && /(\b429\b|throttl)/i.test(e.message)
}

// One paced batch: spend up to `budget` storefront calls on the highest-priority
// remaining work (wishlist first, then most-played library reviews). Stops early
// on a throttle. The ONLY place the disk caches are written.
async function enrichmentStep(budget: number): Promise<{ spent: number; throttled: boolean; remaining: number }> {
  let spent = 0, throttled = false
  const now = Date.now()

  // ---- Wishlist (priority: smaller + deal-sensitive) ----
  const appids = await wishlistAppids()
  const wcache = await readCache<WishlistCache>('wishlist.json', emptyWishlistCache())
  if (!wcache.misses) wcache.misses = {}
  const wishSet = new Set(appids.map(String))
  for (const k of Object.keys(wcache.items)) if (!wishSet.has(k)) delete wcache.items[k]
  for (const k of Object.keys(wcache.misses)) if (!wishSet.has(k)) delete wcache.misses[k]
  let wDirty = false

  for (const appid of appids) {
    if (spent >= budget || throttled) break
    const k = String(appid)
    const c = wcache.items[k]
    if (!c) {
      const m = wcache.misses[k]
      if (m !== undefined && now - m < MISS_TTL) continue // recently-missed, back off
      try {
        const base = await fetchAppDetails(appid); spent++
        if (!base) { wcache.misses[k] = now; wDirty = true; continue } // genuinely unavailable
        delete wcache.misses[k]
        let pct = 0
        if (spent < budget) {
          try { pct = (await reviewSummary(appid))?.pct ?? 0 } catch (e) { if (isThrottle(e)) throttled = true }
          spent++
        }
        wcache.items[k] = { ...base, reviewPct: pct, pricedAt: now, reviewedAt: now, cachedAt: now }
        wDirty = true
      } catch (e) { if (isThrottle(e)) throttled = true }
    } else if (now - c.pricedAt > PRICE_TTL) {
      try {
        const base = await fetchAppDetails(appid); spent++ // price refresh — details only
        if (base) {
          c.price = base.price; c.origPrice = base.origPrice; c.discountPct = base.discountPct
          c.isFree = base.isFree; c.name = base.name; c.releasedAt = base.releasedAt; c.pricedAt = now
          wDirty = true
        }
      } catch (e) { if (isThrottle(e)) throttled = true }
    }
  }
  if (wDirty) await writeCache('wishlist.json', wcache)

  // ---- Library reviews (most-played first) ----
  if (!throttled && spent < budget) {
    const games = await ownedGames()
    const rcache = await readCache<ReviewCache>('reviews.json', emptyReviewCache())
    const ownedSet = new Set(games.map((g) => String(g.appid)))
    for (const k of Object.keys(rcache.items)) if (!ownedSet.has(k)) delete rcache.items[k]
    let rDirty = false
    for (const g of games) {
      if (spent >= budget || throttled) break
      const k = String(g.appid); const c = rcache.items[k]
      if (c && now - c.reviewedAt <= REVIEW_TTL) continue
      try {
        const s = await reviewSummary(g.appid); spent++
        if (s) { rcache.items[k] = { ...s, reviewedAt: now }; rDirty = true }
      } catch (e) { if (isThrottle(e)) throttled = true }
    }
    if (rDirty) await writeCache('reviews.json', rcache)
  }

  // ---- App type (classify soundtracks/demos/etc. out of the library) ----
  if (!throttled && spent < budget) {
    const raw = await ownedGamesRaw()
    const tcache = await readCache<TypeCache>('apptypes.json', emptyTypeCache())
    const ownedSet = new Set(raw.map((g) => String(g.appid)))
    for (const k of Object.keys(tcache.items)) if (!ownedSet.has(k)) delete tcache.items[k]
    let tDirty = false
    for (const g of raw) {
      if (spent >= budget || throttled) break
      const k = String(g.appid); const c = tcache.items[k]
      if (c && now - c.at <= TYPE_TTL) continue
      try {
        const type = await fetchAppType(g.appid); spent++
        tcache.items[k] = { type, at: now }; tDirty = true
      } catch (e) { if (isThrottle(e)) throttled = true }
    }
    if (tDirty) await writeCache('apptypes.json', tcache)
  }

  return { spent, throttled, remaining: await countStorefrontRemaining(now) }
}

// One achievements batch (Steam Web API — own rate bucket, own pacer).
async function achievementStep(): Promise<{ throttled: boolean; remaining: number }> {
  const now = Date.now()
  const games = await ownedGames()
  const acache = await readCache<AchCache>('achievements.json', emptyAchCache())
  const ownedSet = new Set(games.map((g) => String(g.appid)))
  for (const k of Object.keys(acache.items)) if (!ownedSet.has(k)) delete acache.items[k]

  let dirty = false, spent = 0, throttled = false
  for (const g of games) {
    if (spent >= ACH_PER_STEP) break
    const k = String(g.appid); const c = acache.items[k]
    if (c && now - c.at <= ACH_TTL) continue
    try {
      const a = await fetchAchievements(g.appid); spent++
      acache.items[k] = { ...a, at: now }; dirty = true
    } catch (e) {
      spent++
      if (isThrottle(e)) { throttled = true; break }
      // odd app (non-game / 400): record as none so it doesn't block the rest;
      // the daily TTL retries it later.
      acache.items[k] = { unlocked: 0, total: 0, at: now }; dirty = true
    }
  }
  if (dirty) await writeCache('achievements.json', acache)

  let remaining = 0
  for (const g of games) {
    const a = acache.items[String(g.appid)]
    if (!a || now - a.at > ACH_TTL) remaining++
  }
  return { throttled, remaining }
}

// One IGDB batch: resolve time-to-beat for un-cached/stale appids. No-op unless
// IGDB credentials are configured. Internally batched, so a few hundred appids
// resolve in ~2 requests.
async function igdbStep(): Promise<{ throttled: boolean; remaining: number }> {
  if (!igdbConfigured()) return { throttled: false, remaining: 0 }
  const now = Date.now()
  const games = await ownedGames()
  const cache = await readCache<TtbCache>('timetobeat.json', emptyTtbCache())
  const ownedSet = new Set(games.map((g) => String(g.appid)))
  for (const k of Object.keys(cache.items)) if (!ownedSet.has(k)) delete cache.items[k]

  const due = games
    .map((g) => g.appid)
    .filter((a) => { const c = cache.items[String(a)]; return !c || now - c.at > TTB_TTL })

  if (due.length === 0) return { throttled: false, remaining: 0 }

  try {
    const map = await fetchTimeToBeat(due.slice(0, TTB_PER_STEP))
    for (const [appid, hours] of Object.entries(map)) cache.items[appid] = { hours, at: now }
    await writeCache('timetobeat.json', cache)
  } catch (e) {
    if (isThrottle(e)) return { throttled: true, remaining: due.length }
    throw e
  }
  return { throttled: false, remaining: Math.max(0, due.length - TTB_PER_STEP) }
}

// Count of storefront items still needing a call (un-cached or stale).
async function countStorefrontRemaining(now: number): Promise<number> {
  let n = 0
  const appids = await wishlistAppids()
  const wcache = await readCache<WishlistCache>('wishlist.json', emptyWishlistCache())
  for (const a of appids) {
    const k = String(a); const c = wcache.items[k]
    if (!c) { const m = wcache.misses?.[k]; if (!(m !== undefined && now - m < MISS_TTL)) n++ }
    else if (now - c.pricedAt > PRICE_TTL) n++
  }
  const games = await ownedGames()
  const rcache = await readCache<ReviewCache>('reviews.json', emptyReviewCache())
  for (const g of games) {
    const c = rcache.items[String(g.appid)]
    if (!c || now - c.reviewedAt > REVIEW_TTL) n++
  }
  const raw = await ownedGamesRaw()
  const tcache = await readCache<TypeCache>('apptypes.json', emptyTypeCache())
  for (const g of raw) {
    const c = tcache.items[String(g.appid)]
    if (!c || now - c.at > TYPE_TTL) n++
  }
  return n
}

// ---- Storefront fetchers --------------------------------------------------
// An app's store type ("game" | "music" | "demo" | "dlc" | ...). Returns
// 'unknown' when the app has no store page (delisted) so it stays counted as a
// game; THROWS on throttle/transient errors so it's retried, not mis-classified.
async function fetchAppType(appid: number): Promise<string> {
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`,
    { signal: AbortSignal.timeout(12_000) },
  )
  if (!res.ok) throw new Error(`appdetails ${appid} -> ${res.status}`)
  const body = (await res.json()) as Record<string, any> | null
  const entry = body?.[String(appid)]
  if (!entry) throw new Error(`appdetails ${appid} -> empty response`)
  if (entry.success === false) return 'unknown' // no store page -> keep as game
  return entry.data?.type ?? 'unknown'
}

// Store details for one app. Returns null ONLY when Steam explicitly says the
// app is unavailable (success:false). Anything else (non-200/throttled/malformed)
// THROWS, so the warmer treats it as transient and retries instead of tombstoning.
async function fetchAppDetails(appid: number): Promise<WishlistItem | null> {
  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`,
    { signal: AbortSignal.timeout(12_000) },
  )
  if (!res.ok) throw new Error(`appdetails ${appid} -> ${res.status}`) // 429 etc
  const body = (await res.json()) as Record<string, any> | null
  const entry = body?.[String(appid)]
  if (!entry) throw new Error(`appdetails ${appid} -> empty response`)
  if (entry.success === false) return null
  if (!entry.data) throw new Error(`appdetails ${appid} -> no data`)
  const d = entry.data

  const price = d.price_overview
  const final = price ? price.final / 100 : 0
  const orig = price ? price.initial / 100 : 0
  const discount = price?.discount_percent ?? 0

  return {
    appid,
    name: d.name ?? `App ${appid}`,
    price: final,
    origPrice: discount ? orig : final,
    discountPct: discount,
    reviewPct: 0, // filled separately so price refreshes don't re-fetch reviews
    releasedAt: d.release_date?.date ?? '',
    headerImage: d.header_image ?? hdr(appid),
    isFree: d.is_free === true,
  }
}

// Review summary (positive % + Steam's descriptor). Throws on 429 so the warmer
// can detect throttling; returns null on other transient failures.
async function reviewSummary(appid: number): Promise<{ pct: number; desc: string } | null> {
  const res = await fetch(
    `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (res.status === 429) throw new Error('appreviews 429')
  if (!res.ok) return null
  const j = (await res.json()) as any
  if (j?.success !== 1 || !j.query_summary) return null
  const q = j.query_summary
  const total = q.total_reviews ?? 0
  return {
    pct: total ? Math.round((q.total_positive / total) * 100) : 0,
    desc: q.review_score_desc ?? (total ? '' : 'No user reviews'),
  }
}
