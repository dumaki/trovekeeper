import { useState } from 'react'
import Dashboard from './components/Dashboard'
import Library from './components/Library'
import Wishlist from './components/Wishlist'
import ChestIcon from './components/ChestIcon'
import { useData } from './data/DataContext'

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
  const { source, dashboard } = useData()
  const badge = SOURCE_LABEL[source]

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><ChestIcon size={22} /></span>
          <span className="brand-name">TroveKeeper</span>
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
        <div className={`source-badge ${badge.cls}`}>
          <span className="source-dot" />
          {badge.text}
        </div>
        <div className="profile-card">
          <span className="avatar">{dashboard.profile.personaName[0]}</span>
          <div>
            <div className="profile-name">{dashboard.profile.personaName}</div>
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
