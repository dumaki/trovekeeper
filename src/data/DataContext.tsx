import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as mock from './mockData'
import type {
  Game, WishlistItem, GameStatus, StoreKey,
} from './mockData'

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
}

const Ctx = createContext<DataState>({ ...MOCK, source: 'loading' })
export const useData = () => useContext(Ctx)

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataState>({ ...MOCK, source: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [dash, lib, wish] = await Promise.all([
          getJson<Dashboard & { source: string }>('/api/dashboard'),
          getJson<{ source: string; games: Game[] }>('/api/library'),
          getJson<{ source: string; items: WishlistItem[]; total: number; pending: number }>('/api/wishlist'),
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
        })
      } catch {
        // Backend unreachable (e.g. running `vite` alone) — use bundled mock.
        if (!cancelled) setState(MOCK)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
