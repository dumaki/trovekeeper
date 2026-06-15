import { useMemo, useState } from 'react'
import { storeMeta, type Game, type GameStatus, type StoreKey } from '../data/mockData'
import { useData } from '../data/DataContext'
import { allTags, tagKey, useTagMap } from '../data/tags'
import GameModal from './GameModal'

const STATUS_TONE: Record<GameStatus, string> = {
  Backlog: '#ef4444', Playing: '#f5c518', Finished: '#22c55e', Next: '#38bdf8', Skip: '#64748b',
}
const STATUS_OPTIONS: GameStatus[] = ['Backlog', 'Playing', 'Next', 'Finished', 'Skip']

const STORE_KEYS = Object.keys(storeMeta) as StoreKey[]
const STATUS_FILTERS: GameStatus[] = ['Playing', 'Next', 'Backlog', 'Finished', 'Skip']

// Toggle a value in/out of a set, returning a new set (immutable update).
function toggled<T>(set: Set<T>, v: T): Set<T> {
  const n = new Set(set)
  n.has(v) ? n.delete(v) : n.add(v)
  return n
}

export default function Library() {
  const { library, setGameStatus } = useData()
  const tagMap = useTagMap()
  const tags = useMemo(() => allTags(tagMap), [tagMap])
  // Multi-select filters: empty set = no filter (show all). Selected stores OR
  // together, statuses OR together, tags OR together; the groups AND together.
  const [storeSel, setStoreSel] = useState<Set<StoreKey>>(new Set())
  const [statusSel, setStatusSel] = useState<Set<GameStatus>>(new Set())
  const [tagSel, setTagSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Game | null>(null)

  const games = useMemo(() => library.filter((g) =>
    (storeSel.size === 0 || storeSel.has(g.store)) &&
    (statusSel.size === 0 || statusSel.has(g.status)) &&
    (tagSel.size === 0 || (tagMap[tagKey(g)] ?? []).some((t) => tagSel.has(t))) &&
    g.name.toLowerCase().includes(q.toLowerCase())
  ), [library, storeSel, statusSel, tagSel, tagMap, q])

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
          <button className={`chip ${storeSel.size === 0 ? 'on' : ''}`} onClick={() => setStoreSel(new Set())}>All</button>
          {STORE_KEYS.map((s) => (
            <button key={s} className={`chip ${storeSel.has(s) ? 'on' : ''}`}
              onClick={() => setStoreSel(toggled(storeSel, s))}>{storeMeta[s].label}</button>
          ))}
        </div>
        <div className="filter-group">
          <button className={`chip ${statusSel.size === 0 ? 'on' : ''}`} onClick={() => setStatusSel(new Set())}>All</button>
          {STATUS_FILTERS.map((s) => (
            <button key={s} className={`chip ${statusSel.has(s) ? 'on' : ''}`}
              onClick={() => setStatusSel(toggled(statusSel, s))}>{s}</button>
          ))}
        </div>
        {tags.length > 0 && (
          <div className="filter-group">
            <span className="filter-label">Tags</span>
            <button className={`chip ${tagSel.size === 0 ? 'on' : ''}`} onClick={() => setTagSel(new Set())}>All</button>
            {tags.map((t) => (
              <button key={t} className={`chip tag ${tagSel.has(t) ? 'on' : ''}`}
                onClick={() => setTagSel(toggled(tagSel, t))}>{t}</button>
            ))}
          </div>
        )}
      </div>

      <div className="game-grid">
        {games.map((g) => (
          <article key={`${g.store}-${g.storeId ?? g.appid}`} className="game-card" onClick={() => setSelected(g)}>
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
                onChange={(e) => setGameStatus(g.appid, e.target.value as GameStatus, g.store, g.storeId)}
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
