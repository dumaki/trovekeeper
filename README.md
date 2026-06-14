# TroveKeeper

Keep your whole game trove in one place. A multi-store game-library dashboard
(Vite + React + TypeScript, with a tiny Express API proxy). Three tabs:

- **Dashboard** — hero stats, store breakdown, status + review-sentiment donuts, trending carousel
- **Library** — filterable game grid (store / status / search) with live Steam cover art
- **Wishlist** — deal-sorted wishlist with discounts and potential savings

Runs on **sample data out of the box** — no key required. Add a Steam key to see
your real library. The sidebar badge shows whether you're viewing *Live* or
*Sample* data.

## Quick start

```bash
npm install
npm run setup     # creates a git-ignored .env, prompts for keys (not echoed)
npm run dev       # web on http://localhost:5173, API on http://localhost:8787
```

`npm run setup` is safe to run with no key — just press Enter at each prompt and
the app runs on sample data. Run it again any time to fill in or change keys.

| Command | What it does |
| --- | --- |
| `npm run setup` | Create `.env`, prompt for secrets (silent), activate the secret-guard git hook |
| `npm run doctor` | Print a **redacted** config diagnostic — safe to paste into a GitHub issue |
| `npm run dev` | Run web + API together |
| `npm run build` | Type-check and build the frontend |

## Getting a Steam key

1. **API key** — https://steamcommunity.com/dev/apikey (domain `localhost` is fine).
2. **SteamID64** — your 17-digit ID from https://steamid.io.
3. Your Steam profile + game details must be set to **Public** or the API returns nothing.

Then `npm run setup` and paste them at the prompts (the key is never shown as you type).

## Optional: IGDB for accurate backlog hours

By default "years to clear" uses a flat ~8h/game estimate (HowLongToBeat has no
usable public API). For real per-game time-to-beat, add free IGDB credentials:

1. Register an app at https://dev.twitch.tv/console/apps (OAuth redirect
   `http://localhost`, category Application Integration).
2. Copy the **Client ID** and generate a **Client Secret**.
3. `npm run setup` → paste them at the `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET`
   prompts, then restart `npm run dev`.

The server maps Steam appids → IGDB games (`external_games`) → main-story
time-to-beat (`game_time_to_beats`), cached at `.cache/timetobeat.json` and
refreshed monthly. Backlog hours then sum real per-game lengths; unmatched
titles fall back to the estimate. Achievements (Steam, always on) are unaffected.

## Security model

Credentials are treated as radioactive. The design makes it structurally hard to
leak a key, and every layer is independent:

- **Never in the browser.** The key is read only by the Express server. Vite
  inlines `VITE_`-prefixed vars into the client bundle, so secrets are
  deliberately *not* prefixed and never imported by frontend code. The browser
  only ever calls `/api/*`.
- **Never in git.** `.env` is git-ignored; `.env.example` (no real values) is the
  only committed template. A pre-commit hook (`.githooks/pre-commit`, activated by
  `setup`) blocks any commit that stages a `.env` or contains a key-shaped string.
  `chmod 600` on `.env`.
- **Never in logs or errors.** All logging and every error returned to the client
  passes through `server/redact.ts`, which scrubs secret values and key-bearing
  query params. Startup logs the *mode* (`live`/`mock`), never the key.
- **Safe troubleshooting.** Don't share your `.env` — run `npm run doctor`. It
  reports config **status** only (secrets shown as `set`/`missing`, never any
  characters) and flags dangerous states (e.g. an accidentally-tracked `.env`).
- **CI backstop.** `.github/workflows/secret-scan.yml` runs gitleaks on every push
  and PR, catching anything that slips past the local hook (e.g. in a fork).

> The pre-commit hook activates only when this folder is its own git repo. After
> you split it out for GitHub (`git init` at the project root), re-run
> `npm run setup` to wire it up, and `npm run doctor` to confirm.

## Architecture

