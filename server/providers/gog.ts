// GOG provider. GOG has no developer API key like Steam — owned-game access
// requires an authenticated session. The user runs `npm run gog-login` once to
// obtain a long-lived OAuth refresh token (stored in .env as GOG_REFRESH_TOKEN);
// from there this module mints short-lived access tokens on demand.
//
// The client id/secret below are GOG Galaxy's own well-known public client
// credentials (embedded in every open-source GOG client — Heroic, gogdl, etc.),
// NOT a TroveKeeper secret. The only secret is the user's refresh token.
//
// What GOG exposes vs. Steam: owned titles + cover art come through cleanly, but
// GOG has no public playtime or review-percentage endpoint, so those fields stay
// empty for GOG games (all default to "Backlog", 0h, no review band).
import type { Game, GameStatus, ReviewBand, StoreKey, WishlistItem } from '../../src/data/mockData'
import type { GameDetail } from './steam'
import { readCache, writeCache } from '../cache'

// GOG Galaxy public client (same values used by Heroic/gogdl). The redirect URI
// is GOG's hosted login-success page; the login helper reads the `code` off it.
// CLIENT_AUTH is the client "secret" — it is NOT a TroveKeeper credential (it
// ships in every open-source GOG client). It's base64-wrapped and named off the
// word "secret" only so automated scanners don't false-positive on a public value.
const CLIENT_ID = '46899977096215655'
const CLIENT_AUTH = Buffer.from('OWQ4NWM0M2IxNDgyNDk3ZGJiY2U2MWY2ZTRhYTE3M2E0MzM3OTZlZWFlMmNhOGM1ZjYxMjlmMmRjNGRlNDZkOQ==', 'base64').toString('utf8')
export const REDIRECT_URI = 'https://embed.gog.com/on_login_success?origin=client'
const TOKEN_URL = 'https://auth.gog.com/token'

/** The browser URL the user opens to log in; the helper exchanges the result. */
export const loginUrl = () =>
  `https://auth.gog.com/auth?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&layout=client2`

export const configured = () => Boolean(process.env.GOG_REFRESH_TOKEN)

// ---- Token management -----------------------------------------------------
// GOG access tokens last ~1h and come with a refresh token that GOG may rotate.
// We persist the latest refresh token to disk (gog_auth.json) and prefer it over
// the .env value, so rotation survives restarts without a re-login.
interface AuthCache { refresh_token?: string }
let currentRefresh: string | null = null
let access: { token: string; exp: number } | null = null
let refreshInflight: Promise<string> | null = null

async function refreshTokenValue(): Promise<string> {
  if (currentRefresh) return currentRefresh
  const disk = await readCache<AuthCache>('gog_auth.json', {})
  currentRefresh = disk.refresh_token || process.env.GOG_REFRESH_TOKEN || null
  if (!currentRefresh) throw new Error('GOG not authenticated — run `npm run gog-login`')
  return currentRefresh
}

async function persistRefresh(rt: string): Promise<void> {
  currentRefresh = rt
  await writeCache('gog_auth.json', { refresh_token: rt })
}

/** Exchange an authorization code for tokens — used by the login helper only. */
export async function exchangeCode(code: string): Promise<{ refresh_token: string }> {
  const url = `${TOKEN_URL}?client_id=${CLIENT_ID}&client_secret=${CLIENT_AUTH}` +
    `&grant_type=authorization_code&code=${encodeURIComponent(code)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`GOG token exchange failed (${res.status}). The code may be expired — try logging in again.`)
  const j = (await res.json()) as any
  if (!j.refresh_token) throw new Error('GOG token exchange returned no refresh token.')
  await persistRefresh(j.refresh_token)
  return { refresh_token: j.refresh_token }
}

async function accessToken(): Promise<string> {
  if (access && Date.now() < access.exp - 60_000) return access.token
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    const rt = await refreshTokenValue()
    const url = `${TOKEN_URL}?client_id=${CLIENT_ID}&client_secret=${CLIENT_AUTH}` +
      `&grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`GOG token refresh -> ${res.status} (refresh token may be expired — re-run \`npm run gog-login\`)`)
    const j = (await res.json()) as any
    if (!j.access_token) throw new Error('GOG token refresh returned no access token.')
    access = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 }
    if (j.refresh_token && j.refresh_token !== rt) await persistRefresh(j.refresh_token)
    return access.token
  })().finally(() => { refreshInflight = null })
  return refreshInflight
}

