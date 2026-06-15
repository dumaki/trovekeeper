# TroveKeeper — Session Handoff

Status doc for continuing work in a fresh session. Read this first.

## What it is
A personal **multi-store** game-library dashboard. Vite + React + TypeScript
frontend, tiny Express API proxy (run via `tsx`), all data cached to disk. Three
tabs: **Dashboard**, **Library**, **Wishlist** (Wishlist has per-store sub-tabs).

- **Repo:** https://github.com/dumaki/trovekeeper  (`main` is current & green)
- **Local path:** `/Users/benhughes/Documents/Claude/TroveKeeper`
- **Eight stores connected & live-verified** in the owner's `.env`: **Steam**
  (~1,112 games), **GOG**, **Epic**, **PSN**, **Xbox**, **Nintendo** (eShop),
  **itch.io**, **Ubisoft** (Connect) — plus **IGDB** for time-to-beat. Each
  non-Steam store is its own provider merged into the library, dashboard donut,
  and the quick-strip marquee chips. Store chips render real **brand logos**
  (`src/data/storeIcons.ts`).
- **Store target is 10** (`storesTotal`): the 8 above + 2 remaining — **Amazon**
  (next) and **EA** (deferred — see follow-ups). Humble Bundle (keys already
  redeemed on Steam) and Battle.net (no owned-games API) were intentionally dropped.

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
npm run nintendo-login # paste ec.nintendo.com session cookie (~30d) -> NINTENDO_COOKIE
npm run itch-login # paste itch.io API key -> ITCH_API_KEY (verified against /profile)
npm run ubisoft-login # paste ubisoft.com rememberMeTicket -> UBISOFT_REMEMBER_TOKEN
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
  Plus each non-Steam store runs its **own** warmer (started by `steam.startWarmer`
  calling `<store>.startWarmer()`), refreshing that store's library/wishlist on a
  TTL. The Steam pacers and the per-store warmers are all independent.
- **Disk caches** (`.cache/`, git-ignored, atomic writes via `server/cache.ts`):
  Steam: `wishlist.json`, `reviews.json`, `achievements.json`, `timetobeat.json`,
  `apptypes.json`, `statuses.json` (`statuses.json` is shared across ALL stores).
  Per non-Steam store: `<store>_auth.json` (rotating refresh token — preferred
  over the `.env` value), `<store>_games.json` (library), and `<store>_wishlist.json`
  where applicable. Each has a TTL; per-store warmers refill new/stale.
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
**Eight-store library** (Steam/GOG/Epic/PSN/Xbox/Nintendo/itch.io/Ubisoft merged) ·
**real brand-logo store chips** · editable per-game
**status** (dropdown on cards, persisted, played→Playing default) · **dashboard
stats** computed from real data (deals-live, %complete, backlog hours, status
donut, review-sentiment donut, **library-by-store donut**) · **scrolling
quick-strip marquee** (edge fades, hover-pause, reduced-motion aware; one chip
per store) · **achievements/trophies** (completion %, perfect games, per-card
progress bar; Steam achievements + PSN trophies + Xbox achievements all share the
same UI) · **IGDB time-to-beat** (backlog hours, capped at 200h/game) · **cycling
library facts** below the hero (fade every 10s, incl. skipped-games count) ·
**non-game filtering** (Steam type + name) · **game detail modal** (info +
scrollable locked/unlocked achievements/trophies) · **Wishlist with per-store
tabs** (Steam/GOG/Epic/Nintendo, each shown only when it has items) · loader instead of
mock flash · server type-checking.

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
  games + playtime (MinutesPlayed stats) + per-title achievements (v2 + 360 v1
  fallback). Merged into steam.ts. No wishlist yet.
- `server/providers/nintendo.ts` — eShop session-cookie → `/api/auth/session`
  id_token → savanna GraphQL purchase history. Dormant wishlist. Merged into steam.ts.
