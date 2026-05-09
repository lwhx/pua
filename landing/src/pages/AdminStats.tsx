import { useEffect, useState } from "react"
import type { Lang } from "../i18n"

type Totals = {
  total_installs: number
  active_24h: number
  active_7d: number
  active_30d: number
  sessions_24h: number
  sessions_7d: number
  sessions_30d: number
}

type DailyRow = { day: string; active_users: number; sessions: number }
type BreakdownRow = { active_users: number; sessions: number; [key: string]: string | number }

type StatsData = {
  ok: true
  generated_at: string
  viewer: { login: string; avatar: string }
  totals: Totals
  daily: DailyRow[]
  by_version: BreakdownRow[]
  by_platform: BreakdownRow[]
  by_flavor: BreakdownRow[]
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: StatsData }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "error"; message: string }

interface Props {
  lang: Lang
}

function cardStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--border)",
    borderRadius: "1rem",
    background: "var(--bg)",
    padding: "1.25rem",
    boxShadow: "0 12px 40px rgba(15, 23, 42, 0.06)",
  }
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div style={cardStyle()}>
      <div style={{ color: "var(--text-muted)", fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ marginTop: "0.45rem", fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.04em" }}>{value.toLocaleString()}</div>
      {hint && <div style={{ marginTop: "0.35rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>{hint}</div>}
    </div>
  )
}

function BreakdownTable({ title, rows, labelKey }: { title: string; rows: BreakdownRow[]; labelKey: string }) {
  return (
    <section style={cardStyle()}>
      <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", letterSpacing: "-0.02em" }}>{title}</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
              <th style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>Segment</th>
              <th style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Active users</th>
              <th style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={String(row[labelKey])}>
                <td style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{String(row[labelKey] || "unknown")}</td>
                <td style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{Number(row.active_users || 0).toLocaleString()}</td>
                <td style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{Number(row.sessions || 0).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} style={{ padding: "1rem 0", color: "var(--text-muted)" }}>No data yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function AdminStats({ lang }: Props) {
  const L = (zh: string, en: string) => (lang === "zh" ? zh : en)
  const [state, setState] = useState<LoadState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    fetch("/api/heartbeat", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) return { kind: "unauthorized" as const }
        if (response.status === 403) return { kind: "forbidden" as const }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return { kind: "ready" as const, data: await response.json() as StatsData }
      })
      .then((result) => {
        if (cancelled) return
        if (result.kind === "ready") setState({ status: "ready", data: result.data })
        if (result.kind === "unauthorized") setState({ status: "unauthorized" })
        if (result.kind === "forbidden") setState({ status: "forbidden" })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: "error", message: error.message })
      })
    return () => { cancelled = true }
  }, [])

  const header = (
    <div style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "1.5rem" }}>
      <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
        <a href="/" style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontWeight: 800, fontSize: "1.35rem", letterSpacing: "-0.04em" }}>pua</span>
          <span style={{ color: "var(--text-muted)" }}>/</span>
          <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>{L("活跃统计", "Heartbeat Stats")}</span>
        </a>
        {state.status === "ready" && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            <img src={state.data.viewer.avatar} alt={state.data.viewer.login} style={{ width: "1.8rem", height: "1.8rem", borderRadius: "999px" }} />
            <span>{state.data.viewer.login}</span>
          </div>
        )}
      </div>
    </div>
  )

  if (state.status === "loading") {
    return <div style={{ minHeight: "100vh", background: "var(--bg-alt)" }}>{header}<div className="container" style={{ padding: "3rem 1.5rem", color: "var(--text-muted)" }}>Loading...</div></div>
  }

  if (state.status === "unauthorized" || state.status === "forbidden" || state.status === "error") {
    const message = state.status === "unauthorized"
      ? L("需要先用 GitHub 登录。", "GitHub login is required.")
      : state.status === "forbidden"
        ? L("当前 GitHub 账号不在管理员白名单。", "This GitHub account is not on the admin allowlist.")
        : state.message
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg-alt)" }}>
        {header}
        <main className="container" style={{ padding: "3rem 1.5rem" }}>
          <section style={{ ...cardStyle(), maxWidth: "34rem", margin: "0 auto", textAlign: "center" }}>
            <h1 style={{ margin: "0 0 0.75rem", fontSize: "1.5rem", letterSpacing: "-0.03em" }}>{L("管理员统计", "Admin Stats")}</h1>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.7 }}>{message}</p>
            {state.status === "unauthorized" && <a href="/api/auth/github" className="btn-primary" style={{ marginTop: "1rem", display: "inline-flex" }}>{L("使用 GitHub 登录", "Login with GitHub")}</a>}
          </section>
        </main>
      </div>
    )
  }

  const { totals } = state.data

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-alt)" }}>
      {header}
      <main className="container" style={{ padding: "3rem 1.5rem" }}>
        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ margin: 0, fontSize: "2.2rem", letterSpacing: "-0.05em" }}>{L("PUA Skill 活跃用户", "PUA Skill Active Users")}</h1>
          <p style={{ color: "var(--text-muted)", lineHeight: 1.7, maxWidth: "48rem" }}>
            {L("只展示匿名聚合数据：安装标识只以 SHA-256 哈希保存，页面需要管理员 GitHub 登录。", "Anonymous aggregate data only: install identifiers are stored as SHA-256 hashes and this page requires admin GitHub login.")}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>Generated at {state.data.generated_at}</p>
        </div>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
          <StatCard label="Total installs" value={totals.total_installs} />
          <StatCard label="Active 24h" value={totals.active_24h} hint={`${totals.sessions_24h.toLocaleString()} sessions`} />
          <StatCard label="Active 7d" value={totals.active_7d} hint={`${totals.sessions_7d.toLocaleString()} sessions`} />
          <StatCard label="Active 30d" value={totals.active_30d} hint={`${totals.sessions_30d.toLocaleString()} sessions`} />
        </section>

        <section style={{ ...cardStyle(), marginBottom: "1.25rem" }}>
          <h2 style={{ margin: "0 0 1rem", fontSize: "1rem", letterSpacing: "-0.02em" }}>{L("最近 30 天", "Last 30 days")}</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>Day</th>
                  <th style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Active users</th>
                  <th style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {state.data.daily.map((row) => (
                  <tr key={row.day}>
                    <td style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{row.day}</td>
                    <td style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{row.active_users.toLocaleString()}</td>
                    <td style={{ padding: "0.6rem 0", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{row.sessions.toLocaleString()}</td>
                  </tr>
                ))}
                {state.data.daily.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: "1rem 0", color: "var(--text-muted)" }}>No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))", gap: "1rem" }}>
          <BreakdownTable title="By version" rows={state.data.by_version} labelKey="plugin_version" />
          <BreakdownTable title="By platform" rows={state.data.by_platform} labelKey="platform" />
          <BreakdownTable title="By flavor" rows={state.data.by_flavor} labelKey="flavor" />
        </div>
      </main>
    </div>
  )
}
