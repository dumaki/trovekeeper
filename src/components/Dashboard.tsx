import { useState } from 'react'
import { storeMeta, type GameStatus } from '../data/mockData'
import { useData } from '../data/DataContext'
import HeroScene from './HeroScene'
import Donut from './Donut'

const heroStores = Object.keys(storeMeta) as (keyof typeof storeMeta)[]

const STATUS_COLOR: Record<GameStatus, string> = {
  Backlog: '#ef4444', Playing: '#f5c518', Finished: '#22c55e', Next: '#38bdf8', Skip: '#64748b',
}
const STATUS_ORDER: GameStatus[] = ['Backlog', 'Playing', 'Finished', 'Next', 'Skip']

// Rough per-game length used only for the "years to clear" vanity estimate —
// Steam exposes no time-to-beat data, so this is a transparent assumption.
const ASSUMED_HOURS_PER_GAME = 8

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
  const backlogHours = backlogGames * ASSUMED_HOURS_PER_GAME
  const yearsToClear = (backlogHours / (2 * 365)).toFixed(1)

  const statusBreakdown = STATUS_ORDER
    .filter((s) => counts[s] > 0)
    .map((s) => ({ key: s, value: pct(counts[s]), color: STATUS_COLOR[s] }))

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
            <span><b>~{yearsToClear} yrs</b> to clear at 2h/day</span>
            <span className="dot">·</span>
            <span><b>{dealsLive}</b> deals live</span>
          </div>

          <div className="stat-cards">
            <Stat value={`${profile.playedHours.toLocaleString()}h`} label="Played" />
            <Stat value={backlogGames.toLocaleString()} label="Backlog" />
            <Stat value={`${profile.avgReviewPct}%`} label="Avg Review" />
          </div>

          <div className="trust-pill">
            Credentials stay encrypted on your machine — fetchers use your browser session.
          </div>
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

      {/* ---- QUICK STRIP (computed from real status counts) ---- */}
      <section className="quick-strip">
        <Quick badge="P" tone={STATUS_COLOR.Playing} label={`Playing ${counts.Playing}`} sub="in progress" />
        <Quick badge="N" tone={STATUS_COLOR.Next} label={`Next ${counts.Next}`} sub="up next" />
        <Quick badge="F" tone={STATUS_COLOR.Finished} label={`Finished ${counts.Finished}`} sub="completed" />
        <Quick badge="W" tone="#f5c518" label={`Wishlist ${dealsLive}`} sub="deals live now" />
        <Quick badge="S" tone="#5ab0e8" label={`Steam ${profile.steamGames.toLocaleString()}`} sub="games" />
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
