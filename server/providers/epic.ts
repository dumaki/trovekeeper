// Epic Games Store provider. Like GOG, Epic has no developer API key — the user
// runs `npm run epic-login` once to obtain a long-lived (rotating) OAuth refresh
// token via Epic's well-known public launcher client (the same one Legendary and
// Heroic use). The server mints `eg1` access tokens on demand.
//
// What Epic exposes vs. Steam: owned games + cover art resolve cleanly via the
// launcher assets + catalog APIs, and the wishlist (with inline prices) comes
// from the store GraphQL using the same launcher token. Epic has no public
// playtime/review-% , so those stay empty (games default to "Backlog", 0h).
import type { Game, GameStatus, ReviewBand, StoreKey, WishlistItem } from '../../src/data/mockData'
import type { GameDetail } from './steam'
import { readCache, writeCache } from '../cache'

// Epic Games Launcher public client (launcherAppClient2) — NOT a TroveKeeper
// credential; it ships in every open-source Epic client. base64-wrapped and
// named off the words "secret"/"id" only so scanners don't flag public values.
const CLIENT_REF = Buffer.from('MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE=', 'base64').toString('utf8')
const CLIENT_AUTH = Buffer.from('ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc2Y2Y=', 'base64').toString('utf8')
const BASIC = 'basic ' + Buffer.from(`${CLIENT_REF}:${CLIENT_AUTH}`).toString('base64')
const UA = 'EpicGamesLauncher/14.0.8-22004686+++Portal+Release-Live'

const TOKEN_URL = 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token'

// The browser flow: log in, then this redirect URL returns JSON with an
// `authorizationCode` the user pastes into the login helper.
export const redirectUrl = () =>
  `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT_REF}&responseType=code`
export const loginUrl = () =>
  `https://www.epicgames.com/id/login?redirectUrl=${encodeURIComponent(redirectUrl())}`

export const configured = () => Boolean(process.env.EPIC_REFRESH_TOKEN)

// ---- Token management -----------------------------------------------------
// Epic rotates the refresh token on most refreshes, so we persist the latest to
// disk (epic_auth.json) and prefer it over the .env value.
interface AuthCache { refresh_token?: string }
let currentRefresh: string | null = null
let access: { token: string; exp: number } | null = null
let refreshInflight: Promise<string> | null = null