```
server/                Express API (dev-run via tsx)
  index.ts             routes: /api/health, /api/dashboard, /api/library, /api/wishlist
  config.ts            provider/secret registry (reads providers.json)
  redact.ts            secret scrubbing for logs + error responses
  providers/steam.ts   live Steam fetch + mock fallback
src/
  data/mockData.ts     sample data — single source of truth, shapes mirror the real API
  data/DataContext.tsx fetches /api/*, falls back to bundled mock if the API is down
  components/          Dashboard, Library, Wishlist, Donut, HeroScene
providers.json         provider + secret manifest (used by server, setup, doctor)
```

## Adding another store later

The app is built for it. Add an entry to `providers.json` (its env keys + which
are secret) — it then appears automatically in `setup` and `doctor`. Add a
`server/providers/<store>.ts` fetcher and merge its results in the API routes.
The mock multi-store fields (GOG/Epic/PSN/…) are already wired through the UI.

### Live Steam — current coverage

`GetOwnedGames` + `GetPlayerSummaries` power the library, profile, and playtime.
Per-title **review scores** are enriched from the appreviews endpoint and cached
on disk (`.cache/reviews.json`), exactly like the wishlist: ~40 most-played
titles per load, weekly refresh, evicted when un-owned. They drive the Library
cards' review %, the Dashboard's **Avg Review** stat, and the **Review
Sentiment** donut (keyed by Steam's real descriptors). The donut grows more
representative as the cache warms across loads.

Steam still doesn't expose play-status (Backlog/Playing/Next), so in live mode
those default to Backlog until app-side metadata is added.

Both `/api/library` and `/api/dashboard` run off a single enriched-library
computation (singleflight + 60s memory TTL), so the two parallel frontend
requests don't double the API spend.

### First-boot warm-up + boot gate

Steam's storefront API (appdetails/appreviews) is rate-limited to ~200 requests
/ 5 min, so a full cold enrichment of a large account (e.g. ~1,130 games +
~250 wishlist items ≈ 1,600 calls) takes **~30–40 min the first time**. After
that the disk cache makes every launch instant — only stale entries refresh.

To handle this, a **background warmer** (`startWarmer` in `providers/steam.ts`)
is the sole cache writer: it enriches ~6 storefront calls every 10s (~36/min,
safely under the limit) and **backs off 5 min on any 429**. It fills the wishlist
first, then library reviews most-played-first. The request endpoints are
read-only over the cache, so they never race it.

On first load the UI shows a **boot splash** ([`BootGate.tsx`](src/components/BootGate.tsx))
that polls `/api/progress` and releases once a usable threshold is reached
(full wishlist + top `REVIEW_GATE` = 100 reviews). It's always **skippable** —
"Continue while it finishes" lets you in immediately while the warmer keeps going.
With a warm cache the splash is skipped entirely.

Tuning knobs (top of `providers/steam.ts`): `STEP_CALLS` / `STEP_INTERVAL_MS`
(pace), `REVIEW_GATE` (gate threshold), `PRICE_TTL` / `REVIEW_TTL` (freshness).

### Wishlist caching

The wishlist uses Steam's `IWishlistService/GetWishlist` for the authoritative
list of appids (one cheap call), then enriches each with store details + review
score (the rate-limited part). Enriched results are cached on disk at
`.cache/wishlist.json` (git-ignored, atomic writes):

- **Incremental:** at most ~40 items are network-fetched per load, newest first.
  A large wishlist fills in over a few loads; the header shows `X of Y loaded`
  while it warms.
- **Freshness tiers:** price/discount re-checked every **6h** (to catch sales),
  review % weekly, name/release effectively never.
- **Adds/removes:** `GetWishlist` is the source of truth each load — new items
  enrich, removed items are evicted, no stale entries linger.
- **Unavailable titles** (region-locked/delisted) are remembered for 6h so they
  don't starve real items; transient throttling is retried, not tombstoned.

Storage is tiny — ~250–400 bytes/item, so even a 2,000-item wishlist stays under
~1 MB. Delete `.cache/` any time to force a cold rebuild.
