import { getSession } from "./_session"
import { sanitize } from "./_sanitize"

interface Env {
  DB: D1Database
  UPLOADS: R2Bucket
  SESSION_SECRET: string
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function decodeHeaderValue(value: string | null, fieldName: string, fallback?: string): string {
  if (!value) {
    if (fallback !== undefined) return fallback
    throw new Error(`${fieldName} is required`)
  }
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return value.trim()
  }
}

function safeFileName(value: string): string {
  const base = value.split(/[\/]/).pop() || "session.jsonl"
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160)
  return cleaned.endsWith(".jsonl") ? cleaned : "session.jsonl"
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60
const RATE_LIMIT_MAX_UPLOADS = 20

async function ensureUploadRateLimitTable(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS upload_rate_limits (
      key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (key, window_start)
    )
  `).run()
}

async function rateLimitKey(request: Request): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown"
  const ua = request.headers.get("User-Agent") || "unknown"
  return sha256Hex(`${ip}|${ua}|upload-v1`)
}

async function checkAnonymousUploadRateLimit(request: Request, env: Env): Promise<boolean> {
  await ensureUploadRateLimitTable(env)
  const key = await rateLimitKey(request)
  const windowStart = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000)) * RATE_LIMIT_WINDOW_SECONDS
  await env.DB.prepare(`
    INSERT INTO upload_rate_limits (key, window_start, count, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(key, window_start)
    DO UPDATE SET count = count + 1, updated_at = datetime('now')
  `).bind(key, windowStart).run()
  const row = await env.DB.prepare(
    "SELECT count FROM upload_rate_limits WHERE key = ? AND window_start = ?"
  ).bind(key, windowStart).first<{ count: number }>()
  await env.DB.prepare("DELETE FROM upload_rate_limits WHERE window_start < ?")
    .bind(windowStart - RATE_LIMIT_WINDOW_SECONDS * 24).run()
  return (row?.count || 0) <= RATE_LIMIT_MAX_UPLOADS
}

// Use single onRequest handler — custom domains may not route onRequestPost correctly
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSession(request, env.SESSION_SECRET)

  // Detect upload: raw JSONL text (preferred), JSON with file_data (compat), or multipart form.
  const contentType = request.headers.get("content-type") || ""
  const isRawJsonlUpload = contentType.includes("application/jsonl") || contentType.includes("text/plain")
  const isJsonUpload = contentType.includes("application/json") && !isRawJsonlUpload
  const isMultipartUpload = contentType.includes("multipart/form-data")
  const isUpload = isRawJsonlUpload || isJsonUpload || isMultipartUpload || request.method === "POST"

  if (!isUpload) {
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
    // GET: list user's uploads
    const { results } = await env.DB.prepare(
      "SELECT file_name, file_size, created_at FROM uploads WHERE github_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(session.id).all()
    return Response.json({ uploads: results })
  }

  const isAnonymousUpload = !session
  if (isAnonymousUpload) {
    const consent = request.headers.get("X-PUA-Upload-Consent") || ""
    if (consent.toLowerCase() !== "explicit") {
      return Response.json({ error: "Explicit upload consent required" }, { status: 403 })
    }
    const allowed = await checkAnonymousUploadRateLimit(request, env)
    if (!allowed) {
      return Response.json({ error: "Rate limit exceeded" }, { status: 429 })
    }
  }

  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "File too large (max 50MB)" }, { status: 400 })
  }

  // POST: upload file
  try {
    let raw: string
    let fileName: string
    let wechatId: string
    let originalSize: number

    if (isRawJsonlUpload) {
      fileName = decodeHeaderValue(request.headers.get("X-PUA-File-Name"), "file_name")
      wechatId = decodeHeaderValue(request.headers.get("X-PUA-Wechat-Id"), "wechat_id", "not-provided")
      if (!fileName.endsWith(".jsonl")) {
        return Response.json({ error: "Only .jsonl files are accepted" }, { status: 400 })
      }
      raw = await request.text()
      if (!raw.trim()) {
        return Response.json({ error: "File is empty" }, { status: 400 })
      }
      originalSize = byteLength(raw)
    } else if (isJsonUpload) {
      // JSON body with base64 file_data (compat path for older clients)
      // Guard: read as text first — if body is empty (POST→GET rewrite strips body), return 400 instead of crashing
      const rawText = await request.text()
      if (!rawText || !rawText.trim()) {
        return Response.json({
          error: "Empty request body — the upload was likely intercepted by a proxy that stripped the POST body. Try refreshing and uploading again, or report this to the admin."
        }, { status: 400 })
      }
      let body: { file_name?: string; file_data?: string; wechat_id?: string }
      try {
        body = JSON.parse(rawText)
      } catch (parseErr) {
        return Response.json({ error: "Invalid JSON body: " + String(parseErr) }, { status: 400 })
      }
      if (!body.file_data || !body.file_name) {
        return Response.json({ error: "file_name and file_data are required" }, { status: 400 })
      }
      if (!body.wechat_id?.trim()) {
        return Response.json({ error: "WeChat ID is required" }, { status: 400 })
      }
      if (!body.file_name.endsWith(".jsonl")) {
        return Response.json({ error: "Only .jsonl files are accepted" }, { status: 400 })
      }
      // Decode base64
      const binaryStr = atob(body.file_data)
      raw = new TextDecoder().decode(Uint8Array.from(binaryStr, c => c.charCodeAt(0)))
      fileName = body.file_name
      wechatId = body.wechat_id.trim()
      originalSize = byteLength(raw)
    } else {
      // Multipart form data (original path)
      const formData = await request.formData()
      const file = formData.get("file") as File | null
      const wid = formData.get("wechat_id") as string | null
      if (!file) {
        return Response.json({ error: "No file provided" }, { status: 400 })
      }
      if (!wid?.trim()) {
        return Response.json({ error: "WeChat ID is required" }, { status: 400 })
      }
      if (!file.name.endsWith(".jsonl")) {
        return Response.json({ error: "Only .jsonl files are accepted" }, { status: 400 })
      }
      if (file.size > 50 * 1024 * 1024) {
        return Response.json({ error: "File too large (max 50MB)" }, { status: 400 })
      }
      raw = await file.text()
      fileName = file.name
      wechatId = wid.trim()
      originalSize = file.size
    }

    fileName = safeFileName(fileName)
    if (originalSize > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "File too large (max 50MB)" }, { status: 400 })
    }
    let sanitized: string
    try {
      sanitized = sanitize(raw)
    } catch (e) {
      return Response.json({ error: "Sanitization failed: " + String(e) }, { status: 422 })
    }

    const uploaderLogin = session?.login || "anonymous"
    const uploaderId = session?.id || `anonymous:${(await rateLimitKey(request)).slice(0, 16)}`

    // Upload sanitized content to R2
    const key = `${uploaderLogin}/${Date.now()}-${fileName}`
    await env.UPLOADS.put(key, sanitized, {
      httpMetadata: { contentType: "application/jsonl" },
      customMetadata: {
        github_id: uploaderId,
        github_login: uploaderLogin,
        wechat_id: wechatId.trim() || "not-provided",
        upload_mode: session ? "authenticated" : "anonymous",
      },
    })

    // Record sanitized byte length (post-sanitization size, not original)
    const sanitizedSize = new TextEncoder().encode(sanitized).byteLength
    await env.DB.prepare(
      "INSERT INTO uploads (github_id, github_login, wechat_id, file_key, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(uploaderId, uploaderLogin, wechatId || "not-provided", key, fileName, sanitizedSize).run()

    // Send email notification (fire-and-forget)
    const sizeMB = (originalSize / 1024 / 1024).toFixed(2)
    const emailBody = [
      `New PUA Skill data upload:`,
      ``,
      `Uploader: ${uploaderLogin} (${uploaderId})`,
      `Mode: ${session ? "authenticated" : "anonymous"}`,
      `WeChat: ${wechatId || "not-provided"}`,
      `File: ${fileName} (${sizeMB} MB)`,
      `R2 Key: ${key}`,
      `Time: ${new Date().toISOString()}`,
    ].join("\n")

    fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: "xsser.w@gmail.com", name: "PUA Admin" }] }],
        from: { email: "noreply@pua-skill.pages.dev", name: "PUA Skill Upload" },
        subject: `[PUA Upload] ${uploaderLogin} uploaded ${fileName}`,
        content: [{ type: "text/plain", value: emailBody }],
      }),
    }).catch(() => {})

    return Response.json({ ok: true, key, file_name: fileName, file_size: originalSize })
  } catch (e) {
    return Response.json({ error: "Upload failed: " + String(e) }, { status: 500 })
  }
}
