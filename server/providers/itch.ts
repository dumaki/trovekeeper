// itch.io provider. The simplest auth of any store: a personal API KEY the user
// generates at https://itch.io/user/settings/api-keys and pastes via
// `npm run itch-login`. The key is long-lived (revocable), so there's no OAuth
// dance and no token refresh — every request is just `Authorization: Bearer KEY`.
//
// What itch exposes vs. Steam: the user's OWNED games (download keys) with cover
// art, title, short description, store URL, and purchase date — via the
// documented serverside API. No playtime, no achievements, no review %. Games
// default to "Backlog". itch has no standard wishlist surface, so there's no
// getWishlist here.
import type { Game, GameStatus, ReviewBand, StoreKey } from '../../src/data/mockData'
import type { GameDetail } from './steam'
import { readCache, writeCache } from '../cache'

const API = 'https://api.itch.io'

export const configured = () => Boolean(apiKey())
const apiKey = () => process.env.ITCH_API_KEY || undefined

const authHeaders = () => ({
  Authorization: `Bearer ${apiKey()}`,
  Accept: 'application/json',
  'User-Agent': 'TroveKeeper/0.1 (+https://github.com/dumaki/trovekeeper)',
})

// itch game ids are numeric, but to avoid colliding with Steam appids we hash
// them into a distinct high range (like Epic/Xbox/Nintendo) and carry the real
// id in storeId.
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_000_007
  return 2_700_000_000 + h
}

interface ItchRecord extends Game {
  storeId: string
  shortDescription: string
  developer: string
  releaseDate: string
}

// Keep only games. itch `classification` is one of game/tool/assets/game_mod/
// soundtrack/comic/book/physical_game/other — we surface plain games (and keep
// anything whose classification is missing rather than silently dropping it).
function isGame(g: any): boolean {
  const c = String(g?.classification ?? '').toLowerCase()
  return c === '' || c === 'game'
}

async function fetchPage(page: number): Promise<any[]> {
  const res = await fetch(`${API}/profile/owned-keys?page=${page}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.status === 401 || res.status === 403)
    throw new Error('itch.io API key rejected — generate a new one at itch.io/user/settings/api-keys and re-run `npm run itch-login`')
  if (!res.ok) throw new Error(`itch owned-keys p${page} -> ${res.status}`)
  const j = (await res.json()) as any
  return j?.owned_keys ?? j?.owned_games ?? []
}

async function fetchLibrary(): Promise<ItchRecord[]> {
  if (!apiKey()) throw new Error('itch.io not authenticated — run `npm run itch-login`')
  const byId = new Map<string, ItchRecord>()
  // owned-keys is paginated (per_page 50); page until a short/empty page.
  for (let page = 1; page <= 100; page++) {
    const keys = await fetchPage(page)
    for (const k of keys) {
      const g = k?.game ?? k // some shapes nest the game, some don't
      if (!g || !isGame(g)) continue
      const id = String(g.id ?? k.game_id ?? g.title ?? '')
      if (!id || byId.has(id)) continue
      const created = String(k.created_at ?? g.published_at ?? g.created_at ?? '')
      byId.set(id, {
        appid: hashId(id),
        storeId: id,
        name: g.title ?? 'itch.io game',
        store: 'itch.io' as StoreKey,
        status: 'Backlog' as GameStatus,
        playtimeHours: 0,
        reviewPct: 0,
        reviewBand: 'Mostly Positive' as ReviewBand,
        headerImage: g.cover_url ?? g.still_cover_url ?? '',
        shortDescription: g.short_text ?? '',
        developer: g.user?.display_name ?? g.user?.username ?? '',
        releaseDate: created.slice(0, 10),
      })
    }
    if (keys.length < 50) break // last page
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const LIST_TTL = 6 * 60 * 60 * 1000 // owned library changes rarely
interface GamesCache { games: ItchRecord[]; at: number }
let memo: GamesCache | null = null
let inflight: Promise<ItchRecord[]> | null = null
let warmingFlag = false

async function loadRecords(): Promise<ItchRecord[]> {
  if (!configured()) return []
  if (!memo) {
    const disk = await readCache<GamesCache>('itch_games.json', { games: [], at: 0 })
    if (disk.at) memo = disk
  }
  if (memo && Date.now() - memo.at < LIST_TTL) return memo.games
  if (inflight) return inflight
  warmingFlag = true
  inflight = fetchLibrary()
    .then(async (games) => {
      memo = { games, at: Date.now() }
      await writeCache('itch_games.json', memo)
      return games
    })
    .catch(async (e) => {
      console.error('[itch] library fetch failed:', (e as Error).message)
      if (memo) return memo.games
      const disk = await readCache<GamesCache>('itch_games.json', { games: [], at: 0 })
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
    name: rec?.name ?? 'itch.io game',
    shortDescription: rec?.shortDescription ?? '',
    developers: rec?.developer ? [rec.developer] : [],
    publishers: [],
    releaseDate: rec?.releaseDate ?? '',
    genres: [],
    categories: [],
    headerImage: rec?.headerImage ?? '',
    achievements: [], // itch has no achievements
  }
}

// ---- Background warmer ----------------------------------------------------
let warmerStarted = false
export function startWarmer(): void {
  if (warmerStarted || !configured()) return
  warmerStarted = true
  const tick = async () => {
    try { await getGames() } catch (e) { console.error('[itch] warmer error:', (e as Error).message) }
    setTimeout(tick, LIST_TTL)
  }
  setTimeout(tick, 4_500)
  console.log('[itch] warmer started — owned library refresh')
}
