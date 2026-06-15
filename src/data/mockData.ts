// Mock data layer. Shapes mirror what a real Steam Web API integration would
// produce so the UI can be wired to live data later without changes:
//   - library  -> ISteamUser/GetOwnedGames (appid, name, playtime, img)
//   - profile  -> ISteamUser/GetPlayerSummaries
//   - wishlist -> store.steampowered.com/wishlist (unofficial)
// Multi-store fields (GOG/Epic/etc.) are included to match the target design;
// a Steam-only build would just leave those buckets empty.

export type StoreKey =
  | 'Steam' | 'GOG' | 'Epic' | 'PSN' | 'Xbox' | 'Nintendo' | 'Ubisoft' | 'Amazon' | 'itch.io'

export type GameStatus = 'Backlog' | 'Playing' | 'Finished' | 'Next' | 'Skip'

export type ReviewBand =
  | 'Overwhelmingly Positive' | 'Very Positive' | 'Mostly Positive' | 'Mixed'

export interface Game {
  appid: number
  storeId?: string       // store-native id for stores whose ids aren't numeric (e.g. Epic catalogItemId)
  name: string
  store: StoreKey
  status: GameStatus
  playtimeHours: number
  reviewPct: number      // 0-100 store review score
  reviewBand: ReviewBand
  headerImage: string    // cover/header art
  achUnlocked?: number   // Steam achievements unlocked (undefined = not yet fetched)
  achTotal?: number      // total achievements (0 = game has none)
  ttbHours?: number      // IGDB main-story time-to-beat, hours (undefined = unknown)
  lastPlayed?: number    // unix seconds of last session (0/undefined = never)
}

export interface WishlistItem {
  appid: number
  name: string
  price: number          // current price in USD
  origPrice: number      // pre-discount price
  discountPct: number    // 0 = no deal
  reviewPct: number
  releasedAt: string
  headerImage: string
  isFree?: boolean       // genuinely free-to-play (vs. unreleased/unpriced)
}

