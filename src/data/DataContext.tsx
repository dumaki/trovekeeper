import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import * as mock from './mockData'
import type {
  Game, WishlistItem, GameStatus, StoreKey,
} from './mockData'
import LoadingScreen from '../components/LoadingScreen'

type Slice<K extends string> = { key: K; value: number; color: string }

interface Dashboard {
  profile: typeof mock.profile
  trending: typeof mock.trending
  libraryByStore: Slice<StoreKey>[]
  statusBreakdown: Slice<GameStatus>[] | null
  // keyed by Steam's review descriptor (e.g. "Very Positive") in live mode
  reviewSentiment: Slice<string>[] | null
}

export type DataSource = 'loading' | 'live' | 'mock'

interface DataState {
  source: DataSource
  dashboard: Dashboard
  library: Game[]
  wishlist: WishlistItem[]
  wishlistTotal: number   // full wishlist size (may exceed loaded items while caching)
  wishlistPending: number // items not yet enriched this session
  gogWishlist: WishlistItem[] // GOG wishlist (separate tab)
  epicWishlist: WishlistItem[] // Epic wishlist (separate tab)
  nintendoWishlist: WishlistItem[] // Nintendo Store wishlist (separate tab)
}

const MOCK: DataState = {
  source: 'mock',
  dashboard: {
    profile: mock.profile,
    trending: mock.trending,
    libraryByStore: mock.libraryByStore,
    statusBreakdown: mock.statusBreakdown,
    reviewSentiment: mock.reviewSentiment,
  },
  library: mock.library,
  wishlist: mock.wishlist,
  wishlistTotal: mock.wishlist.length,
  wishlistPending: 0,
  gogWishlist: mock.gogWishlist,
  epicWishlist: mock.epicWishlist,
  nintendoWishlist: [],
}

interface DataContextValue extends DataState {
  setGameStatus: (appid: number, status: GameStatus, store: StoreKey, storeId?: string) => void
}

const Ctx = createContext<DataContextValue>({ ...MOCK, source: 'loading', setGameStatus: () => {} })
export const useData = () => useContext(Ctx)

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

export function DataProvider({ children }: { children: ReactNode }) {
  // null until the first fetch settles — we render a neutral loader rather than
  // bundled mock, so stale numbers never flash before live data arrives.
  const [state, setState] = useState<DataState | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [dash, lib, wish] = await Promise.all([
          getJson<Dashboard & { source: string }>('/api/dashboard'),
          getJson<{ source: string; games: Game[] }>('/api/library'),
          getJson<{ source: string; items: WishlistItem[]; total: number; pending: number; gog?: WishlistItem[]; epic?: WishlistItem[]; nintendo?: WishlistItem[] }>('/api/wishlist'),
        ])
        if (cancelled) return
        setState({
          source: dash.source === 'live' ? 'live' : 'mock',
          dashboard: {
            profile: dash.profile,
            trending: dash.trending,
            libraryByStore: dash.libraryByStore,
            statusBreakdown: dash.statusBreakdown,
            reviewSentiment: dash.reviewSentiment,
          },
          library: lib.games,
          wishlist: wish.items,
          wishlistTotal: wish.total ?? wish.items.length,
          wishlistPending: wish.pending ?? 0,
          gogWishlist: wish.gog ?? [],
          epicWishlist: wish.epic ?? [],
          nintendoWishlist: wish.nintendo ?? [],
        })
      } catch {
        // Backend unreachable (e.g. running `vite` alone) — use bundled mock.
        if (!cancelled) setState(MOCK)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Optimistically update the game's status locally (so the dashboard donut +
  // counts react instantly) and persist it server-side.
  const setGameStatus = useCallback((appid: number, status: GameStatus, store: StoreKey, storeId?: string) => {
    // Match within a store by storeId when present (the stable store-native id),
    // else by the numeric appid.
    setState((prev) => prev
      ? { ...prev, library: prev.library.map((g) =>
          g.store === store && (storeId ? g.storeId === storeId : g.appid === appid) ? { ...g, status } : g) }
      : prev)
    fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid, status, store, storeId }),
    }).catch(() => { /* offline/no-backend: keep the optimistic local change */ })
  }, [])

  if (!state) return <LoadingScreen />
  return <Ctx.Provider value={{ ...state, setGameStatus }}>{children}</Ctx.Provider>
}
