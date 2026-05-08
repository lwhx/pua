-- Abuse controls for unauthenticated feedback endpoint.
CREATE TABLE IF NOT EXISTS feedback_rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_feedback_rate_limits_updated
  ON feedback_rate_limits(updated_at);
