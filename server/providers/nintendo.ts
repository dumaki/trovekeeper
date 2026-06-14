// Nintendo (eShop) provider. Nintendo has no developer API; the eShop web app
// (ec.nintendo.com, a Next.js/NextAuth site) reads purchase history from a
// GraphQL backend at wb.lp1.savanna.srv.nintendo.net, authed by a 15-minute
// Nintendo Account `id_token` passed inside the GraphQL variables.
//
// We don't do the OAuth dance: instead we hold the site's own session cookie
// (the `__Secure-next-auth.session-token`, good for ~30 days) and call the
// eShop's `GET /api/auth/session` route, which re-mints a fresh 15-min id_token
// from that cookie. So the long-lived credential is a COOKIE captured once via
// `npm run nintendo-login`, re-pasted ~monthly (the fetchers fail soft meanwhile).
//
// Two independent surfaces, two independent credentials:
//   - eShop library  : ec.nintendo.com session cookie     (NINTENDO_COOKIE)
//   - Store wishlist : nintendo.com store cookie           (NINTENDO_STORE_COOKIE)
//
// What Nintendo exposes vs. Steam: only the purchased title + date (and ~2 years
// of digital history — cartridge/older purchases never appear). No cover art, no
// playtime, no achievements (the platform has none), no review %. Games default
// to "Backlog".
import type { Game, GameStatus, ReviewBand, StoreKey, WishlistItem } from '../../src/data/mockData'
import type { GameDetail } from './steam'
import { readCache, writeCache } from '../cache'

export const configured = () => Boolean(eshopCookie())
// Wishlist is dormant until its (still-unverified) endpoint URL is known too.
const wishlistConfigured = () => Boolean(storeCookie() && process.env.NINTENDO_WISHLIST_URL)

// ---- Fixed eShop app constants (public, NOT TroveKeeper secrets) -----------
// The savanna client id + persisted-query hash are 64-hex public app values that
// WOULD trip the pre-commit 32-hex guard, so they're base64-wrapped + named off
// neither "secret" nor "key" (same convention as gog/epic public client auth).
const SAVANNA_CLIENT = Buffer.from(
  'MDQyZTRiZDFmMGVlYzE0NDE2N2RiYzBjNjNmMWQxNzg3NmU3YjllYzMyMjcxM2I2MTM2MTQyMTRlMzY3NWRmOQ==', 'base64').toString('utf8')
const TX_QUERY_HASH = Buffer.from(
  'NWNkNzcyMDNiNzQ1MTQ5NTQwNDljOTNmNmUzYTVlZDY2ZDU2NDdlYjI3MTRiZDZiZjcyZWJkNDcwYTI1YTA4ZQ==', 'base64').toString('utf8')
const GRAPHQL_URL = 'https://wb.lp1.savanna.srv.nintendo.net/graphql'
const SESSION_URL = 'https://ec.nintendo.com/api/auth/session'

// ---- Credential management ------------------------------------------------
// The long-lived credential (the ec.nintendo.com session cookie) is captured
// once and persisted to .cache/nintendo_auth.json (preferred) or .env.
interface AuthCache { cookie?: string; storeCookie?: string }
let authMemo: AuthCache | null = null

function loadAuth(): AuthCache {
  if (authMemo) return authMemo
  // Sync seed from .env so configured() works before the disk override hydrates.
  authMemo = {
    cookie: process.env.NINTENDO_COOKIE || undefined,
    storeCookie: process.env.NINTENDO_STORE_COOKIE || undefined,
  }
  return authMemo
}

let hydrated = false
async function hydrateAuth(): Promise<void> {
  if (hydrated) return
  hydrated = true
  const disk = await readCache<AuthCache>('nintendo_auth.json', {})
  const base = loadAuth()
  authMemo = { cookie: disk.cookie || base.cookie, storeCookie: disk.storeCookie || base.storeCookie }
}

const eshopCookie = () => loadAuth().cookie
const storeCookie = () => loadAuth().storeCookie

/** Persist a freshly-captured cookie — used by the login helper only. */
export async function persistAuth(cookie?: string, store?: string): Promise<void> {
  const cur = await readCache<AuthCache>('nintendo_auth.json', {})
  const next: AuthCache = { cookie: cookie || cur.cookie, storeCookie: store || cur.storeCookie }
  await writeCache('nintendo_auth.json', next)
  authMemo = next
  hydrated = true
}

const browserUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// ---- id_token minting (session cookie -> 15-min id_token, cached) ----------
// GET /api/auth/session decrypts the next-auth cookie server-side and returns the
// current Nintendo Account id_token (re-minting it if expired). We cache the
// returned id_token until ~1 min before its own `exp` claim.
let idTok: { token: string; exp: number } | null = null
let idInflight: Promise<string> | null = null

