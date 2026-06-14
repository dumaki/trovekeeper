import ChestIcon from './ChestIcon'

// Minimal on-brand loader shown for the brief moment between a refresh and live
// data arriving. Deliberately neutral (no numbers) so stale/mock figures never
// flash before the real data loads.
export default function LoadingScreen() {
  return (
    <div className="boot">
      <div className="app-loading">
        <span className="app-loading-mark"><ChestIcon size={34} /></span>
        <span className="app-loading-name">TroveKeeper</span>
      </div>
    </div>
  )
}
