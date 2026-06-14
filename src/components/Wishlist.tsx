import { useMemo, useState } from 'react'
import { useData } from '../data/DataContext'
import { storeMeta } from '../data/mockData'

type Sort = 'deal' | 'price' | 'review' | 'name'
type StoreTab = 'Steam' | 'GOG'

export default function Wishlist() {
  const { wishlist, wishlistTotal, wishlistPending, gogWishlist } = useData()
  const [sort, setSort] = useState<Sort>('deal')
  const [onlyDeals, setOnlyDeals] = useState(false)
  const [storeTab, setStoreTab] = useState<StoreTab>('Steam')

  // The GOG tab only appears once that wishlist has items, mirroring how the
  // dashboard only surfaces connected stores.
  const hasGog = gogWishlist.length > 0
  const tab: StoreTab = hasGog ? storeTab : 'Steam'
  const source = tab === 'GOG' ? gogWishlist : wishlist

  const items = useMemo(() => {
    const list = onlyDeals ? source.filter((w) => w.discountPct > 0) : [...source]
    list.sort((a, b) => {
      switch (sort) {
        case 'deal': return b.discountPct - a.discountPct
        case 'price': return a.price - b.price
        case 'review': return b.reviewPct - a.reviewPct
        case 'name': return a.name.localeCompare(b.name)
      }
    })
    return list
  }, [source, sort, onlyDeals])

  const dealsLive = source.filter((w) => w.discountPct > 0).length
  const totalSavings = source.reduce((s, w) => s + (w.origPrice - w.price), 0)

  // Count label differs per tab: Steam can still be caching items in the
  // background; GOG loads as one batch, so it's just a plain count.
  const countLabel = tab === 'GOG'
    ? <>{gogWishlist.length} games · </>
    : (wishlistPending > 0 ? <>{wishlist.length} of {wishlistTotal} loaded · </> : <>{wishlistTotal} games · </>)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Wishlist</h1>
          <p className="page-sub">
            {countLabel}
            <b style={{ color: '#f5c518' }}>{dealsLive} deals live</b> ·
            ${totalSavings.toFixed(0)} potential savings
            {tab === 'Steam' && wishlistPending > 0 && (
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

      {hasGog && (
        <div className="wish-tabs">
          {(['Steam', 'GOG'] as StoreTab[]).map((s) => (
            <button key={s} className={`wish-tab ${tab === s ? 'on' : ''}`} onClick={() => setStoreTab(s)}>
              <span className="wish-tab-badge" style={{ background: storeMeta[s].color }}>{storeMeta[s].glyph}</span>
              {storeMeta[s].label}
              <span className="count">{(s === 'GOG' ? gogWishlist : wishlist).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="wish-list">
        {items.length === 0 && <p className="empty">Nothing on this wishlist yet.</p>}
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
