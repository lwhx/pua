import { getSession } from "./_session"

interface Env {
  DB: D1Database
  SESSION_SECRET: string
  ADMIN_GITHUB_LOGINS?: string
}

type HeartbeatBody = {
  install_id?: string
  plugin_version?: string
  platform?: string
  event_name?: string
  flavor?: string
}

type CountRow = {
  total_installs: number
  active_24h: number
  active_7d: number
  active_30d: number
  sessions_24h: number
  sessions_7d: number
  sessions_30d: number
}

const MAX_BODY_BYTES = 4 * 1024
const MAX_INSTALL_ID_BYTES = 128
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_MAX_WRITES = 120

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

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin")
  return !origin || ALLOWED_ORIGINS.has(origin)
}

function json(data: unknown, init: ResponseInit = {}, request?: Request): Response {
  return Response.json(data, { ...init, headers: { ...(request ? corsHeadersFor(request) : {}), ...(init.headers || {}) } })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function cleanText(value: unknown, maxBytes: number, fallback = ""): string {
  if (value === undefined || value === null) return fallback
  const text = String(value).trim()
  if (!text) return fallback
  if (byteLength(text) > maxBytes) throw new Error(`field too large; max ${maxBytes} bytes`)
  return text
}

function cleanEnumText(value: unknown, maxBytes: number, fallback: string): string {
  const text = cleanText(value, maxBytes, fallback)
  const normalized = text.replace(/[^a-zA-Z0-9_.:/@ -]/g, "").trim().slice(0, maxBytes)
  return normalized || fallback
}

function validateHeartbeatBody(body: HeartbeatBody) {
  const installId = cleanText(body.install_id, MAX_INSTALL_ID_BYTES)
  if (!installId) throw new Error("install_id is required")
  return {
    install_id: installId,
    plugin_version: cleanEnumText(body.plugin_version, 48, "unknown"),
    platform: cleanEnumText(body.platform, 64, "claude-code"),
    event_name: cleanEnumText(body.event_name, 64, "session_start") || "session_start",
    flavor: cleanEnumText(body.flavor, 64, "unknown"),
  }
}

async function rateLimitKey(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown"
  const ua = request.headers.get("User-Agent") || "unknown"
  return sha256Hex(`${ip}|${ua}|heartbeat-v1`)
}

async function ensureHeartbeatTables(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS heartbeat_installs (
      install_id_hash TEXT PRIMARY KEY,
      first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      session_count INTEGER NOT NULL DEFAULT 0,
      last_plugin_version TEXT,
      last_platform TEXT,
      last_flavor TEXT,
      last_ip_country TEXT,
      last_user_agent_hash TEXT
    )
  `).run()
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS heartbeat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      install_id_hash TEXT NOT NULL,
      event_name TEXT NOT NULL DEFAULT 'session_start',
      plugin_version TEXT,
      platform TEXT,
      flavor TEXT,
      ip_country TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run()
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS heartbeat_rate_limits (
      key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (key, window_start)
    )
  `).run()
}

async function checkRateLimit(request: Request, env: Env): Promise<boolean> {
  await ensureHeartbeatTables(env)
  const key = await rateLimitKey(request)
  const windowStart = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000)) * RATE_LIMIT_WINDOW_SECONDS
  await env.DB.prepare(`
    INSERT INTO heartbeat_rate_limits (key, window_start, count, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(key, window_start)
    DO UPDATE SET count = count + 1, updated_at = datetime('now')
  `).bind(key, windowStart).run()
  const row = await env.DB.prepare(
    "SELECT count FROM heartbeat_rate_limits WHERE key = ? AND window_start = ?"
  ).bind(key, windowStart).first<{ count: number }>()
  await env.DB.prepare(
    "DELETE FROM heartbeat_rate_limits WHERE window_start < ?"
  ).bind(windowStart - RATE_LIMIT_WINDOW_SECONDS * 60).run()
  return (row?.count || 0) <= RATE_LIMIT_MAX_WRITES
}

