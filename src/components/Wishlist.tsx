import { useMemo, useState } from 'react'
import { useData } from '../data/DataContext'

type Sort = 'deal' | 'price' | 'review' | 'name'

export default function Wishlist() {
  const { wishlist, wishlistTotal, wishlistPending } = useData()
  const [sort, setSort] = useState<Sort>('deal')
  const [onlyDeals, setOnlyDeals] = useState(false)

  const items = useMemo(() => {
    const list = onlyDeals ? wishlist.filter((w) => w.discountPct > 0) : [...wishlist]
    list.sort((a, b) => {
      switch (sort) {
        case 'deal': return b.discountPct - a.discountPct
        case 'price': return a.price - b.price
        case 'review': return b.reviewPct - a.reviewPct
        case 'name': return a.name.localeCompare(b.name)
      }
    })
    return list
  }, [wishlist, sort, onlyDeals])

  const dealsLive = wishlist.filter((w) => w.discountPct > 0).length
  const totalSavings = wishlist.reduce((s, w) => s + (w.origPrice - w.price), 0)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Wishlist</h1>
          <p className="page-sub">
            {wishlistPending > 0
              ? <>{wishlist.length} of {wishlistTotal} loaded · </>
              : <>{wishlistTotal} games · </>}
            <b style={{ color: '#f5c518' }}>{dealsLive} deals live</b> ·
            ${totalSavings.toFixed(0)} potential savings
            {wishlistPending > 0 && (
              <span className="muted"> · caching {wishlistPending} more, reload to fill in</span>
            )}
          </p>
        </div>
        <div className="filter-group">
          <button className={`chip ${onlyDeals ? 'on' : ''}`} onClick={() => setOnlyDeals((v) => !v)}>
            On sale only
          </button>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="deal">Sort: Best deal</option>
            <option value="price">Sort: Lowest price</option>
            <option value="review">Sort: Top rated</option>
            <option value="name">Sort: A–Z</option>
          </select>
        </div>
      </div>

      <div className="wish-list">
        {items.map((w) => (
          <article key={w.appid} className="wish-row">
            <img className="wish-cover" src={w.headerImage} alt={w.name} loading="lazy"
              onError={(e) => { (e.currentTarget.style.visibility = 'hidden') }} />
            <div className="wish-info">
              <h3>{w.name}</h3>
              <div className="wish-sub">
                <span className="review-tag">
                  {w.reviewPct > 0 ? `${w.reviewPct}% review` : 'No reviews yet'}
                </span>
                <span className="muted">{releaseLabel(w.releasedAt)}</span>
              </div>
            </div>
            <div className="wish-price">
              {w.discountPct > 0 && <span className="deal-badge">-{w.discountPct}%</span>}
              <div className="price-stack">
                {w.discountPct > 0 && <span className="orig">${w.origPrice.toFixed(2)}</span>}
                <span className="now">{priceLabel(w)}</span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

// Steam returns free-text release strings ("To be announced", "Q4 2026") that
// Date can't parse — show those verbatim, and only year-stamp real dates.
function releaseLabel(raw: string): string {
  if (!raw) return 'Release TBA'
  const d = new Date(raw)
  return isNaN(d.getTime()) ? raw : `Released ${d.getFullYear()}`
}

// "Free" only for genuinely free titles; unreleased/unpriced shows TBA.
function priceLabel(w: { price: number; isFree?: boolean }): string {
  if (w.isFree) return 'Free'
  if (w.price === 0) return 'TBA'
  return `$${w.price.toFixed(2)}`
}
