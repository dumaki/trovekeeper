import { useEffect, useState, type ReactNode } from 'react'
import { storeMeta, type GameStatus } from '../data/mockData'
import { useData } from '../data/DataContext'
import HeroScene from './HeroScene'
import Donut from './Donut'

const heroStores = Object.keys(storeMeta) as (keyof typeof storeMeta)[]

const STATUS_COLOR: Record<GameStatus, string> = {
  Backlog: '#ef4444', Playing: '#f5c518', Finished: '#22c55e', Next: '#38bdf8', Skip: '#64748b',
}
const STATUS_ORDER: GameStatus[] = ['Backlog', 'Playing', 'Finished', 'Next', 'Skip']

// Per-game length used for the "years to clear" estimate when IGDB has no
// time-to-beat for a title.
const ASSUMED_HOURS_PER_GAME = 8
// Cap any single game's contribution to the backlog estimate. Endless games
// (MMOs, idle games) report absurd main-story times (RuneScape ~5,000h) that
// drown out the metric; 200h still respects genuinely long RPGs.
const TTB_CAP_HOURS = 200

export default function Dashboard() {
  const { dashboard, library, wishlist } = useData()
  const { profile, trending, libraryByStore, reviewSentiment } = dashboard

  // ---- everything status/deal-derived is computed from real data, so it
  // stays correct and reacts instantly to status edits in the Library tab ----
  const counts = { Backlog: 0, Playing: 0, Finished: 0, Next: 0, Skip: 0 }
  for (const g of library) counts[g.status]++
  const total = library.length
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)

  const completePct = pct(counts.Finished)
  const dealsLive = wishlist.filter((w) => w.discountPct > 0).length
  const backlogGames = counts.Backlog + counts.Next
  const gogGames = library.filter((g) => g.store === 'GOG').length
  const playedCount = library.filter((g) => g.playtimeHours > 0).length
  const playedPct = pct(playedCount)
  const T = total.toLocaleString()

  // ---- achievements: real completion signal across games that have them ----
  const withAch = library.filter((g) => (g.achTotal ?? 0) > 0)
  const perfectGames = withAch.filter((g) => g.achUnlocked === g.achTotal).length
  const avgCompletion = withAch.length
    ? Math.round((withAch.reduce((s, g) => s + g.achUnlocked! / g.achTotal!, 0) / withAch.length) * 100)
    : 0

  // Rotating facts shown below the hero — each value is live/computed.
  const facts: ReactNode[] = [
    <>You own <b>{profile.totalGames.toLocaleString()} games</b>. You've played <b>{playedCount.toLocaleString()}</b> — only <b>{playedPct}%</b> of your library.</>,
    <>You've perfected <b>{perfectGames}</b> games in your library. Keep it up!</>,
    <>You're currently playing <b>{counts.Playing}</b> of <b>{T}</b> games in your library.</>,
    <>You've got <b>{counts.Next}</b> of <b>{T}</b> games to play next.</>,
    <>You've got <b>{counts.Backlog}</b> of <b>{T}</b> marked as backlog.</>,
    <>You've finished <b>{counts.Finished}</b> of <b>{T}</b> — that's <b>{completePct}%</b> complete!</>,
    <>You've got <b>{counts.Skip}</b> out of <b>{T}</b> games marked as skipped.</>,
  ]

  // ttbHours (IGDB) when available, else the flat assumption per backlog game —
  // capped so endless games don't dominate the estimate.
  const backlogHours = library
    .filter((g) => g.status === 'Backlog' || g.status === 'Next')
    .reduce((sum, g) => sum + Math.min(g.ttbHours ?? ASSUMED_HOURS_PER_GAME, TTB_CAP_HOURS), 0)
  const yearsToClear = (backlogHours / (2 * 365)).toFixed(1)
  const ttbKnown = library.some((g) => g.ttbHours != null)

  const statusBreakdown = STATUS_ORDER
    .filter((s) => counts[s] > 0)
    .map((s) => ({ key: s, value: pct(counts[s]), color: STATUS_COLOR[s] }))

  // Quick-strip items, rendered as a scrolling marquee. GOG only appears once
  // that store is connected (so there's never an empty "GOG 0" chip).
  const quickItems: { badge: string; tone: string; label: string; sub: string }[] = [
    { badge: 'P', tone: STATUS_COLOR.Playing, label: `Playing ${counts.Playing}`, sub: 'in progress' },
    { badge: 'F', tone: STATUS_COLOR.Finished, label: `Finished ${counts.Finished}`, sub: 'completed' },
    { badge: '🏆', tone: '#f5c518', label: `${perfectGames} perfect`, sub: `${avgCompletion}% avg completion` },
    { badge: 'W', tone: '#f5c518', label: `Wishlist ${dealsLive}`, sub: 'deals live now' },
    { badge: 'S', tone: '#5ab0e8', label: `Steam ${profile.steamGames.toLocaleString()}`, sub: 'games' },
    ...(gogGames > 0 ? [{ badge: 'G', tone: '#7b3ff2', label: `GOG ${gogGames.toLocaleString()}`, sub: 'games' }] : []),
  ]

  const [t, setT] = useState(0)
  const cur = trending[t % trending.length]
  const cycle = (dir: number) =>
    setT((p) => (p + dir + trending.length) % trending.length)

  return (
    <div className="dashboard">
      {/* ---- HERO ---- */}
      <section className="hero">
        <div className="hero-art">
          <HeroScene />
          <div className="hero-fade" />
        </div>

        <div className="hero-content">
          <p className="eyebrow">Your Library</p>
          <div className="hero-count">{profile.totalGames.toLocaleString()}</div>
          <p className="hero-sub">
            games in this sample · {profile.storesConnected} of {profile.storesTotal} stores
          </p>

          <div className="store-row">
            {heroStores.map((s) => (
              <span key={s} className="store-chip" style={{ background: storeMeta[s].color }}
                title={storeMeta[s].label}>
                {storeMeta[s].glyph}
              </span>
            ))}
          </div>

          <div className="hero-facts">
            <span><b>{completePct}%</b> complete</span>
            <span className="dot">·</span>
            <span><b>{ttbKnown ? '' : '~'}{yearsToClear} yrs</b> to clear at 2h/day</span>
            <span className="dot">·</span>
            <span><b>{dealsLive}</b> deals live</span>
          </div>

          <div className="stat-cards">
            <Stat value={`${profile.playedHours.toLocaleString()}h`} label="Played" />
            <Stat value={backlogGames.toLocaleString()} label="Backlog" />
            <Stat value={`${profile.avgReviewPct}%`} label="Avg Review" />
          </div>

          <CyclingFact items={facts} />
        </div>

        <div className="carousel-ctl">
          <button onClick={() => cycle(-1)} aria-label="Previous">‹</button>
          <button aria-label="Pause">❚❚</button>
          <button onClick={() => cycle(1)} aria-label="Next">›</button>
        </div>
        <div className="trending-card">
          <p className="eyebrow">Trending Now</p>
          <h2>{cur.name}</h2>
          <p className="trending-meta">
            <b>{cur.reviewPct}%</b> review · <b>{cur.mainHours}h</b> main · {cur.status}
          </p>
        </div>
      </section>

      {/* ---- QUICK STRIP (scrolling marquee; pauses on hover) ---- */}
      <section className="quick-strip">
        <div className="quick-marquee">
          {/* The track holds two identical groups so the loop is seamless; the
              second is aria-hidden so screen readers don't read it twice. */}
          <div className="quick-track">
            <div className="quick-group">
              {quickItems.map((q, i) => <Quick key={i} {...q} />)}
            </div>
            <div className="quick-group" aria-hidden="true">
              {quickItems.map((q, i) => <Quick key={i} {...q} />)}
            </div>
          </div>
        </div>
      </section>

      {/* ---- DONUTS ---- */}
      <section className="donut-grid">
        <Donut
          title="Library by Store"
          data={libraryByStore}
          caption={<><b>Steam</b> leads at {libraryByStore[0]?.value ?? 0}%</>}
        />
        <Donut
          title="Status Breakdown"
          data={statusBreakdown}
          caption={<><b>{pct(counts.Backlog)}%</b> still in backlog</>}
        />
        <Donut
          title="Review Sentiment"
          data={reviewSentiment ?? []}
          caption={reviewSentiment?.length
            ? <>Mostly <b>{reviewSentiment[0].key.toLowerCase()}</b></>
            : 'Review data not fetched yet'}
        />
      </section>
    </div>
  )
}

// Rotates through facts, fading out the current one every 10s before the next.
function CyclingFact({ items }: { items: ReactNode[] }) {
  const [i, setI] = useState(0)
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const id = setInterval(() => {
      setFading(true) // fade out, then swap + fade in
      setTimeout(() => { setI((p) => (p + 1) % items.length); setFading(false) }, 500)
    }, 10_000)
    return () => clearInterval(id)
  }, [items.length])
  return <div className={`trust-pill ${fading ? 'fading' : ''}`}>{items[i % items.length]}</div>
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

function Quick({ badge, tone, label, sub }: { badge: string; tone: string; label: string; sub: string }) {
  return (
    <div className="quick-item">
      <span className="quick-badge" style={{ borderColor: tone, color: tone }}>{badge}</span>
      <span className="quick-label">{label}</span>
      <span className="quick-sub">{sub}</span>
    </div>
  )
}
