# TroveKeeper — Session Handoff

Status doc for continuing work in a fresh session. Read this first.

## What it is
A personal game-library dashboard for Steam (built to expand to other stores).
Vite + React + TypeScript frontend, tiny Express API proxy (run via `tsx`), all
data cached to disk. Three tabs: **Dashboard**, **Library**, **Wishlist**.

- **Repo:** https://github.com/dumaki/trovekeeper  (`main` is current & green)
- **Local path:** `/Users/benhughes/Documents/Claude/TroveKeeper`
- **Owner's Steam:** ~1,112 games (after non-game filtering), live data working.

## Run / verify
```bash
npm install
npm run setup     # writes .env (silent prompts), activates secret-guard hook
npm run dev       # web :5173, API :8787 (concurrently)
npm run typecheck # tsc over src/ AND server/  (run before committing)
npm run doctor    # redacted config diagnostic (safe to share)
npm run whoami    # resolve your SteamID64 from a vanity name
npm run gog-login # one-time GOG OAuth: writes GOG_REFRESH_TOKEN to .env
npm run epic-login # one-time Epic OAuth: writes EPIC_REFRESH_TOKEN to .env
npm run psn-login # one-time PSN: writes PSN_NPSSO (npsso cookie) to .env
npm run xbox-login # one-time Xbox: Microsoft OAuth -> XBOX_REFRESH_TOKEN in .env
```
Owner usually runs their **own** `npm run dev` in a terminal. The Claude preview
tool can't attach to it (it owns :5173/:8787), so to screenshot you must
`kill` those ports, `preview_start` (config name `trovekeeper`), then free them
again afterward so they can resume. Prefer verifying via `curl localhost:8787/api/*`
when you don't need a visual.

## Architecture
- **Secrets:** `.env` (git-ignored), read only server-side, never `VITE_`-prefixed.
  `providers.json` is the single source of truth for what secrets exist. Layers:
  `.gitignore` + committed `.githooks/pre-commit` secret-scan + CI gitleaks
  (`.github/workflows/secret-scan.yml`) + redacted `npm run doctor`. See README
  "Security model". The pre-commit hook flags 32-char hex; mock data must avoid
  hash-like strings.
- **API endpoints** (`server/index.ts`): `/api/health`, `/api/dashboard`,
  `/api/library`, `/api/wishlist`, `/api/progress` (boot gate), `/api/game/:appid`
  (detail card), `POST /api/status` (set play-status). Request paths are
  **read-only over disk caches**; a background **warmer** is the sole writer.
- **Background warmer** (`server/providers/steam.ts` `startWarmer`): THREE
  independent paced loops, decoupled so a throttle in one never stalls another:
  1. **storefront** (appdetails/appreviews, ~200 req/5min limit → ~36/min, 5-min
     backoff on 429): wishlist enrichment + library review scores + **app type**.
  2. **achievements** (Steam Web API, generous): per-game unlocked/total.
  3. **IGDB** (only if configured): batched time-to-beat.
- **Disk caches** (`.cache/`, git-ignored, atomic writes via `server/cache.ts`):
  `wishlist.json`, `reviews.json`, `achievements.json`, `timetobeat.json`,
  `apptypes.json`, `statuses.json`. Each has a TTL; warmer refills new/stale.
- **Boot gate** (`BootGate.tsx`): polls `/api/progress`, shows a skippable splash
  until wishlist is cached + top-100 reviews; warm cache → skipped instantly.
- **Frontend data** (`DataContext.tsx`): fetches `/api/dashboard|library|wishlist`
  on mount, falls back to bundled `mockData.ts` only if the backend is down.
  Renders a `LoadingScreen` until first fetch (no mock flash). Exposes
  `setGameStatus` (optimistic + POST).
- **Type-checking:** `tsconfig.json` covers `src/`; `tsconfig.server.json` covers
  `server/`. `npm run build`/`typecheck` run both. The server runs via `tsx`
  (esbuild, no type-check at runtime) — so ALWAYS `npm run typecheck` before
  committing; that's how the `countRemaining` runtime bug would've been caught.

## What's pullable from Steam (verified)
- **GetOwnedGames**: appid, name, playtime, `rtime_last_played` (→ "last played").
- **appdetails** (storefront, rate-limited): description, developers, publishers,
  release_date, genres, categories (Single-player/Multiplayer/Co-op/RPG…), price,
  `type` (game/music/demo/dlc/…). NOTE: community *store tags* (Soulslike, etc.)
  are NOT here — only genres + categories.