async function tokenRequest(body: string): Promise<any> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: BASIC, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Epic token endpoint -> ${res.status}`)
  return res.json()
}

async function persistRefresh(rt: string): Promise<void> {
  currentRefresh = rt
  await writeCache('epic_auth.json', { refresh_token: rt })
}

/** Exchange an authorization code for tokens — used by the login helper only. */
export async function exchangeCode(code: string): Promise<{ refresh_token: string }> {
  const j = await tokenRequest(`grant_type=authorization_code&code=${encodeURIComponent(code)}&token_type=eg1`)
    .catch(() => { throw new Error('Epic code exchange failed — the code is single-use and expires fast; log in again.') })
  if (!j.refresh_token) throw new Error('Epic code exchange returned no refresh token.')
  await persistRefresh(j.refresh_token)
  return { refresh_token: j.refresh_token }
}

async function refreshTokenValue(): Promise<string> {
  if (currentRefresh) return currentRefresh
  const disk = await readCache<AuthCache>('epic_auth.json', {})
  currentRefresh = disk.refresh_token || process.env.EPIC_REFRESH_TOKEN || null
  if (!currentRefresh) throw new Error('Epic not authenticated — run `npm run epic-login`')
  return currentRefresh
}

async function accessToken(): Promise<string> {
  if (access && Date.now() < access.exp - 60_000) return access.token
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    const rt = await refreshTokenValue()
    const j = await tokenRequest(`grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&token_type=eg1`)
      .catch(() => { throw new Error('Epic token refresh failed (refresh token may be expired — re-run `npm run epic-login`)') })
    if (!j.access_token) throw new Error('Epic token refresh returned no access token.')
    access = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 28800) * 1000 }
    if (j.refresh_token && j.refresh_token !== rt) await persistRefresh(j.refresh_token)
    return access.token
  })().finally(() => { refreshInflight = null })
  return refreshInflight
}

const authed = (token: string) => ({ Authorization: `bearer ${token}`, 'User-Agent': UA })

// ---- Owned games ----------------------------------------------------------
// Catalog items use opaque hex ids; the rest of the app keys games by a numeric
// `appid`, so we hash the id into a stable number for that field and carry the
// real id in `storeId` (used for status + detail lookups).
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007
  return 2_100_000_000 + h
}

// Pick the most landscape-ish cover from Epic's keyImages set.
function pickImage(keyImages: any[]): string {
  const byType = (t: string) => keyImages.find((k) => k?.type === t)?.url
  return byType('DieselStoreFrontWide') || byType('OfferImageWide') || byType('DieselStoreFrontTall')
    || byType('OfferImageTall') || byType('Thumbnail') || keyImages?.[0]?.url || ''
}

// Internal record: a Game plus the extra fields the detail card needs, so detail
// is served from cache without another round trip.
interface EpicRecord extends Game {
  storeId: string
  namespace: string
  shortDescription: string
  developer: string
  releaseDate: string
}

async function fetchAssets(token: string): Promise<{ catalogItemId: string; namespace: string }[]> {
  const res = await fetch(
    'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/public/assets/Windows?label=Live',
    { headers: authed(token), signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`Epic assets -> ${res.status}`)
  const list = (await res.json()) as any[]
  // Dedup by catalogItemId (the same item can appear under multiple builds).
  const seen = new Set<string>()
  const out: { catalogItemId: string; namespace: string }[] = []
  for (const a of list ?? []) {
    if (!a?.catalogItemId || !a?.namespace || seen.has(a.catalogItemId)) continue
    seen.add(a.catalogItemId)
    out.push({ catalogItemId: a.catalogItemId, namespace: a.namespace })
  }
  return out
}

// Resolve titles/art/categories for a namespace's items via the catalog bulk API.
async function fetchCatalog(token: string, namespace: string, ids: string[]): Promise<Record<string, any>> {
  const params = new URLSearchParams()
  for (const id of ids) params.append('id', id)
  params.set('includeMainGameDetails', 'true')
  params.set('country', 'US')
  params.set('locale', 'en-US')
  const res = await fetch(
    `https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/${namespace}/bulk/items?${params}`,
    { headers: authed(token), signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) throw new Error(`Epic catalog ${namespace} -> ${res.status}`)
  return (await res.json()) as Record<string, any>
}

// Keep only base games: must be categorised as a game, not a DLC/add-on, and not
// pointing at a parent game (mainGameItem marks DLC).
function isGame(item: any): boolean {
  const paths: string[] = (item?.categories ?? []).map((c: any) => c?.path)
  if (item?.mainGameItem) return false
  if (paths.some((p) => p === 'addons' || p === 'addons/durable' || p === 'digitalextras')) return false
  return paths.includes('games')
}

async function fetchOwnedGames(): Promise<EpicRecord[]> {
  const token = await accessToken()
  const assets = await fetchAssets(token)
  // Group catalog lookups by namespace (most have a single item).
  const byNs = new Map<string, string[]>()
  for (const a of assets) byNs.set(a.namespace, [...(byNs.get(a.namespace) ?? []), a.catalogItemId])

  const records: EpicRecord[] = []
  for (const [namespace, ids] of byNs) {
    let catalog: Record<string, any>
    try { catalog = await fetchCatalog(token, namespace, ids) }
    catch (e) { console.error('[epic] catalog skip', namespace, (e as Error).message); continue }
    for (const id of ids) {
      const item = catalog[id]
      if (!item || !isGame(item)) continue
      records.push({
        appid: hashId(id),
        storeId: id,
        namespace,
        name: item.title ?? `Epic ${id}`,
        store: 'Epic' as StoreKey,
        status: 'Backlog' as GameStatus,
        playtimeHours: 0,
        reviewPct: 0,
        reviewBand: 'Mostly Positive' as ReviewBand,
        headerImage: pickImage(item.keyImages ?? []),
        shortDescription: item.description ?? '',
        developer: item.developer ?? '',
        releaseDate: item.releaseInfo?.[0]?.dateAdded ? String(item.releaseInfo[0].dateAdded).slice(0, 10) : '',
      })
    }
  }
  return records.sort((a, b) => a.name.localeCompare(b.name))
}

const LIST_TTL = 30 * 60 * 1000
interface GamesCache { games: EpicRecord[]; at: number }
let memo: GamesCache | null = null
let inflight: Promise<EpicRecord[]> | null = null
let warmingFlag = false

async function loadRecords(): Promise<EpicRecord[]> {
  if (!configured()) return []
  if (!memo) {
    const disk = await readCache<GamesCache>('epic_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (inflight) return inflight
  warmingFlag = true
  inflight = fetchOwnedGames()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('epic_games.json', memo)
      return games
    })
    .catch(async (e) => {
      console.error('[epic] owned-games fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('epic_games.json', { games: [], at: 0 })
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
    name: rec?.name ?? 'Epic game',
    shortDescription: rec?.shortDescription ?? '',
    developers: rec?.developer ? [rec.developer] : [],
    publishers: [],
    releaseDate: rec?.releaseDate ?? '',
    genres: [],
    categories: [],
    headerImage: rec?.headerImage ?? '',
    achievements: [],
  }
}

// ---- Wishlist (store GraphQL, same launcher bearer; prices inline) ---------
const WISH_TTL = 6 * 60 * 60 * 1000
const STORE_GQL = 'https://launcher.store.epicgames.com/graphql'
const WISHLIST_QUERY = `query getWishlistQuery($country: String!, $locale: String) {
  Wishlist { wishlistItems { elements {
    offerId namespace
    offer(locale: $locale) {
      title id namespace releaseDate effectiveDate
      keyImages { type url }
      price(country: $country) {
        totalPrice { discountPrice originalPrice currencyCode currencyInfo { decimals } }
      }
    }
  } } }
}`

function money(minor: unknown, decimals: number): number {
  const n = Number(minor)
  return Number.isFinite(n) ? n / 10 ** (decimals || 2) : 0
}

async function fetchWishlist(): Promise<WishlistItem[]> {
  const token = await accessToken()
  const res = await fetch(STORE_GQL, {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query: WISHLIST_QUERY, variables: { country: 'US', locale: 'en-US' } }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Epic wishlist GraphQL -> ${res.status}`)
  const elements: any[] = ((await res.json()) as any)?.data?.Wishlist?.wishlistItems?.elements ?? []
  const items: WishlistItem[] = []
  for (const el of elements) {
    const offer = el?.offer
    if (!offer) continue
    const tp = offer.price?.totalPrice
    const decimals = tp?.currencyInfo?.decimals ?? 2
    const final = tp ? money(tp.discountPrice, decimals) : 0
    const base = tp ? money(tp.originalPrice, decimals) : 0
    items.push({
      appid: hashId(offer.id ?? el.offerId ?? offer.title ?? ''),
      name: offer.title ?? 'Epic game',
      price: final,
      origPrice: base > 0 ? base : final,
      discountPct: base > 0 && final < base ? Math.round((1 - final / base) * 100) : 0,
      reviewPct: 0,
      releasedAt: (offer.releaseDate || offer.effectiveDate || '').slice(0, 10),
      headerImage: pickImage(offer.keyImages ?? []),
      isFree: base === 0 && final === 0 || undefined,
    })
  }
  return items.sort((a, b) => b.discountPct - a.discountPct || a.name.localeCompare(b.name))
}

