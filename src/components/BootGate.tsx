import { useEffect, useState, type ReactNode } from 'react'
import ChestIcon from './ChestIcon'
import LoadingScreen from './LoadingScreen'

interface Progress {
  configured: boolean
  ready: boolean
  warming: boolean
  wishlist: { cached: number; total: number }
  library: { cached: number; total: number }
}

// Blocks the app on first boot until the background warmer reaches a usable
// threshold (full wishlist + top ~100 reviews). Always skippable — the warmer
// keeps filling in the background either way. When there's no backend, or data
// is already warm, it falls through immediately.
export default function BootGate({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const p: Progress = await (await fetch('/api/progress')).json()
        if (cancelled) return
        setProgress(p)
        if (p.ready) { setEntered(true); return }
      } catch {
        // No backend reachable (e.g. running `vite` alone) — don't trap the user.
        if (!cancelled) setEntered(true)
        return
      }
      timer = setTimeout(poll, 2000)
    }
    poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  if (entered) return <>{children}</>
  // Still checking readiness (e.g. a warm-cache refresh) — show the neutral
  // loader, not the detailed splash, so quick refreshes don't flash progress bars.
  if (!progress) return <LoadingScreen />
  return <Splash progress={progress} onSkip={() => setEntered(true)} />
}

function Splash({ progress, onSkip }: { progress: Progress | null; onSkip: () => void }) {
  return (
    <div className="boot">
      <div className="boot-card">
        <div className="boot-logo"><span className="brand-mark"><ChestIcon size={20} /></span> TroveKeeper</div>
        <h1>Syncing your Steam library</h1>
        <p className="boot-sub">
          Pulling prices and review scores within Steam's rate limits. This runs once —
          afterwards every launch is instant.
        </p>
        <Bar label="Wishlist" stat={progress?.wishlist} />
        <Bar label="Library reviews" stat={progress?.library} />
        <button className="boot-skip" onClick={onSkip}>
          Continue while it finishes →
        </button>
      </div>
    </div>
  )
}

function Bar({ label, stat }: { label: string; stat?: { cached: number; total: number } }) {
  const cached = stat?.cached ?? 0
  const total = stat?.total ?? 0
  const pct = total ? Math.min(100, Math.round((cached / total) * 100)) : 0
  return (
    <div className="boot-row">
      <div className="boot-row-head">
        <span>{label}</span>
        <span className="muted">{total ? `${cached} / ${total}` : 'connecting…'}</span>
      </div>
      <div className="boot-track"><div className="boot-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  )
}