// ---- Steam CDN header art (real appids -> stable image URLs) -------------
const hdr = (appid: number) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`

export const profile = {
  personaName: 'Aenwyn',
  avatar: '', // UI renders an initial-based avatar; no external image needed
  totalGames: 2984,
  storesConnected: 7,
  storesTotal: 9,
  playedHours: 412,
  backlogHours: 2847,
  avgReviewPct: 78,
  completePct: 12,
  yearsToClear: 3.9,
  dealsLive: 14,
  itchBundleKeys: 1044,
  steamGames: 257,
}

// Trending hero rotation (the "TRENDING NOW" card + background carousel).
export const trending = [
  { name: 'Dawnbanner', reviewPct: 94, mainHours: 38, status: 'in backlog' },
  { name: 'Hollow Sovereign', reviewPct: 91, mainHours: 26, status: 'wishlisted' },
  { name: 'Ashen Vale', reviewPct: 88, mainHours: 44, status: 'in backlog' },
]

// ---- Aggregate breakdowns (the three donut charts) -----------------------
export const libraryByStore: { key: StoreKey; value: number; color: string }[] = [
  { key: 'Steam', value: 40, color: '#5ab0e8' },
  { key: 'GOG', value: 22, color: '#7b3ff2' },
  { key: 'Epic', value: 13, color: '#c9d1da' },
  { key: 'PSN', value: 12, color: '#2f6bd8' },
  { key: 'Xbox', value: 7, color: '#16a34a' },
  { key: 'Amazon', value: 4, color: '#f59e0b' },
  { key: 'itch.io', value: 2, color: '#fa5c5c' },
]

export const statusBreakdown: { key: GameStatus; value: number; color: string }[] = [
  { key: 'Backlog', value: 57, color: '#ef4444' },
  { key: 'Playing', value: 16, color: '#f5c518' },
  { key: 'Finished', value: 12, color: '#22c55e' },
  { key: 'Next', value: 10, color: '#38bdf8' },
  { key: 'Skip', value: 5, color: '#64748b' },
]

export const reviewSentiment: { key: ReviewBand; value: number; color: string }[] = [
  { key: 'Overwhelmingly Positive', value: 28, color: '#15803d' },
  { key: 'Very Positive', value: 41, color: '#22c55e' },
  { key: 'Mostly Positive', value: 23, color: '#86efac' },
  { key: 'Mixed', value: 8, color: '#f5c518' },
]

// ---- Store presentation metadata ----------------------------------------
export const storeMeta: Record<StoreKey, { label: string; color: string; glyph: string }> = {
  Steam:    { label: 'Steam',   color: '#1b2838', glyph: 'S' },
  GOG:      { label: 'GOG',     color: '#7b3ff2', glyph: 'G' },
  Epic:     { label: 'Epic',    color: '#2a2a2a', glyph: 'E' },
  PSN:      { label: 'PSN',     color: '#0070d1', glyph: 'P' },
  Xbox:     { label: 'Xbox',    color: '#107c10', glyph: 'X' },
  Nintendo: { label: 'Nintendo',color: '#e60012', glyph: 'N' },
  Ubisoft:  { label: 'Ubisoft', color: '#1a8fe3', glyph: 'U' },
  Amazon:   { label: 'Amazon',  color: '#ff9900', glyph: 'A' },
  'itch.io':{ label: 'itch.io', color: '#fa5c5c', glyph: 'i' },
}

// ---- Library ------------------------------------------------------------
export const library: Game[] = [
  { appid: 1086940, name: "Baldur's Gate 3",        store: 'Steam',  status: 'Playing',  playtimeHours: 137, reviewPct: 96, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(1086940) },
  { appid: 1245620, name: 'Elden Ring',             store: 'Steam',  status: 'Finished', playtimeHours: 92,  reviewPct: 93, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(1245620) },
  { appid: 1174180, name: 'Red Dead Redemption 2',  store: 'Epic',   status: 'Backlog',  playtimeHours: 14,  reviewPct: 92, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(1174180) },
  { appid: 292030,  name: 'The Witcher 3',          store: 'GOG',    status: 'Finished', playtimeHours: 168, reviewPct: 95, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(292030) },
  { appid: 1091500, name: 'Cyberpunk 2077',         store: 'GOG',    status: 'Playing',  playtimeHours: 61,  reviewPct: 81, reviewBand: 'Very Positive',           headerImage: hdr(1091500) },
  { appid: 271590,  name: 'GTA V',                  store: 'Steam',  status: 'Backlog',  playtimeHours: 8,   reviewPct: 86, reviewBand: 'Very Positive',           headerImage: hdr(271590) },
  { appid: 367520,  name: 'Hollow Knight',          store: 'Steam',  status: 'Next',     playtimeHours: 0,   reviewPct: 97, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(367520) },
  { appid: 1145360, name: 'Hades',                  store: 'Steam',  status: 'Finished', playtimeHours: 54,  reviewPct: 98, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(1145360) },
  { appid: 413150,  name: 'Stardew Valley',         store: 'GOG',    status: 'Playing',  playtimeHours: 211, reviewPct: 98, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(413150) },
  { appid: 268910,  name: 'Cuphead',                store: 'Xbox',   status: 'Backlog',  playtimeHours: 3,   reviewPct: 95, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(268910) },
  { appid: 1593500, name: 'God of War',             store: 'PSN',    status: 'Next',     playtimeHours: 0,   reviewPct: 94, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(1593500) },
  { appid: 990080,  name: 'Hogwarts Legacy',        store: 'PSN',    status: 'Backlog',  playtimeHours: 22,  reviewPct: 79, reviewBand: 'Very Positive',           headerImage: hdr(990080) },
  { appid: 1888930, name: 'The Last of Us Part I',  store: 'PSN',    status: 'Skip',     playtimeHours: 0,   reviewPct: 62, reviewBand: 'Mixed',                   headerImage: hdr(1888930) },
  { appid: 552520,  name: 'Far Cry 5',              store: 'Amazon', status: 'Backlog',  playtimeHours: 17,  reviewPct: 77, reviewBand: 'Very Positive',           headerImage: hdr(552520) },
  { appid: 632360,  name: 'Risk of Rain 2',         store: 'Steam',  status: 'Playing',  playtimeHours: 73,  reviewPct: 96, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(632360) },
  { appid: 1817070, name: "Marvel's Spider-Man",    store: 'Steam',  status: 'Finished', playtimeHours: 31,  reviewPct: 95, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(1817070) },
  { appid: 105600,  name: 'Terraria',               store: 'Steam',  status: 'Backlog',  playtimeHours: 44,  reviewPct: 97, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(105600) },
  { appid: 374320,  name: 'DARK SOULS III',         store: 'Steam',  status: 'Next',     playtimeHours: 0,   reviewPct: 93, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(374320) },
  { appid: 252490,  name: 'Rust',                   store: 'Steam',  status: 'Skip',     playtimeHours: 5,   reviewPct: 87, reviewBand: 'Very Positive',           headerImage: hdr(252490) },
  { appid: 322170,  name: 'Geometry Dash',          store: 'itch.io',status: 'Backlog',  playtimeHours: 12,  reviewPct: 96, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(322170) },
  { appid: 588650,  name: 'Dead Cells',             store: 'GOG',    status: 'Playing',  playtimeHours: 38,  reviewPct: 95, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(588650) },
  { appid: 814380,  name: 'Sekiro',                 store: 'Steam',  status: 'Finished', playtimeHours: 47,  reviewPct: 94, reviewBand: 'Overwhelmingly Positive', headerImage: hdr(814380) },
  { appid: 1313140, name: 'Mortal Kombat 11',       store: 'Epic',   status: 'Backlog',  playtimeHours: 9,   reviewPct: 71, reviewBand: 'Mostly Positive',         headerImage: hdr(1313140) },
  { appid: 230410,  name: 'Warframe',               store: 'Epic',   status: 'Skip',     playtimeHours: 28,  reviewPct: 89, reviewBand: 'Very Positive',           headerImage: hdr(230410) },
]

// ---- Wishlist -----------------------------------------------------------
export const wishlist: WishlistItem[] = [
  { appid: 1142710, name: 'Total War: WARHAMMER III', price: 29.99, origPrice: 59.99, discountPct: 50, reviewPct: 78, releasedAt: '2022-02-17', headerImage: hdr(1142710) },
  { appid: 1623730, name: 'Palworld',                 price: 23.99, origPrice: 29.99, discountPct: 20, reviewPct: 92, releasedAt: '2024-01-19', headerImage: hdr(1623730) },
  { appid: 2050650, name: 'Resident Evil 4',          price: 19.99, origPrice: 59.99, discountPct: 67, reviewPct: 96, releasedAt: '2023-03-24', headerImage: hdr(2050650) },
  { appid: 1716740, name: 'Starfield',                price: 41.99, origPrice: 69.99, discountPct: 40, reviewPct: 65, releasedAt: '2023-09-06', headerImage: hdr(1716740) },
  { appid: 2138710, name: 'Sons Of The Forest',       price: 19.99, origPrice: 29.99, discountPct: 33, reviewPct: 88, releasedAt: '2024-02-22', headerImage: hdr(2138710) },
  { appid: 1903340, name: 'Lies of P',                price: 0,     origPrice: 59.99, discountPct: 0,  reviewPct: 92, releasedAt: '2023-09-19', headerImage: hdr(1903340) },
  { appid: 1817190, name: 'Marvel Midnight Suns',     price: 14.99, origPrice: 59.99, discountPct: 75, reviewPct: 86, releasedAt: '2022-12-02', headerImage: hdr(1817190) },
  { appid: 2161700, name: 'Persona 3 Reload',         price: 0,     origPrice: 69.99, discountPct: 0,  reviewPct: 94, releasedAt: '2024-02-02', headerImage: hdr(2161700) },
  { appid: 1144200, name: 'Ready or Not',             price: 35.99, origPrice: 39.99, discountPct: 10, reviewPct: 90, releasedAt: '2023-12-13', headerImage: hdr(1144200) },
  { appid: 1426210, name: 'It Takes Two',             price: 15.99, origPrice: 39.99, discountPct: 60, reviewPct: 95, releasedAt: '2021-03-26', headerImage: hdr(1426210) },
]

// ---- GOG wishlist (separate tab) ----------------------------------------
export const gogWishlist: WishlistItem[] = [
  { appid: 1207659110, name: 'Disco Elysium',          price: 9.99,  origPrice: 39.99, discountPct: 75, reviewPct: 0, releasedAt: '2019-10-15', headerImage: hdr(632470) },
  { appid: 1452598624, name: 'Cyberpunk 2077: Phantom Liberty', price: 24.99, origPrice: 29.99, discountPct: 17, reviewPct: 0, releasedAt: '2023-09-26', headerImage: hdr(2138330) },
  { appid: 1207666393, name: 'Gwent: The Witcher Card Game', price: 0, origPrice: 0, discountPct: 0, reviewPct: 0, releasedAt: '2018-10-23', headerImage: hdr(1284410) },
  { appid: 1895572983, name: 'Sea of Stars',           price: 27.99, origPrice: 34.99, discountPct: 20, reviewPct: 0, releasedAt: '2023-08-29', headerImage: hdr(1244090) },
]

// ---- Epic wishlist (separate tab) ---------------------------------------
export const epicWishlist: WishlistItem[] = [
  { appid: 2100000101, name: 'Alan Wake 2',            price: 29.99, origPrice: 49.99, discountPct: 40, reviewPct: 0, releasedAt: '2023-10-27', headerImage: hdr(2255150) },
  { appid: 2100000102, name: 'Kingdom Come: Deliverance II', price: 49.99, origPrice: 59.99, discountPct: 17, reviewPct: 0, releasedAt: '2025-02-04', headerImage: hdr(1771300) },
  { appid: 2100000103, name: 'Hades II',               price: 0, origPrice: 0, discountPct: 0, reviewPct: 0, releasedAt: '2024-05-06', headerImage: hdr(1145350) },
]
