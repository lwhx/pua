import { describe, expect, it } from "vitest"
import { onRequest } from "../../functions/api/upload"

async function createSessionCookie(data: unknown, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify(data))
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  const encodedSig = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return `${payload}.${encodedSig}`
}

function createMockEnv(secret: string) {
  const dbWrites: Array<{ sql: string; args: unknown[] }> = []
  const r2Writes: Array<{ key: string; value: string; options: unknown }> = []
  return {
    env: {
      SESSION_SECRET: secret,
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              return {
                async run() {
                  dbWrites.push({ sql, args })
                  return { success: true }
                },
                async all() {
                  return { results: [] }
                },
                async first() {
                  return null
                },
              }
            },
          }
        },
      },
      UPLOADS: {
        async put(key: string, value: string, options: unknown) {
          r2Writes.push({ key, value, options })
        },
      },
    },
    dbWrites,
    r2Writes,
  }
}

async function expectSuccessfulUpload(response: Response, dbWrites: Array<{ sql: string }>, r2Writes: Array<{ key: string; value: string }>) {
  const body = await response.json() as { ok?: boolean; error?: string; file_name?: string }
  expect(response.status).toBe(200)
  expect(body).toMatchObject({ ok: true, file_name: "session.jsonl" })
  expect(r2Writes).toHaveLength(1)
  expect(r2Writes[0].key).toMatch(/^tanweai\/\d+-session\.jsonl$/)
  expect(r2Writes[0].value).toContain("[API_KEY]")
  expect(r2Writes[0].value).toContain("[EMAIL]")
  expect(r2Writes[0].value).not.toContain("sk-ant-123456789012345678901234567890")
  expect(r2Writes[0].value).not.toContain("user@example.com")
  expect(dbWrites.some((write) => write.sql.includes("INSERT INTO uploads"))).toBe(true)
}

describe("upload API", () => {
  it("accepts authenticated raw JSONL uploads, sanitizes them, stores R2 data, and records D1 metadata", async () => {
    const secret = "test-session-secret"
    const session = await createSessionCookie(
      { id: "42", login: "tanweai", avatar: "https://example.com/avatar.png" },
      secret,
    )
    const rawJsonl = '{"content":"token sk-ant-123456789012345678901234567890 and user@example.com"}\n'
    const { env, dbWrites, r2Writes } = createMockEnv(secret)
    const request = new Request("https://openpua.ai/api/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/jsonl; charset=utf-8",
        "X-PUA-File-Name": encodeURIComponent("session.jsonl"),
        "X-PUA-Wechat-Id": encodeURIComponent("wx-test"),
        Cookie: `pua_session=${session}`,
      },
      body: rawJsonl,
    })

    const response = await onRequest({ request, env } as any)
    await expectSuccessfulUpload(response, dbWrites, r2Writes)
  })

  it("keeps authenticated JSON file_data compatibility for older clients", async () => {
    const secret = "test-session-secret"
    const session = await createSessionCookie(
      { id: "42", login: "tanweai", avatar: "https://example.com/avatar.png" },
      secret,
    )
    const rawJsonl = '{"content":"token sk-ant-123456789012345678901234567890 and user@example.com"}\n'
    const { env, dbWrites, r2Writes } = createMockEnv(secret)
    const request = new Request("https://openpua.ai/api/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `pua_session=${session}`,
      },
      body: JSON.stringify({
        file_name: "session.jsonl",
        file_data: btoa(rawJsonl),
        wechat_id: "wx-test",
      }),
    })

    const response = await onRequest({ request, env } as any)
    await expectSuccessfulUpload(response, dbWrites, r2Writes)
  })
})