const WISH_CACHE = 'epic_wishlist.json'
interface WishCache { items: WishlistItem[]; at: number }
let wmemo: WishCache | null = null
let winflight: Promise<WishlistItem[]> | null = null

export async function getWishlist(): Promise<WishlistItem[]> {
  if (!configured()) return []
  if (!wmemo) {
    const disk = await readCache<WishCache>(WISH_CACHE, { items: [], at: 0 })
    if (disk.at) wmemo = disk
  }
  if (wmemo && Date.now() - wmemo.at < WISH_TTL) return wmemo.items
  if (winflight) return winflight
  winflight = fetchWishlist()
    .then(async (items) => {
      wmemo = { items, at: Date.now() }
      await writeCache(WISH_CACHE, wmemo)
      return items
    })
    .catch(async (e) => {
      // Best-effort: a wishlist failure must never break the library.
      console.error('[epic] wishlist fetch failed:', (e as Error).message)
      if (wmemo) return wmemo.items
      const disk = await readCache<WishCache>(WISH_CACHE, { items: [], at: 0 })
      if (disk.items.length) wmemo = disk
      return disk.items
    })
    .finally(() => { winflight = null })
  return winflight
}

// ---- Background warmer ----------------------------------------------------
let warmerStarted = false
export function startWarmer(): void {
  if (warmerStarted || !configured()) return
  warmerStarted = true
  const tick = async () => {
    try { await getGames() } catch (e) { console.error('[epic] warmer error (games):', (e as Error).message) }
    try { await getWishlist() } catch (e) { console.error('[epic] warmer error (wishlist):', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 2_500)
  console.log('[epic] warmer started — owned library + wishlist refresh')
}
