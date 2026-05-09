# Silent Heartbeat + Cloudflare Active-User Stats Design

## Goal

Add active-user visibility for PUA Skill without polluting Claude conversations. The heartbeat must be a mechanical hook-side signal, not prompt content: no `additionalContext`, no stdout/stderr, no text the model can echo.

## Architecture

- **Action side:** `hooks/heartbeat.sh` runs on `SessionStart`, before `session-restore.sh`.
- **Conversation boundary:** heartbeat writes nothing to stdout/stderr and never appears in `skills/pua/SKILL.md` or SessionStart context.
- **Privacy gates:** `offline=true`, `telemetry=false`, or `feedback_frequency=0` disables heartbeat before creating a local install id.
- **Telemetry identity:** local random `~/.pua/install_id`; Cloudflare stores only SHA-256 hashes.
- **Cloudflare side:** `/api/heartbeat` accepts minimal POST events and authenticated admin GET stats.
- **Admin page:** `#/admin/heartbeats` shows active installs/sessions by day, version, platform, and flavor.

## Data Flow

```mermaid
flowchart LR
  SessionStart --> HeartbeatHook[hooks/heartbeat.sh]
  HeartbeatHook -->|silent POST| CF[/api/heartbeat]
  CF --> D1[(D1: heartbeat_installs/events)]
  Admin[GitHub-auth admin] --> Stats[#/admin/heartbeats]
  Stats --> CF
```

## Mechanical Gates

1. Hook silence gate: runtime test proves no stdout/stderr even when network fails.
2. Context leak gate: SessionStart additionalContext must not contain heartbeat endpoint/id words.
3. Privacy gate: offline mode must not create telemetry identity.
4. Admin gate: GET stats requires signed session + GitHub allowlist.
5. Abuse gate: POST body size limit, origin allowlist when Origin exists, per-IP/UA rate limit.

## INTJ Note

The design separates **measurement** from **narrative**. If telemetry is placed in the skill prompt, it becomes part of the model's story and can leak into outputs. If telemetry is placed in a silent hook with tests, it becomes an institution-level control: observable to the owner, invisible to the worker context.