function adminLogins(env: Env): Set<string> {
  const configured = (env.ADMIN_GITHUB_LOGINS || "tanweai,xsser")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  return new Set(configured)
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  if (!originAllowed(request)) {
    return json({ error: "Origin not allowed" }, { status: 403 }, request)
  }

  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: `Request body too large (max ${MAX_BODY_BYTES} bytes)` }, { status: 413 }, request)
  }

  let bodyText = ""
  try { bodyText = await request.text() } catch {}
  if (!bodyText) return json({ error: "JSON body required" }, { status: 400 }, request)
  if (byteLength(bodyText) > MAX_BODY_BYTES) {
    return json({ error: `Request body too large (max ${MAX_BODY_BYTES} bytes)` }, { status: 413 }, request)
  }

  try {
    const body = validateHeartbeatBody(JSON.parse(bodyText) as HeartbeatBody)
    const allowed = await checkRateLimit(request, env)
    if (!allowed) return json({ error: "Rate limit exceeded" }, { status: 429 }, request)

    const installIdHash = await sha256Hex(`pua-install:${body.install_id}`)
    const userAgent = request.headers.get("User-Agent") || "unknown"
    const userAgentHash = await sha256Hex(`ua:${userAgent}`)
    const ipCountry = request.headers.get("CF-IPCountry") || "unknown"

    await env.DB.prepare(`
      INSERT INTO heartbeat_installs (
        install_id_hash, first_seen, last_seen, session_count,
        last_plugin_version, last_platform, last_flavor, last_ip_country, last_user_agent_hash
      ) VALUES (?, datetime('now'), datetime('now'), 1, ?, ?, ?, ?, ?)
      ON CONFLICT(install_id_hash)
      DO UPDATE SET
        last_seen = datetime('now'),
        session_count = session_count + 1,
        last_plugin_version = excluded.last_plugin_version,
        last_platform = excluded.last_platform,
        last_flavor = excluded.last_flavor,
        last_ip_country = excluded.last_ip_country,
        last_user_agent_hash = excluded.last_user_agent_hash
    `).bind(
      installIdHash,
      body.plugin_version,
      body.platform,
      body.flavor,
      ipCountry,
      userAgentHash
    ).run()

    await env.DB.prepare(`
      INSERT INTO heartbeat_events (install_id_hash, event_name, plugin_version, platform, flavor, ip_country, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      installIdHash,
      body.event_name,
      body.plugin_version,
      body.platform,
      body.flavor,
      ipCountry
    ).run()

    return json({ ok: true }, {}, request)
  } catch (e) {
    const message = String((e as Error).message || e)
    const status = /too large/.test(message) ? 413 : (/required|Unexpected token|JSON/.test(message) ? 400 : 500)
    return json({ error: status === 500 ? "Failed to save heartbeat" : message }, { status }, request)
  }
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  if (!env.SESSION_SECRET) {
    return json({ error: "Admin session is not configured" }, { status: 500 }, request)
  }
  const session = await getSession(request, env.SESSION_SECRET)
  if (!session) return json({ error: "Login required" }, { status: 401 }, request)
  if (!adminLogins(env).has(session.login.toLowerCase())) {
    return json({ error: "Admin access required" }, { status: 403 }, request)
  }

  await ensureHeartbeatTables(env)
  const totals = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM heartbeat_installs) AS total_installs,
      (SELECT COUNT(*) FROM heartbeat_installs WHERE last_seen >= datetime('now', '-1 day')) AS active_24h,
      (SELECT COUNT(*) FROM heartbeat_installs WHERE last_seen >= datetime('now', '-7 days')) AS active_7d,
      (SELECT COUNT(*) FROM heartbeat_installs WHERE last_seen >= datetime('now', '-30 days')) AS active_30d,
      (SELECT COUNT(*) FROM heartbeat_events WHERE created_at >= datetime('now', '-1 day')) AS sessions_24h,
      (SELECT COUNT(*) FROM heartbeat_events WHERE created_at >= datetime('now', '-7 days')) AS sessions_7d,
      (SELECT COUNT(*) FROM heartbeat_events WHERE created_at >= datetime('now', '-30 days')) AS sessions_30d
  `).first<CountRow>()

  const daily = await env.DB.prepare(`
    SELECT date(created_at) AS day, COUNT(DISTINCT install_id_hash) AS active_users, COUNT(*) AS sessions
    FROM heartbeat_events
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY day
    ORDER BY day DESC
  `).all()

  const byVersion = await env.DB.prepare(`
    SELECT COALESCE(plugin_version, 'unknown') AS plugin_version,
           COUNT(DISTINCT install_id_hash) AS active_users,
           COUNT(*) AS sessions
    FROM heartbeat_events
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY plugin_version
    ORDER BY active_users DESC, sessions DESC
    LIMIT 20
  `).all()

  const byPlatform = await env.DB.prepare(`
    SELECT COALESCE(platform, 'unknown') AS platform,
           COUNT(DISTINCT install_id_hash) AS active_users,
           COUNT(*) AS sessions
    FROM heartbeat_events
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY platform
    ORDER BY active_users DESC, sessions DESC
    LIMIT 20
  `).all()

  const byFlavor = await env.DB.prepare(`
    SELECT COALESCE(flavor, 'unknown') AS flavor,
           COUNT(DISTINCT install_id_hash) AS active_users,
           COUNT(*) AS sessions
    FROM heartbeat_events
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY flavor
    ORDER BY active_users DESC, sessions DESC
    LIMIT 20
  `).all()

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    viewer: { login: session.login, avatar: session.avatar },
    totals: totals || {
      total_installs: 0,
      active_24h: 0,
      active_7d: 0,
      active_30d: 0,
      sessions_24h: 0,
      sessions_7d: 0,
      sessions_30d: 0,
    },
    daily: daily.results,
    by_version: byVersion.results,
    by_platform: byPlatform.results,
    by_flavor: byFlavor.results,
  }, {}, request)
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(request) })
  }
  if (request.method === "POST") return handlePost(request, env)
  if (request.method === "GET") return handleGet(request, env)
  return json({ error: "Method not allowed" }, { status: 405 }, request)
}
