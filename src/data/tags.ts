// User-assigned custom tags, persisted to localStorage. Genres/categories only
// exist for Steam games (and aren't cached), so this gives a unified, manual
// tagging system that works across all 9 stores. Keyed the same way as play
// statuses: `${store}:${storeId ?? appid}`.
import { useSyncExternalStore } from 'react'
import type { Game } from './mockData'

const KEY = 'tk_tags'
export type TagMap = Record<string, string[]>

let map: TagMap = load()
const listeners = new Set<() => void>()

function load(): TagMap {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* quota — keep in-memory */ }
  listeners.forEach((l) => l())
}

export function tagKey(g: Pick<Game, 'store' | 'appid' | 'storeId'>): string {
  return `${g.store}:${g.storeId ?? g.appid}`
}

export function addTag(key: string, tag: string) {
  const t = tag.trim()
  if (!t) return
  const cur = map[key] ?? []
  if (cur.some((x) => x.toLowerCase() === t.toLowerCase())) return
  map = { ...map, [key]: [...cur, t] }
  persist()
}

export function removeTag(key: string, tag: string) {
  const cur = map[key]
  if (!cur) return
  const next = cur.filter((x) => x !== tag)
  map = { ...map }
  if (next.length) map[key] = next
  else delete map[key]
  persist()
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }

// The whole tag map, reactive. Components derive per-game tags / the tag union.
export function useTagMap(): TagMap {
  return useSyncExternalStore(subscribe, () => map, () => map)
}

// Sorted union of every tag in use — drives the Library filter row.
export function allTags(m: TagMap): string[] {
  const set = new Set<string>()
  for (const list of Object.values(m)) for (const t of list) set.add(t)
  return [...set].sort((a, b) => a.localeCompare(b))
}
