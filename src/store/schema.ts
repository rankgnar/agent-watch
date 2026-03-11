/**
 * SQLite schema for agent-watch storage.
 *
 * Tables:
 *   traces — top-level trace records
 *   spans  — individual span records belonging to a trace
 *   events — discrete events attached to a trace or span
 */

export const CREATE_TABLES_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS traces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  agent_name  TEXT NOT NULL,
  start_time  INTEGER NOT NULL,
  end_time    INTEGER,
  status      TEXT NOT NULL DEFAULT 'running',
  metadata    TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_traces_agent ON traces (agent_name);
CREATE INDEX IF NOT EXISTS idx_traces_status ON traces (status);
CREATE INDEX IF NOT EXISTS idx_traces_start_time ON traces (start_time DESC);

CREATE TABLE IF NOT EXISTS spans (
  id             TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  parent_span_id TEXT,
  name           TEXT NOT NULL,
  start_time     INTEGER NOT NULL,
  end_time       INTEGER,
  status         TEXT NOT NULL DEFAULT 'running',
  attributes     TEXT,
  error_message  TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON spans (parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_status ON spans (status);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  trace_id   TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  span_id    TEXT REFERENCES spans(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  timestamp  INTEGER NOT NULL,
  data       TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_events_trace ON events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_span ON events (span_id);
`;
