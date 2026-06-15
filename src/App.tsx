import { useEffect, useRef, useState } from 'react'
import Dashboard from './components/Dashboard'
import Library from './components/Library'
import Wishlist from './components/Wishlist'
import ChestIcon from './components/ChestIcon'
import { useData } from './data/DataContext'
import { THEMES, setTheme, useTheme } from './data/theme'

type Tab = 'dashboard' | 'library' | 'wishlist'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '◆' },
  { key: 'library', label: 'Library', icon: '▦' },
  { key: 'wishlist', label: 'Wishlist', icon: '★' },
]

const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  loading: { text: 'Loading…', cls: 'loading' },
  live: { text: 'Live Steam data', cls: 'live' },
  mock: { text: 'Sample data', cls: 'mock' },
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const { source, dashboard, library } = useData()
  const badge = SOURCE_LABEL[source]

  // The "Live Steam data" pill only earns its place when Steam is your sole
  // connected store — that's the case where it's reassuring to know you've
  // moved off the bundled sample data. With multiple stores merged it'd be
  // misleading (it isn't only Steam) and redundant, so we hide it. The
  // loading/sample states always show.
  const storeCount = new Set(library.map((g) => g.store)).size
  const showBadge = source !== 'live' || storeCount <= 1

  // Avatar: prefer a user-picked custom image (persisted), else the Steam
  // profile picture, else fall back to the persona initial.
  const fileInput = useRef<HTMLInputElement>(null)
  const [customAvatar, setCustomAvatar] = useState<string | null>(
    () => localStorage.getItem('tk_avatar'),
  )
  const avatarSrc = customAvatar || dashboard.profile.avatar
  const persona = dashboard.profile.personaName

  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      setCustomAvatar(url)
      try { localStorage.setItem('tk_avatar', url) } catch { /* quota — keep in-memory */ }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><ChestIcon size={22} /></span>
          <span className="brand-text">
            <span className="brand-name">TroveKeeper</span>
            <span className="brand-tagline">Every library. One trove.</span>
          </span>
        </div>
        <nav className="nav">
          {TABS.map((t) => (
            <button key={t.key} className={`nav-item ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}>
              <span className="nav-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ThemeSwitcher />
          {showBadge && (
            <div className={`source-badge ${badge.cls}`}>
              <span className="source-dot" />
              {badge.text}
            </div>
          )}
          <div className="profile-card">
            <button type="button" className="avatar" onClick={() => fileInput.current?.click()}
              title="Change profile picture">
              {avatarSrc
                ? <img src={avatarSrc} alt={persona} />
                : <span>{persona[0]}</span>}
              <span className="avatar-edit">Edit</span>
            </button>
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={onPickAvatar} />
            <div className="profile-name">{persona}</div>
            <div className="profile-sub">{dashboard.profile.totalGames.toLocaleString()} games</div>
          </div>
        </div>
      </aside>

      <main className="content">
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'library' && <Library />}
        {tab === 'wishlist' && <Wishlist />}
      </main>
    </div>
  )
}

// Compact theme picker pinned in the sidebar footer. Click to expand a popover
// of color presets; selection applies instantly and persists.
function ThemeSwitcher() {
  const active = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cur = THEMES.find((t) => t.id === active) ?? THEMES[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="theme-switch" ref={ref}>
      {open && (
        <div className="theme-menu" role="listbox">
          {THEMES.map((t) => (
            <button key={t.id} role="option" aria-selected={t.id === active}
              className={`theme-option ${t.id === active ? 'on' : ''}`}
              onClick={() => { setTheme(t.id); setOpen(false) }}>
              <span className="theme-swatch" style={{ background: t.swatch }} />
              {t.label}
              {t.id === active && <span className="theme-check">✓</span>}
            </button>
          ))}
        </div>
      )}
      <button className="theme-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="theme-swatch" style={{ background: cur.swatch }} />
        <span className="theme-trigger-label">{cur.label}</span>
        <span className="theme-caret">▾</span>
      </button>
    </div>
  )
}