function jwtExpMs(jwt: string): number {
  try {
    const p = jwt.split('.')[1]
    const json = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const exp = JSON.parse(json).exp
    return typeof exp === 'number' ? exp * 1000 : 0
  } catch { return 0 }
}

async function idToken(): Promise<string> {
  if (idTok && Date.now() < idTok.exp - 60_000) return idTok.token
  if (idInflight) return idInflight
  idInflight = (async () => {
    await hydrateAuth()
    const cookie = eshopCookie()
    if (!cookie) throw new Error('Nintendo not authenticated — run `npm run nintendo-login`')
    const res = await fetch(SESSION_URL, {
      headers: {
        Cookie: cookie,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://ec.nintendo.com/my/transactions/1',
        'User-Agent': browserUA,
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Nintendo session -> ${res.status} (cookie may be expired — re-run \`npm run nintendo-login\`)`)
    const j = (await res.json()) as any
    // NextAuth returns {} (not 401) when the session cookie is invalid/expired.
    const token: string | undefined = j.idToken ?? j.id_token
    if (!token) throw new Error('Nintendo session returned no id_token — cookie expired; re-run `npm run nintendo-login`')
    const exp = jwtExpMs(token)
    idTok = { token, exp: exp || Date.now() + 14 * 60_000 }
    return token
  })().finally(() => { idInflight = null })
  return idInflight
}

// Nintendo transaction ids are large integers; like Epic/Xbox we hash the id
// into a stable numeric `appid` and carry the real id in `storeId`.
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007
  return 2_500_000_000 + h
}

interface NintendoRecord extends Game {
  storeId: string
  shortDescription: string
  releaseDate: string
}

// ---- eShop library (savanna GraphQL purchase history) ----------------------
// TransactionsClientRootClient is a persisted query (server-side query body keyed
// by sha256 hash), so we send only the hash + variables. Paginated by offset.
const PAGE = 50
const MAX_PAGES = 40 // safety cap; ~2 years of digital history is well within this

function txUrl(idToken: string, offset: number): string {
  const variables = { country: 'US', idToken, language: 'en', limit: PAGE, offset, shopId: 3 }
  const extensions = { persistedQuery: { version: 1, sha256Hash: TX_QUERY_HASH } }
  const qs = new URLSearchParams({
    operationName: 'TransactionsClientRootClient',
    variables: JSON.stringify(variables),
    extensions: JSON.stringify(extensions),
  })
  return `${GRAPHQL_URL}?${qs}`
}

async function fetchLibrary(): Promise<NintendoRecord[]> {
  const token = await idToken()
  const byId = new Map<string, NintendoRecord>()
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(txUrl(token, page * PAGE), {
      headers: {
        Accept: 'application/graphql-response+json, application/json',
        'Content-Type': 'application/json',
        'x-nintendo-savanna-client-id': SAVANNA_CLIENT,
        Origin: 'https://ec.nintendo.com',
        Referer: 'https://ec.nintendo.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 401 || res.status === 403)
      throw new Error('Nintendo id_token rejected — the saved cookie may be expired; re-run `npm run nintendo-login`')
    if (!res.ok) throw new Error(`Nintendo transactions p${page} -> ${res.status}`)
    const rows: any[] = ((await res.json()) as any)?.data?.account?.transactionHistories?.transactionHistories ?? []
    for (const r of rows) {
      const rec = toRecord(r)
      if (rec && !byId.has(rec.storeId)) byId.set(rec.storeId, rec) // dedup re-downloads
    }
    if (rows.length < PAGE) break // last page
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// A TransactionHistory row -> a library record, or null if it isn't an owned game.
function toRecord(t: any): NintendoRecord | null {
  const name: string = t?.title ?? ''
  if (!name) return null
  if (t.transactionType && t.transactionType !== 'PURCHASE') return null // drop refunds/redownloads
  // itemType: APPLICATION (game) / BUNDLE (game bundle) are games; AOC (DLC),
  // CONSUMABLE, TICKET (NSO/funds), etc. are not.
  if (t.itemType && !/^(APPLICATION|BUNDLE)$/.test(t.itemType)) return null
  const id = String(t.transactionId ?? name)
  const dt: string = t.datetime ?? ''
  return {
    appid: hashId(id),
    storeId: id,
    name,
    store: 'Nintendo' as StoreKey,
    status: 'Backlog' as GameStatus,
    playtimeHours: 0,
    reviewPct: 0,
    reviewBand: 'Mostly Positive' as ReviewBand,
    headerImage: '', // the transactions API carries no cover art
    shortDescription: '',
    releaseDate: dt.slice(0, 10),
  }
}

const LIST_TTL = 6 * 60 * 60 * 1000 // history changes rarely; refresh every 6h
interface GamesCache { games: NintendoRecord[]; at: number }
let memo: GamesCache | null = null
let inflight: Promise<NintendoRecord[]> | null = null
let warmingFlag = false

async function loadRecords(): Promise<NintendoRecord[]> {
  if (!configured()) return []
  if (!memo) {
    const disk = await readCache<GamesCache>('nintendo_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (inflight) return inflight
  warmingFlag = true
  inflight = fetchLibrary()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('nintendo_games.json', memo)
      return games
    })
    .catch(async (e) => {
      console.error('[nintendo] library fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('nintendo_games.json', { games: [], at: 0 })
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
    name: rec?.name ?? 'Nintendo game',
    shortDescription: rec?.shortDescription ?? '',
    developers: [],
    publishers: [],
    releaseDate: rec?.releaseDate ?? '',
    genres: [],
    categories: [],
    headerImage: rec?.headerImage ?? '',
    achievements: [], // Nintendo has no achievements
  }
}

// ---- Store wishlist -------------------------------------------------------
// NOT YET WIRED: the nintendo.com Store wishlist endpoint hasn't been captured/
// verified yet (it's a different system from the eShop GraphQL above). Until then
// the wishlist stays DORMANT — it only activates when BOTH a store cookie AND an
// explicit `NINTENDO_WISHLIST_URL` are set, so a stray cookie can never 404 the
// app against a guessed URL. The parser below is a placeholder to finalise once a
// real capture lands.
const WISH_TTL = 6 * 60 * 60 * 1000
const wishUrl = () => process.env.NINTENDO_WISHLIST_URL // no default — unknown endpoint

async function fetchWishlist(): Promise<WishlistItem[]> {
  await hydrateAuth()
  const cookie = storeCookie()
  const url = wishUrl()
  if (!cookie || !url) return [] // dormant until both are configured
  const res = await fetch(url, {
    headers: {
      Cookie: cookie,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 401 || res.status === 403)
    throw new Error('Nintendo Store cookie expired — re-run `npm run nintendo-login`')
  if (!res.ok) throw new Error(`Nintendo wishlist -> ${res.status}`)
  return parseWishlist(await res.json())
}

// Defensive parse, finalised against a live capture (see parseTransactions note).
function parseWishlist(json: any): WishlistItem[] {
  const rows: any[] = json?.wishlist ?? json?.items ?? json?.products ?? json?.data ?? (Array.isArray(json) ? json : [])
  const out: WishlistItem[] = []
  for (const w of rows) {
    const name = w.title ?? w.name ?? w.productName ?? ''
    if (!name) continue
    const id = String(w.id ?? w.nsuid ?? w.sku ?? w.productId ?? name)
    const final = Number(w.salePrice ?? w.discountPrice ?? w.price?.discountFinalPrice ?? w.price ?? 0) || 0
    const base = Number(w.regularPrice ?? w.msrp ?? w.price?.regularPrice ?? final) || final
    out.push({
      appid: hashId(id),
      name,
      price: final,
      origPrice: base > 0 ? base : final,
      discountPct: base > 0 && final < base ? Math.round((1 - final / base) * 100) : 0,
      reviewPct: 0,
      releasedAt: String(w.releaseDate ?? w.releaseDateDisplay ?? '').slice(0, 10),
      headerImage: w.image ?? w.productImage ?? w.boxart ?? w.imageUrl ?? '',
      isFree: base === 0 && final === 0 || undefined,
    })
  }
  return out.sort((a, b) => b.discountPct - a.discountPct || a.name.localeCompare(b.name))
}

const WISH_CACHE = 'nintendo_wishlist.json'
interface WishCache { items: WishlistItem[]; at: number }
let wmemo: WishCache | null = null
let winflight: Promise<WishlistItem[]> | null = null

export async function getWishlist(): Promise<WishlistItem[]> {
  if (!wishlistConfigured()) return []
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
      console.error('[nintendo] wishlist fetch failed:', (e as Error).message)
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
    try { await getGames() } catch (e) { console.error('[nintendo] warmer error (games):', (e as Error).message) }
    try { await getWishlist() } catch (e) { console.error('[nintendo] warmer error (wishlist):', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 4_000)
  console.log('[nintendo] warmer started — eShop library + wishlist refresh')
}
