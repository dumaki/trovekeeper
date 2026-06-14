interface Slice {
  key: string
  value: number
  color: string
}

interface DonutProps {
  title: string
  data: Slice[]
  caption: React.ReactNode
}

// SVG donut. Slices are drawn as stroked circle segments using
// stroke-dasharray, so there are no path-math headaches and it stays crisp
// at any size.
export default function Donut({ title, data, caption }: DonutProps) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const size = 150
  const stroke = 26
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  const empty = total === 0
  // Slices are stroked circles painted in order; without this, the sub-pixel
  // seam where the last slice meets the first lets the underlying slice's edge
  // bleed through. A tiny dash overlap (covered by the next slice painted on
  // top) hides every seam. Only needed when there's more than one slice.
  const overlap = data.length > 1 ? 1.2 : 0

  return (
    <div className="panel donut-panel">
      <h3 className="panel-title">{title}</h3>
      <div className="donut-body">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-svg">
          {empty && (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke="#1e2d45" strokeWidth={stroke} />
          )}
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {data.map((d) => {
              const frac = d.value / total
              const dash = frac * c
              // Extend the dash by `overlap` so this slice bleeds slightly into
              // the next, which is painted on top — seamless boundaries.
              const drawn = Math.min(dash + overlap, c)
              const seg = (
                <circle
                  key={d.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${drawn} ${c - drawn}`}
                  strokeDashoffset={-offset}
                />
              )
              offset += dash
              return seg
            })}
          </g>
        </svg>
        <ul className="legend">
          {empty && <li className="legend-empty">No data yet</li>}
          {data.map((d) => (
            <li key={d.key}>
              <span className="legend-dot" style={{ background: d.color }} />
              <span className="legend-label">{d.key}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="donut-caption">{caption}</p>
    </div>
  )
}
