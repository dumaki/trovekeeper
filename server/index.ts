// API proxy. The Steam Web API has no CORS and the key must stay server-side,
// so the browser only ever talks to these routes. Secrets are never sent to the
// client and every error is scrubbed through redact() before leaving the server.
import 'dotenv/config'
import express from 'express'
import { healthSnapshot, activeSecrets } from './config'
import { redact } from './redact'
import * as steam from './providers/steam'

const app = express()
app.use(express.json()) // parse JSON bodies for POST routes
// Dedicated API port — deliberately NOT the ambient PORT (which the web dev
// server / hosts use), so the two never collide. vite proxies /api here.
const PORT = Number(process.env.API_PORT) || 8787

// Wrap async handlers so upstream failures become sanitized 502s, not crashes
// or leaked stack traces.
const route = (fn: (req: express.Request) => Promise<unknown>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      res.json(await fn(req))
    } catch (err) {
      const msg = redact(err instanceof Error ? err.message : String(err), activeSecrets())
      console.error('[api] error:', msg)
      res.status(502).json({ error: 'Upstream request failed.', detail: msg })
    }
  }

// Safe to call publicly: reports only which providers are configured.
app.get('/api/health', (_req, res) => res.json(healthSnapshot()))

app.get('/api/dashboard', route(() => steam.getDashboard()))
app.get('/api/library', route(() => steam.getLibrary()))
app.get('/api/wishlist', route(() => steam.getWishlist()))
app.get('/api/progress', route(() => steam.getProgress())) // boot-gate polling
app.get('/api/game/:appid', route((req) => steam.getGameDetail(Number(req.params.appid))))
app.post('/api/status', route((req) => steam.setStatus(req.body?.appid, req.body?.status)))

app.listen(PORT, () => {
  const live = steam.configured()
  // Note: we log the MODE, never the key itself.
  console.log(`[api] listening on http://localhost:${PORT}  (steam: ${live ? 'live ✓' : 'mock — no key set'})`)
  // Kick off the paced background warmer (no-op when not configured).
  steam.startWarmer()
})
