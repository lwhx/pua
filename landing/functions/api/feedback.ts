import { getSession } from "./_session"

interface Env {
  DB: D1Database
  SESSION_SECRET: string
}

type FeedbackBody = {
  rating?: string
  task_summary?: string
  pua_level?: string
  pua_count?: number
  flavor?: string
  session_data?: string
  failure_count?: number
}

const MAX_BODY_BYTES = 64 * 1024
const MAX_SESSION_DATA_BYTES = 32 * 1024
const MAX_RATING_BYTES = 128
const MAX_TASK_SUMMARY_BYTES = 2048
const MAX_FLAVOR_BYTES = 128
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_MAX_WRITES = 20

const ALLOWED_ORIGINS = new Set([
  "https://openpua.ai",
  "https://www.openpua.ai",
  "https://pua-skill.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
])

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function corsHeadersFor(request: Request) {
  const origin = request.headers.get("Origin") || ""
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "*"
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  }
}

function json(data: unknown, init: ResponseInit = {}, request?: Request): Response {
  return Response.json(data, { ...init, headers: { ...(request ? corsHeadersFor(request) : {}), ...(init.headers || {}) } })
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin")
  return !origin || ALLOWED_ORIGINS.has(origin)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

async function rateLimitKey(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown"
  const ua = request.headers.get("User-Agent") || "unknown"
  return sha256Hex(`${ip}|${ua}|feedback-v1`)
}

async function ensureRateLimitTable(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS feedback_rate_limits (
      key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (key, window_start)
    )
  `).run()
}

async function checkRateLimit(request: Request, env: Env): Promise<boolean> {
  await ensureRateLimitTable(env)
  const key = await rateLimitKey(request)
  const windowStart = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000)) * RATE_LIMIT_WINDOW_SECONDS
  await env.DB.prepare(`
    INSERT INTO feedback_rate_limits (key, window_start, count, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(key, window_start)
    DO UPDATE SET count = count + 1, updated_at = datetime('now')
  `).bind(key, windowStart).run()
  const row = await env.DB.prepare(
    "SELECT count FROM feedback_rate_limits WHERE key = ? AND window_start = ?"
  ).bind(key, windowStart).first<{ count: number }>()
  return (row?.count || 0) <= RATE_LIMIT_MAX_WRITES
}

function cleanText(value: unknown, maxBytes: number): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  if (byteLength(text) > maxBytes) throw new Error(`field too large; max ${maxBytes} bytes`)
  return text
}

function cleanNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(1000000, Math.floor(n))
}

function validateFeedbackBody(body: FeedbackBody) {
  const rating = cleanText(body.rating, MAX_RATING_BYTES)
  if (!rating) throw new Error("rating is required")
  const sessionData = cleanText(body.session_data, MAX_SESSION_DATA_BYTES)
  return {
    rating,
    task_summary: cleanText(body.task_summary, MAX_TASK_SUMMARY_BYTES),
    pua_level: cleanText(body.pua_level, 16) || "L0",
    pua_count: cleanNumber(body.pua_count, 0),
    flavor: cleanText(body.flavor, MAX_FLAVOR_BYTES) || "阿里",
    session_data: sessionData,
    failure_count: cleanNumber(body.failure_count, 0),
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const corsHeaders = corsHeadersFor(request)

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Detect POST: method=POST or has JSON Content-Type (custom domain may rewrite method)
  const hasJsonContentType = request.headers.get("content-type")?.includes("application/json")
  const isPost = request.method === "POST" || hasJsonContentType

  if (isPost) {
    if (!originAllowed(request)) {
      return json({ error: "Origin not allowed" }, { status: 403 }, request)
    }

    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: `Request body too large (max ${MAX_BODY_BYTES} bytes)` }, { status: 413 }, request)
    }

    let bodyText: string | null = null
    try { bodyText = await request.text() } catch {}

    if (bodyText && bodyText.length > 2) {
      if (byteLength(bodyText) > MAX_BODY_BYTES) {
        return json({ error: `Request body too large (max ${MAX_BODY_BYTES} bytes)` }, { status: 413 }, request)
      }

      try {
        const body = validateFeedbackBody(JSON.parse(bodyText) as FeedbackBody)
        const allowed = await checkRateLimit(request, env)
        if (!allowed) {
          return json({ error: "Rate limit exceeded" }, { status: 429 }, request)
        }

        if (body.session_data) {
          if (!env.SESSION_SECRET) {
            return json({ error: "Session upload is temporarily unavailable" }, { status: 500 }, request)
          }
          const session = await getSession(request, env.SESSION_SECRET)
          if (!session) {
            return json({ error: "Login required for session upload" }, { status: 401 }, request)
          }
        }

        await env.DB.prepare(
          `INSERT INTO feedback (rating, task_summary, pua_level, pua_count, flavor, session_data, failure_count, ip_country)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            body.rating,
            body.task_summary,
            body.pua_level,
            body.pua_count,
            body.flavor,
            body.session_data,
            body.failure_count,
            request.headers.get("CF-IPCountry") || "unknown"
          )
          .run()

        return json({ ok: true }, { headers: corsHeaders }, request)
      } catch (e) {
        const message = String((e as Error).message || e)
        const status = /too large/.test(message) ? 413 : (/required|Unexpected token|JSON/.test(message) ? 400 : 500)
        return json(
          { error: status === 500 ? "Failed to save feedback" : message },
          { status },
          request
        )
      }
    }
    // Body was empty/stripped — fall through to GET
  }

  // GET: aggregate stats
  const stats = await env.DB.prepare(
    `SELECT rating, COUNT(*) as count, AVG(pua_count) as avg_pua_count
     FROM feedback GROUP BY rating ORDER BY count DESC`
  ).all()

  const total = await env.DB.prepare(
    "SELECT COUNT(*) as total FROM feedback"
  ).first<{ total: number }>()

  return json({
    total_feedback: total?.total || 0,
    by_rating: stats.results,
  }, { headers: corsHeaders }, request)
}
