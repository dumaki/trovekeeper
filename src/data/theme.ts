// Color themes. The default ("midnight") is the base :root palette in index.css;
// the others override CSS variables via a `[data-theme]` attribute on <html>.
// Choice is persisted and applied on module load so there's no flash on refresh.
import { useSyncExternalStore } from 'react'

export interface ThemeDef { id: string; label: string; swatch: string }

export const THEMES: ThemeDef[] = [
  { id: 'midnight', label: 'Midnight Blue', swatch: '#5ab0e8' },
  { id: 'ember', label: 'Ember', swatch: '#f5963f' },
  { id: 'forest', label: 'Forest', swatch: '#3fbf7f' },
  { id: 'synthwave', label: 'Synthwave', swatch: '#c46bf0' },
]

const KEY = 'tk_theme'
let current = load()

function load(): string {
  let saved: string | null = null
  try { saved = localStorage.getItem(KEY) } catch { /* ignore */ }
  return saved && THEMES.some((t) => t.id === saved) ? saved : 'midnight'
}

function apply(id: string) {
  const el = document.documentElement
  if (id === 'midnight') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', id)
}

apply(current) // run immediately on import, before first paint

const listeners = new Set<() => void>()

export function setTheme(id: string) {
  current = id
  try { localStorage.setItem(KEY, id) } catch { /* ignore */ }
  apply(id)
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }

export function useTheme(): string {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
