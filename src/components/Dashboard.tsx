import { useState } from 'react'
import { storeMeta } from '../data/mockData'
import { useData } from '../data/DataContext'
import HeroScene from './HeroScene'
import Donut from './Donut'

const heroStores = Object.keys(storeMeta) as (keyof typeof storeMeta)[]

export default function Dashboard() {
  const { dashboard } = useData()
  const { profile, trending, libraryByStore, statusBreakdown, reviewSentiment } = dashboard

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
            <span><b>{profile.completePct}%</b> complete</span>
            <span className="dot">·</span>
            <span><b>{profile.yearsToClear} yrs</b> to clear at 2h/day</span>
            <span className="dot">·</span>
            <span><b>{profile.dealsLive}</b> deals live</span>
          </div>

          <div className="stat-cards">
            <Stat value={`${profile.playedHours}h`} label="Played" />
            <Stat value={`${profile.backlogHours.toLocaleString()}h`} label="Backlog" />
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

      {/* ---- QUICK STRIP ---- */}
      <section className="quick-strip">
        <Quick badge="6" tone="#64748b" label="avg" sub="across library" />
        <Quick badge="i" tone="#7b3ff2" label={`itch.io ${profile.itchBundleKeys.toLocaleString()}`} sub="bundle keys" />
        <Quick badge="W" tone="#f5c518" label={`Wishlist ${profile.dealsLive}`} sub="deals live now" />
        <Quick badge="C" tone="#22c55e" label={`Complete ${profile.completePct}%`} sub="of library finished" />
        <Quick badge="S" tone="#5ab0e8" label={`Steam ${profile.steamGames}`} sub="games" />
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
          data={statusBreakdown ?? []}
          caption={statusBreakdown
            ? <><b>{pctOf(statusBreakdown, 'Backlog')}%</b> still in backlog</>
            : 'Set play status on your games to see this'}
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

function pctOf(slices: { key: string; value: number }[], key: string) {
  return slices.find((s) => s.key === key)?.value ?? 0
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
