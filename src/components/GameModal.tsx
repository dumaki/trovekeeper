import { useEffect, useMemo, useState } from 'react'
import type { Game } from '../data/mockData'

interface AchievementDetail {
  apiname: string
  name: string
  description: string
  hidden: boolean
  icon: string
  iconGray: string
  achieved: boolean
  unlockedAt: number | null
}
interface GameDetail {
  appid: number
  name: string
  shortDescription: string
  developers: string[]
  publishers: string[]
  releaseDate: string
  genres: string[]
  categories: string[]
  headerImage: string
  achievements: AchievementDetail[]
}

function fmtDate(unix?: number | null): string {
  if (!unix) return 'Never'
  return new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Click a Library card to open this — shows store info + a scrollable, locked/
// unlocked achievement list. Header art renders instantly; the rest loads from
// /api/game/:appid.
export default function GameModal({ game, onClose }: { game: Game; onClose: () => void }) {
  const [detail, setDetail] = useState<GameDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/game/${game.appid}?store=${encodeURIComponent(game.store)}${game.storeId ? `&id=${encodeURIComponent(game.storeId)}` : ''}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setDetail(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [game.appid, game.store, game.storeId])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Unlocked first (most recent), then locked.
  const achievements = useMemo(() => {
    if (!detail?.achievements) return []
    return [...detail.achievements].sort(
      (a, b) => Number(b.achieved) - Number(a.achieved) || (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0),
    )
  }, [detail])
  const unlocked = achievements.filter((a) => a.achieved).length

  const tags = [...(detail?.genres ?? []), ...(detail?.categories ?? [])]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-hero" style={{ backgroundImage: `url(${game.headerImage})` }} />
        <div className="modal-body">
          <h2 className="modal-title">{detail?.name ?? game.name}</h2>

          <div className="modal-meta">
            {!!detail?.developers?.length && <span><b>Developer</b> {detail.developers.join(', ')}</span>}
            {!!detail?.publishers?.length && <span><b>Publisher</b> {detail.publishers.join(', ')}</span>}
            {!!detail?.releaseDate && <span><b>Released</b> {detail.releaseDate}</span>}
            <span><b>Playtime</b> {game.playtimeHours > 0 ? `${game.playtimeHours}h` : 'Unplayed'}</span>
            <span><b>Last played</b> {fmtDate(game.lastPlayed)}</span>
            <span><b>Status</b> {game.status}</span>
          </div>

          {tags.length > 0 && (
            <div className="modal-tags">
              {tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
            </div>
          )}

          {detail?.shortDescription && <p className="modal-desc">{detail.shortDescription}</p>}

          <div className="modal-ach">
            <h3>{game.store === 'PSN' ? 'Trophies' : 'Achievements'} {achievements.length > 0 && <span className="muted">{unlocked} / {achievements.length}</span>}</h3>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : achievements.length === 0 ? (
              <p className="muted">
                {game.store === 'Steam'
                  ? 'This game has no Steam achievements.'
                  : game.store === 'PSN'
                    ? 'No trophy data for this game.'
                    : `Achievements aren't available for ${game.store} titles.`}
              </p>
            ) : (
              <div className="ach-list">
                {achievements.map((a) => {
                  const masked = a.hidden && !a.achieved
                  return (
                    <div key={a.apiname} className={`ach-item ${a.achieved ? 'on' : 'off'}`}>
                      <img className="ach-icon" src={a.achieved ? a.icon : a.iconGray} alt=""
                        loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                      <div className="ach-body">
                        <div className="ach-name">{masked ? 'Hidden achievement' : a.name}</div>
                        <div className="ach-desc">{masked ? 'Unlock to reveal' : a.description}</div>
                      </div>
                      <div className="ach-when">{a.achieved ? fmtDate(a.unlockedAt) : 'Locked'}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