- `server/providers/itch.ts` — itch.io API-key owned-keys library. Merged into steam.ts.
- `server/providers/ubisoft.ts` — rememberMeTicket→ticket refresh; gamesplayed +
  catalog + stats(playtime). Merged into steam.ts.
- `server/providers/igdb.ts` — Twitch auth + batched time-to-beat.
- `src/data/storeIcons.ts` — brand-logo SVG paths (simple-icons) for the store chips.
- `src/components/Dashboard.tsx` — all dashboard math (computes from library +
  wishlist in context); `ASSUMED_HOURS_PER_GAME`, `TTB_CAP_HOURS`, cycling facts.
- `src/components/Library.tsx` — grid, filters, status dropdown, opens GameModal.
- `src/components/GameModal.tsx` — detail card.
- `src/data/mockData.ts` — types (Game/WishlistItem) + bundled sample data.

## Multi-store architecture (read before adding a store)
`steam.ts` is the **aggregation hub**: its `getLibrary`/`getDashboard`/`getWishlist`
loop over the configured providers and merge results. Each store is a self-
contained `server/providers/<store>.ts` exporting `configured()`, `getGames()`,
`getGameDetail(appid, storeId?)`, `getWishlist()` (optional), `warming()`, and
`startWarmer()`. To add a store: add it to `providers.json`, write the provider,
add `STORE_COLOR` + the merge blocks + `startWarmer()` call in steam.ts, a
dashboard chip in `Dashboard.tsx`, and (if it has a wishlist) a `StoreTab` entry.

Hard-won conventions:
- **Auth = one-time login helper → long-lived refresh token.** Each store has a
  `scripts/<store>-login.mjs` (a `npm run <store>-login` script) that walks the
  user through a browser login and writes `<STORE>_REFRESH_TOKEN` (or `PSN_NPSSO`)
  to `.env`. The server prefers the rotated token in `.cache/<store>_auth.json`
  and re-bootstraps from the env value if it's missing/expired. **Persist the
  rotated refresh token every time** (Epic/MS/PSN all rotate).
- **Non-numeric store ids → `Game.storeId`.** `Game.appid` is `number`; stores
  with string ids (Epic catalogItemId, PSN/Xbox titleId) hash the id into `appid`
  and carry the real id in `storeId`. `statusKey(store, appid, storeId)` keys
  play-status by `${store}:${storeId ?? appid}` (Steam stays bare for back-compat).
- **Game detail resolves by `appid`, NOT storeId.** Providers look the game up in
  their own cache by the `appid` that's always in the `/api/game/:appid` path
  (storeId is a fallback). Depending on the client to thread storeId silently
  broke PSN trophy + modern Xbox achievement lists once — don't reintroduce that.