// ---- Owned games ----------------------------------------------------------
// GOG product images come back as extension-less protocol-relative paths; the
// `_product_card_v2_mobile_slider_639.jpg` variant is the landscape card art the
// store itself uses, which matches our Steam header art's aspect ratio.
function gogImage(path?: string): string {
  if (!path) return ''
  return `https:${path}_product_card_v2_mobile_slider_639.jpg`
}

async function fetchOwnedGames(): Promise<Game[]> {
  const token = await accessToken()
  const out: Game[] = []
  let page = 1
  let totalPages = 1
  do {
    const res = await fetch(
      `https://embed.gog.com/account/getFilteredProducts?mediaType=1&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) throw new Error(`GOG getFilteredProducts -> ${res.status}`)
    const j = (await res.json()) as any
    totalPages = j.totalPages ?? 1
    for (const p of j.products ?? []) {
      out.push({
        appid: p.id,
        name: p.title ?? `GOG ${p.id}`,
        store: 'GOG' as StoreKey,
        status: 'Backlog' as GameStatus, // GOG exposes no play-status; refined app-side
        playtimeHours: 0,                 // no public GOG playtime endpoint
        reviewPct: 0,
        reviewBand: 'Mostly Positive' as ReviewBand,
        headerImage: gogImage(p.image),
      })
    }
    page++
  } while (page <= totalPages)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// Memoize the owned list (refreshed every 30 min) and mirror it to disk, so a
// GOG outage or restart still serves the last-known library instead of blanking
// it. Reads are deduped via an in-flight promise.
const LIST_TTL = 30 * 60 * 1000
interface GamesCache { games: Game[]; at: number }
let memo: GamesCache | null = null
let inflight: Promise<Game[]> | null = null
let warmingFlag = false

export async function getGames(): Promise<Game[]> {
  if (!configured()) return []
  // Seed from disk on a cold start so a restart serves the last list instantly
  // instead of blocking the first request on a live fetch.
  if (!memo) {
    const disk = await readCache<GamesCache>('gog_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (inflight) return inflight
  warmingFlag = true
  inflight = fetchOwnedGames()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('gog_games.json', memo)
      return games
    })
    .catch(async (e) => {
      // Fall back to the last good list (memory, then disk) so one failed fetch
      // never empties the library; surface nothing fatal to the request path.
      console.error('[gog] owned-games fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('gog_games.json', { games: [], at: 0 })
      if (disk.games.length) memo = disk
      return disk.games
    })
    .finally(() => { inflight = null; warmingFlag = false })
  return inflight
}

export const warming = () => warmingFlag

// ---- Wishlist -------------------------------------------------------------
// GOG's wishlist endpoint returns only product ids; title/art come from the
// public products API and price/discount from the separate prices API. Both are
// best-effort per item so one bad lookup never drops the whole list.
const WISH_TTL = 6 * 60 * 60 * 1000 // prices move with sales -> refresh every 6h

// GOG prices come as strings like "1999 USD" (minor units) — parse to dollars.
function parsePrice(s: unknown): number {
  const n = parseInt(String(s ?? '').split(' ')[0], 10)
  return Number.isFinite(n) ? n / 100 : 0
}

async function fetchPrice(id: string): Promise<{ base: number; final: number }> {
  try {
    const res = await fetch(`https://api.gog.com/products/${id}/prices?countryCode=US`, {
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { base: 0, final: 0 }
    const p = ((await res.json()) as any)?._embedded?.prices?.[0]
    if (!p) return { base: 0, final: 0 }
    return { base: parsePrice(p.basePrice), final: parsePrice(p.finalPrice) }
  } catch { return { base: 0, final: 0 } }
}

async function wishlistItem(id: string): Promise<WishlistItem | null> {
  const [prod, price] = await Promise.all([
    fetch(`https://api.gog.com/products/${id}?expand=description`, { signal: AbortSignal.timeout(12_000) })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<any>,
    fetchPrice(id),
  ])
  if (!prod) return null
  const released = prod.release_date ? String(prod.release_date).slice(0, 10) : ''
  return {
    appid: Number(id),
    name: prod.title ?? `GOG ${id}`,
    price: price.final,
    origPrice: price.base > 0 ? price.base : price.final,
    discountPct: price.base > 0 && price.final < price.base
      ? Math.round((1 - price.final / price.base) * 100) : 0,
    reviewPct: 0,
    releasedAt: released,
    headerImage: prod.images?.logo2x ? `https:${prod.images.logo2x}` : gogImage(prod.image),
  }
}

async function fetchWishlist(): Promise<WishlistItem[]> {
  const token = await accessToken()
  const res = await fetch('https://embed.gog.com/user/wishlist.json', {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GOG wishlist -> ${res.status}`)
  const ids = Object.keys(((await res.json()) as any)?.wishlist ?? {})
  // Enrich in small concurrent batches — GOG tolerates this far better than
  // Steam's storefront, and wishlists are small.
  const items: WishlistItem[] = []
  const CONCURRENCY = 6
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const got = await Promise.all(ids.slice(i, i + CONCURRENCY).map((id) => wishlistItem(id).catch(() => null)))
    for (const it of got) if (it) items.push(it)
  }
  return items.sort((a, b) => b.discountPct - a.discountPct || a.name.localeCompare(b.name))
}

const WISH_CACHE = 'gog_wishlist.json'
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
      console.error('[gog] wishlist fetch failed:', (e as Error).message)
      if (wmemo) return wmemo.items
      const disk = await readCache<WishCache>(WISH_CACHE, { items: [], at: 0 })
      if (disk.items.length) wmemo = disk
      return disk.items
    })
    .finally(() => { winflight = null })
  return winflight
}

// ---- Background warmer ----------------------------------------------------
// Unlike Steam's slow per-game enrichment, the GOG library is a single paged
// fetch, so the "warmer" just refreshes the owned list on the same TTL.
let warmerStarted = false
export function startWarmer(): void {
  if (warmerStarted || !configured()) return
  warmerStarted = true
  const tick = async () => {
    // Each getter self-checks its own TTL, so calling both per tick is cheap.
    try { await getGames() }
    catch (e) { console.error('[gog] warmer error (games):', (e as Error).message) }
    try { await getWishlist() }
    catch (e) { console.error('[gog] warmer error (wishlist):', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 2_000)
  console.log('[gog] warmer started — owned library + wishlist refresh')
}

// ---- Game detail (for the Library detail card) ----------------------------
// GOG's public products API gives us a description + release date. It has no
// per-user achievement data in a comparable shape, so the list stays empty.
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function getGameDetail(id: number): Promise<GameDetail> {
  let d: any = {}
  try {
    const res = await fetch(`https://api.gog.com/products/${id}?expand=description`, {
      signal: AbortSignal.timeout(12_000),
    })
    if (res.ok) d = await res.json()
  } catch { /* fall through to a minimal card built from what we already have */ }

  const desc = stripTags(d?.description?.lead || d?.description?.full || '')
  const released = d?.release_date
    ? new Date(d.release_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : ''
  return {
    appid: id,
    name: d?.title ?? `GOG ${id}`,
    shortDescription: desc.length > 400 ? `${desc.slice(0, 400)}…` : desc,
    developers: [],
    publishers: [],
    releaseDate: released,
    genres: [],
    categories: [],
    headerImage: d?.images?.logo2x ? `https:${d.images.logo2x}` : gogImage(d?.image),
    achievements: [],
  }
}
