import { useMemo, useState } from 'react'
import { storeMeta, type Game, type GameStatus, type StoreKey } from '../data/mockData'
import { useData } from '../data/DataContext'
import GameModal from './GameModal'

const STATUS_TONE: Record<GameStatus, string> = {
  Backlog: '#ef4444', Playing: '#f5c518', Finished: '#22c55e', Next: '#38bdf8', Skip: '#64748b',
}
const STATUS_OPTIONS: GameStatus[] = ['Backlog', 'Playing', 'Next', 'Finished', 'Skip']

const stores = ['All', ...Object.keys(storeMeta)] as (StoreKey | 'All')[]
const statuses: (GameStatus | 'All')[] = ['All', 'Playing', 'Next', 'Backlog', 'Finished', 'Skip']

export default function Library() {
  const { library, setGameStatus } = useData()
  const [store, setStore] = useState<StoreKey | 'All'>('All')
  const [status, setStatus] = useState<GameStatus | 'All'>('All')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Game | null>(null)

  const games = useMemo(() => library.filter((g) =>
    (store === 'All' || g.store === store) &&
    (status === 'All' || g.status === status) &&
    g.name.toLowerCase().includes(q.toLowerCase())
  ), [library, store, status, q])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <p className="page-sub">{games.length} of {library.length} games shown</p>
        </div>
        <input className="search" placeholder="Search games…" value={q}
          onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="filter-bar">
        <div className="filter-group">
          {stores.map((s) => (
            <button key={s} className={`chip ${store === s ? 'on' : ''}`} onClick={() => setStore(s)}>{s}</button>
          ))}
        </div>
        <div className="filter-group">
          {statuses.map((s) => (
            <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="game-grid">
        {games.map((g) => (
          <article key={g.appid} className="game-card" onClick={() => setSelected(g)}>
            <div className="cover">
              <img src={g.headerImage} alt={g.name} loading="lazy"
                onError={(e) => { (e.currentTarget.style.visibility = 'hidden') }} />
              {/* status badge doubles as the editor — change it to re-tag the game.
                  stopPropagation so changing status doesn't open the detail card. */}
              <select
                className="status-badge status-select"
                value={g.status}
                style={{ background: STATUS_TONE[g.status] }}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setGameStatus(g.appid, e.target.value as GameStatus)}
                aria-label={`Status for ${g.name}`}
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="game-meta">
              <h3 title={g.name}>{g.name}</h3>
              <div className="game-row">
                <span className="store-tag" style={{ background: storeMeta[g.store].color }}>
                  {storeMeta[g.store].label}
                </span>
                <span className="review-tag">{g.reviewPct > 0 ? `${g.reviewPct}%` : '—'}</span>
              </div>
              <div className="playtime">{g.playtimeHours > 0 ? `${g.playtimeHours}h played` : 'Unplayed'}</div>
              {!!g.achTotal && (
                <div className="ach-row" title={`${g.achUnlocked}/${g.achTotal} achievements`}>
                  <div className="ach-bar">
                    <div className="ach-fill"
                      style={{ width: `${Math.round((g.achUnlocked! / g.achTotal) * 100)}%` }} />
                  </div>
                  <span className="ach-text">
                    🏆 {g.achUnlocked}/{g.achTotal}
                  </span>
                </div>
              )}
            </div>
          </article>
        ))}
        {games.length === 0 && <p className="empty">No games match these filters.</p>}
      </div>

      {selected && <GameModal game={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