- **Public client secrets are base64-wrapped + named off "secret".** GOG/Epic/PSN
  embed a well-known *public* client secret (32-char hex / short) that trips the
  pre-commit secret-guard. Wrap as `Buffer.from('<b64>','base64').toString()` in a
  const named `CLIENT_AUTH` (not `*SECRET*`), with a comment. Verify with
  `grep -E '[A-Fa-f0-9]{32}'` before committing. (Xbox's client id is 16-hex — no
  wrap needed; it's a public client with no secret at all.)
- **Verifying live without the owner's UI:** the owner runs their own dev server.
  You can diagnose a provider against their real account by reading the token from
  `.cache/<store>_auth.json` (or `.env`) in a throwaway `/tmp/*.mjs` and hitting
  the upstream API directly — this is how the PSN `Basic`-case bug and the Xbox
  360/v2-empty bug were found. Curl `localhost:8787/api/*` if their server is up.

## Gotchas
- Storefront rate limit ~200/5min is the main constraint; first full warm of a
  big library is ~30–40 min (one-time, then cached). Don't bulk-probe appdetails.
- Owner's `.env` has all six configured: Steam, IGDB, GOG, Epic, PSN, Xbox.
- `.cache/` is per-account; delete a `<store>_*.json` to force that store's cold
  rebuild (e.g. `rm .cache/xbox_games.json` to re-pull with fresh playtime).
- Commit style: end messages with `Co-Authored-By: Claude Opus 4.8 ...`. Push
  to `main`; commits touching `.github/workflows/` need a token with `workflow`
  scope (owner has it).

## Stores — status (all live-verified against the owner's accounts)
- **Steam** — full: library, wishlist, reviews, achievements, IGDB time-to-beat.
- **GOG** ✅ library + wishlist (`gog-login`). Owned titles + art; **no** playtime/
  review-%/achievements (GOG doesn't expose them). Wishlist prices verified live
  (incl. sale prices) via `api.gog.com/products/{id}/prices`.
- **Epic** ✅ library + wishlist (`epic-login`, launcher OAuth). Library = launcher
  assets + catalog bulk (DLC filtered by category). Wishlist = store GraphQL
  (`launcher.store.epicgames.com/graphql` getWishlistQuery) on the SAME launcher
  bearer, prices inline. No playtime/achievements.
- **PSN** ✅ library + trophies (`psn-login`, npsso→OAuth). ⚠ Sony's token endpoint
  requires a **capitalised `Basic`** auth scheme (lowercase → invalid_client).
  Library = `gamelist/v2` PLAYED games WITH playtime + last-played. Trophies via the
  titleId→npCommunicationId bridge; detail merges defined + earned (npServiceName
  `trophy`/`trophy2`). **Wishlist: TODO** — behind store GraphQL
  (`web.np.playstation.com/api/graphql/v1/op`) as an undocumented persisted query;
  needs operationName + sha256Hash captured from the owner's browser DevTools
  (prices via `metGetPricingDataByConceptId`, hash `abcb311e…`).
- **Xbox** ✅ library + playtime + achievements (`xbox-login`, MS OAuth public
  client, no secret → XBL→XSTS chain, RpsTicket `d=…`, contract-version `1` for
  auth / `2` for titlehub+achievements). Library = `titlehub`; playtime =
  `userstats.xboxlive.com/batch` MinutesPlayed (360/apps omit it). Achievements:
  v2 returns all incl. locked for modern titles; **Xbox 360 only exposes EARNED via
  v1**, so the list is padded with "Locked achievement" placeholders up to the real
  total. **Wishlist: TODO** — NOT on the launcher token, BUT it's auth'd by an
  XToken for relying party `http://mp.microsoft.com/`, which we can **mint** from
  the existing xbox-login (same XSTS chain, swap RelyingParty — no fragile cookie).
  Just needs the wishlist data-endpoint URL (capture the Fetch/XHR request on
  xbox.com/wishlist — host likely `*.xboxservices.com` / `displaycatalog.mp.microsoft.com`).
- **Nintendo** ✅ eShop library (`nintendo-login`). Auth is NOT a cookie scrape or
  OAuth dance: ec.nintendo.com is a Next.js/NextAuth app, so we store its session
  **cookie** (`__Secure-next-auth.session-token`, ~30 days) and call
  `GET ec.nintendo.com/api/auth/session` to mint a fresh 15-min Nintendo Account
  `id_token`, which authorizes the savanna GraphQL purchase-history query
  (`wb.lp1.savanna.srv.nintendo.net/graphql`, persisted query
  `TransactionsClientRootClient`, hash base64-wrapped in `nintendo.ts`). Library =
  `data.account.transactionHistories.transactionHistories[]`, filtered to
  itemType APPLICATION/BUNDLE + transactionType PURCHASE. Only ~2 years of digital
  history; no cover art / playtime / achievements. **Wishlist: TODO** — the
  nintendo.com Store wishlist is a *different* system; the provider has a dormant
  `getWishlist` that only activates when both `NINTENDO_STORE_COOKIE` AND
  `NINTENDO_WISHLIST_URL` are set (no guessed default → no 404). Needs a one-time
  capture of the wishlist XHR.
- **itch.io** ✅ library (`itch-login`). Simplest auth of any store: a personal
  **API key** (`ITCH_API_KEY`, Bearer, long-lived) from itch.io/user/settings/
  api-keys — no OAuth, no refresh. Library = `GET api.itch.io/profile/owned-keys`
  (paged), owned games + cover art + short_text; non-game `classification`
  filtered. No playtime/achievements/wishlist. itch ids hashed into appid
  (2.7B range) like Epic/Xbox/Nintendo.
- **Ubisoft** ✅ library + playtime (`ubisoft-login`). Raw email/password auth is
  429-blocked, so the durable credential is the browser **`rememberMeTicket`**
  (grabbed from ubisoft.com local storage); the server refreshes it into 15-min
  `Ubi_v1` tickets via `POST /v3/profiles/sessions` with `Authorization: rm_v1
  t=<rememberMeTicket>` (rotates — persist the new one). Library assembled from 3
  `public-ubiservices.ubi.com` calls: `gamesplayed` (played spaceIds + last-
  played) → `catalog` (spaceId→name+art, siblingGames dedup cross-platform) →
  `stats?statNames=Playtime` (seconds→hours, queried per *played* spaceId).
  Playtime is sparse (Ubisoft only records it for some titles); last-played is
  universal. No achievements on this surface. spaceId hashed into appid (2.9B).

## Open follow-ups / next up
1. **Amazon (next store)** — Login-with-Amazon device OAuth like Nile/Heroic;
   owned + art only (sparse). DevTools/proxy-capturable. Needs a claimed Prime
   Gaming game to test against.
2. **EA — DEFERRED.** EA removed the web games list (April 2025 Origin sunset);
   the library is now only in the desktop EA app, so there's nothing to capture
   in-browser. The API would be *rich* (owned + playtime + achievements) and the
   endpoints are known (FriendsOfGalaxy `galaxy-integration-origin`/`-ead`): auth
   = cookie-backed `GET accounts.ea.com/connect/auth?response_type=token&prompt=none`
   → access_token (Bearer + `AuthToken` + `X-AuthToken`); identity =
   `gateway.ea.com/proxy/identity/pids/me`; owned =
   `api{1-4}.origin.com/ecommerce2/consolidatedentitlements/{pid}` (Accept
   `application/vnd.origin.v3+json`); names = `…/ecommerce2/public/supercat/{offerId}/en_US`;
   playtime = `…/atom/users/{pid}/games/{masterTitleId}/usage`; achievements =
   `achievements.gameservices.ea.com/achievements/personas/{personaId}/{set}/all`.
   Two routes to revisit: (a) cheap — grab the `accounts.ea.com` cookie and test
   whether a browser-minted token still authorizes the entitlements API
   server-side (post-Origin it may be dead); (b) reliable but heavy — proxy-
   capture the desktop EA app (Proxyman/mitmproxy + cert, possible pinning).
   Owner has only ~2 EA games, so low value — deprioritised.
3. **Amazon + Humble + Battle.net** note: **Humble + Battle.net dropped** (Humble
   keys all redeemed on Steam; Battle.net has no owned-games API). Optional Ubisoft
   follow-up: **achievements/Units** (a separate club endpoint, not yet wired).
3. **Nintendo wishlist** — dormant; needs a nintendo.com wishlist XHR capture
   (see the Nintendo "Wishlist: TODO" note). Same for **PSN + Xbox wishlist**.
4. **Community store tags** — would need scraping the Steam store page (not in API).
5. **Exact Steam game count** — 1,112 vs Steam's 1,105; ~7 multiplayer-component
   appids (e.g. "Modern Warfare 3 - Multiplayer"). Owner is OK with the gap.
6. Optional: persist game-detail to disk cache (currently 10-min in-memory).
