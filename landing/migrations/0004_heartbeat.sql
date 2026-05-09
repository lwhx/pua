-- Silent heartbeat telemetry: anonymous install aggregates + admin stats.
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
);

CREATE TABLE IF NOT EXISTS heartbeat_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  install_id_hash TEXT NOT NULL,
  event_name TEXT NOT NULL DEFAULT 'session_start',
  plugin_version TEXT,
  platform TEXT,
  flavor TEXT,
  ip_country TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS heartbeat_rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_installs_last_seen ON heartbeat_installs(last_seen);
CREATE INDEX IF NOT EXISTS idx_heartbeat_events_created_at ON heartbeat_events(created_at);
CREATE INDEX IF NOT EXISTS idx_heartbeat_events_version ON heartbeat_events(plugin_version, created_at);
CREATE INDEX IF NOT EXISTS idx_heartbeat_events_platform ON heartbeat_events(platform, created_at);
CREATE INDEX IF NOT EXISTS idx_heartbeat_events_flavor ON heartbeat_events(flavor, created_at);