- **appreviews**: positive % + descriptor (Very Positive…).
- **GetPlayerAchievements** + **GetSchemaForGame**: per-achievement unlocked
  status, name, description, color/grey icons, unlock time, hidden flag.
- **IGDB** (`external_game_source = 1` for Steam; `game_time_to_beats.normally`):
  main-story hours. ⚠ IGDB deprecated the old `category` field — use
  `external_game_source`. Needs a free Twitch app (client id + secret).
- **NOT available:** Steam soundtracks owned as DLC are not returned by
  GetOwnedGames at all (confirmed — the owner's "25 soundtracks" were never in
  the count; the 1130→1112 drop was ads/mods/DLC/demos/betas).

## Features built (all on `main`)
Editable per-game **status** (dropdown on cards, persisted, played→Playing
default) · **dashboard stats** computed from real data (deals-live, %complete,
backlog hours, status donut, review-sentiment donut) · **achievements**
(completion %, perfect games, per-card progress bar) · **IGDB time-to-beat**
(backlog hours, capped at 200h/game so MMOs don't skew it) · **cycling library
facts** below the hero (fade every 10s) · **non-game filtering** (type + name) ·
**game detail modal** (click a card: info + scrollable locked/unlocked
achievements) · loader instead of mock flash · server type-checking.

## Key files
- `server/providers/steam.ts` — the big one: owned games, all caches, the 3-loop
  warmer, every enrichment fetcher, `getGameDetail`, status persistence, the
  non-game filter (`NON_GAME_TYPES` + `NON_GAME_NAME_RE`).
- `server/providers/gog.ts` — GOG OAuth token management + owned-library fetch
  (paged getFilteredProducts) + GOG game detail. Merged into steam.ts.
- `server/providers/epic.ts` — Epic launcher OAuth + owned-library (assets +
  catalog bulk) + wishlist (store GraphQL) + game detail. Merged into steam.ts.
- `server/providers/psn.ts` — PSN npsso→OAuth + played games (with playtime) +
  trophies (card counts + detail trophy list). Merged into steam.ts. No wishlist.
- `server/providers/xbox.ts` — Microsoft OAuth + XBL/XSTS chain + titlehub played
  games + per-title achievements. Merged into steam.ts. No wishlist.
- `server/providers/igdb.ts` — Twitch auth + batched time-to-beat.
- `src/components/Dashboard.tsx` — all dashboard math (computes from library +
  wishlist in context); `ASSUMED_HOURS_PER_GAME`, `TTB_CAP_HOURS`, cycling facts.
- `src/components/Library.tsx` — grid, filters, status dropdown, opens GameModal.
- `src/components/GameModal.tsx` — detail card.
- `src/data/mockData.ts` — types (Game/WishlistItem) + bundled sample data.

## Gotchas
- Storefront rate limit ~200/5min is the main constraint; first full warm of a
  big library is ~30–40 min (one-time, then cached). Don't bulk-probe appdetails.
- Two providers configured in owner's `.env`: Steam + IGDB.
- `.cache/` is per-account; delete it to force a cold rebuild.
- Commit style: end messages with `Co-Authored-By: Claude Opus 4.8 ...`. Push
  to `main`; commits touching `.github/workflows/` need a token with `workflow`
  scope (owner has it).

## Open follow-ups / next up
1. **GOG — DONE (basics).** `server/providers/gog.ts` merges the user's GOG
   library alongside Steam. Auth: `npm run gog-login` (GOG Galaxy's public OAuth
   client → long-lived refresh token in `.env`; server mints access tokens and
   handles rotation via `.cache/gog_auth.json`). Owned titles + cover art only —
   GOG has no public playtime or review-% endpoint, so GOG cards show 0h/no
   review and the detail modal has a description but no achievements. Statuses are
   now store-namespaced (`statusKey()` in steam.ts; Steam keys stay bare, GOG is
   `GOG:<id>`), and `/api/status` + `/api/game/:appid` take a `store`. The
   **GOG wishlist** is also wired (separate Steam/GOG tabs on the Wishlist page):
   `gog.getWishlist()` reads `embed.gog.com/user/wishlist.json` (ids) and enriches
   each via the public products + prices APIs, cached to `.cache/gog_wishlist.json`
   and refreshed by the GOG warmer; `/api/wishlist` returns it as a `gog[]` field.
   ⚠ The GOG **price** parse (`api.gog.com/products/{id}/prices`, "1999 USD" →
   $19.99) is the one bit not yet verified against a live account — titles/art are
   solid, prices degrade to TBA if the shape differs. **Next GOG polish:** GOG
   playtime (embed.gog.com user stats, if reliable) and GOG achievements.
   **Epic — DONE (library + wishlist).** `server/providers/epic.ts`, same shape as
   GOG: `npm run epic-login` (Epic's public launcher OAuth client → rotating
   refresh token). Library = launcher `assets/Windows` + catalog bulk metadata,
   DLC filtered by category. Wishlist = store GraphQL (`launcher.store.epicgames.com
   /graphql` `getWishlistQuery`) using the SAME launcher bearer (no separate store
   session needed), prices inline. Epic catalog ids are non-numeric, so `Game`
   gained an optional `storeId` (the catalogItemId); status keys + `/api/game` +
   `/api/status` now thread it (`statusKey('Epic', appid, storeId)`). Epic has no
   playtime/review-%/achievements. ⚠ Not verified against a live Epic account yet;
   wishlist is best-effort and fails soft (empty tab) if Epic's GraphQL shifts.
   **PSN — DONE (library + trophies); wishlist PENDING capture.**
   `server/providers/psn.ts`. Auth: `npm run psn-login` writes the `npsso` cookie
   to `PSN_NPSSO`; the server exchanges npsso→code→tokens and refreshes (refresh
   token cached to `.cache/psn_auth.json`). Library = `gamelist/v2/users/me/titles`
   (PLAYED games — note: not full purchase history — but WITH playtime + last
   played, so PSN cards are richer than GOG/Epic). Trophies map onto the
   achievement UI: per-card earned/total via the titleId→npCommunicationId bridge
   (`trophy/v1/users/me/titles/trophyTitles`), and the detail modal merges defined
   + earned trophies (`npServiceName=trophy` for PS4/older, `trophy2` for PS5).
   PSN ids are non-numeric titleIds (`CUSA…`/`PPSA…`) → carried in `storeId`.
   ⚠ Not verified against a live PSN account yet. **PSN wishlist is NOT exposed**
   via the npsso/OAuth surface — it lives behind the store GraphQL
   (`web.np.playstation.com/api/graphql/v1/op`) as an undocumented persisted query.
   The owner opted to capture the operationName + sha256Hash (+ store session) from
   browser DevTools; that wiring is the next PSN step (prices via
   `metGetPricingDataByConceptId`, hash `abcb311e…`).
   **Xbox — DONE (library + achievements; no wishlist).**
   `server/providers/xbox.ts`. Auth: `npm run xbox-login` (Microsoft OAuth public
   client `000000004C12AE6F`, no secret) → `XBOX_REFRESH_TOKEN`. Each run refreshes
   the MS access token then runs the XBL chain: `user.auth.xboxlive.com/user/
   authenticate` (RpsTicket `d=<access>`, contract-version 1) → `xsts.auth.
   xboxlive.com/xsts/authorize` (RelyingParty `http://xboxlive.com`) → `XBL3.0
   x=<uhs>;<token>` header + XUID. Library = `titlehub` titlehistory (played
   titles + cover + last-played + achievement summary in one call); detail = the
   v2 achievements endpoint (contract-version 2, paginated). titleIds carried in
   `storeId`. ⚠ Xbox **has no token-reachable wishlist** (store-web scrape only) —
   intentionally omitted. ⚠ Not verified against a live Xbox account yet.
   **Other stores** (Amazon has no usable API) follow the same provider shape —
   add to `providers.json`, write a `providers/<x>.ts`, merge in steam.ts's
   getLibrary/getDashboard/getWishlist.
2. **Community store tags** — would need scraping the store page (not in API).
3. **Exact Steam game count** — currently 1,112 vs Steam's 1,105; the ~7 gap is
   multiplayer-component appids (e.g. "Modern Warfare 3 - Multiplayer") Steam
   categorizes oddly. Owner is OK with the small gap.
4. Optional: persist game-detail to disk cache (currently 10-min in-memory).
