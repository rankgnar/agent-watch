import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { TraceRecord, SpanRecord, EventRecord, StatsResult } from '../types';
import { CREATE_TABLES_SQL } from './schema';

const DEFAULT_DB_PATH = join(homedir(), '.agent-watch', 'traces.db');

export class SQLiteStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.db.exec(CREATE_TABLES_SQL);
  }

  // ─────────────────────────── Traces ────────────────────────────

  saveTrace(trace: TraceRecord): void {
    this.db
      .prepare(`
        INSERT INTO traces (id, name, agent_name, start_time, end_time, status, metadata)
        VALUES (@id, @name, @agentName, @startTime, @endTime, @status, @metadata)
        ON CONFLICT(id) DO UPDATE SET
          end_time = excluded.end_time,
          status   = excluded.status,
          metadata = excluded.metadata
      `)
      .run({
        id: trace.id,
        name: trace.name,
        agentName: trace.agentName,
        startTime: trace.startTime,
        endTime: trace.endTime ?? null,
        status: trace.status,
        metadata: trace.metadata ? JSON.stringify(trace.metadata) : null,
      });
  }

  getTrace(id: string): TraceRecord | null {
    const row = this.db
      .prepare('SELECT * FROM traces WHERE id = ?')
      .get(id) as RawTrace | undefined;
    return row ? deserializeTrace(row) : null;
  }

  /**
   * Used by the instrumentation layer to check if a trace is still active.
   * Returns the trace record (which may be used to build a Span).
   */
  getActiveTrace(traceId: string): TraceRecord | null {
    const row = this.db
      .prepare("SELECT * FROM traces WHERE id = ? AND status = 'running'")
      .get(traceId) as RawTrace | undefined;
    return row ? deserializeTrace(row) : null;
  }

  listTraces(options: {
    limit?: number;
    agentName?: string;
    status?: string;
    since?: number;
  } = {}): TraceRecord[] {
    const { limit = 50, agentName, status, since } = options;
    const conditions: string[] = [];
    const params: Record<string, unknown> = { limit };

    if (agentName) { conditions.push('agent_name = @agentName'); params['agentName'] = agentName; }
    if (status) { conditions.push('status = @status'); params['status'] = status; }
    if (since) { conditions.push('start_time >= @since'); params['since'] = since; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM traces ${where} ORDER BY start_time DESC LIMIT @limit`)
      .all(params) as RawTrace[];
    return rows.map(deserializeTrace);
  }

  // ──────────────────────────── Spans ────────────────────────────

  saveSpan(span: SpanRecord): void {
    this.db
      .prepare(`
        INSERT INTO spans (id, trace_id, parent_span_id, name, start_time, end_time, status, attributes, error_message)
        VALUES (@id, @traceId, @parentSpanId, @name, @startTime, @endTime, @status, @attributes, @errorMessage)
        ON CONFLICT(id) DO UPDATE SET
          end_time      = excluded.end_time,
          status        = excluded.status,
          attributes    = excluded.attributes,
          error_message = excluded.error_message
      `)
      .run({
        id: span.id,
        traceId: span.traceId,
        parentSpanId: span.parentSpanId ?? null,
        name: span.name,
        startTime: span.startTime,
        endTime: span.endTime ?? null,
        status: span.status,
        attributes: span.attributes ? JSON.stringify(span.attributes) : null,
        errorMessage: span.errorMessage ?? null,
      });
  }

  getSpansForTrace(traceId: string): SpanRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC')
      .all(traceId) as RawSpan[];
    return rows.map(deserializeSpan);
  }

  // ──────────────────────────── Events ───────────────────────────

  saveEvent(event: EventRecord): void {
    this.db
      .prepare(`
        INSERT INTO events (id, trace_id, span_id, name, timestamp, data)
        VALUES (@id, @traceId, @spanId, @name, @timestamp, @data)
        ON CONFLICT(id) DO NOTHING
      `)
      .run({
        id: event.id,
        traceId: event.traceId,
        spanId: event.spanId ?? null,
        name: event.name,
        timestamp: event.timestamp,
        data: event.data ? JSON.stringify(event.data) : null,
      });
  }

  getEventsForTrace(traceId: string): EventRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE trace_id = ? ORDER BY timestamp ASC')
      .all(traceId) as RawEvent[];
    return rows.map(deserializeEvent);
  }

  // ────────────────────────── Analytics ──────────────────────────

  getStats(sinceMs?: number): StatsResult {
    const since = sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000; // last 7 days

    const total = (this.db
      .prepare('SELECT COUNT(*) as cnt FROM traces WHERE start_time >= ?')
      .get(since) as { cnt: number }).cnt;

    const errors = (this.db
      .prepare("SELECT COUNT(*) as cnt FROM traces WHERE status = 'error' AND start_time >= ?")
      .get(since) as { cnt: number }).cnt;

    const avgRow = this.db
      .prepare(`
        SELECT AVG(end_time - start_time) as avg
        FROM traces
        WHERE end_time IS NOT NULL AND start_time >= ?
      `)
      .get(since) as { avg: number | null };

    const topFailures = this.db
      .prepare(`
        SELECT name, COUNT(*) as count
        FROM traces
        WHERE status = 'error' AND start_time >= ?
        GROUP BY name
        ORDER BY count DESC
        LIMIT 10
      `)
      .all(since) as Array<{ name: string; count: number }>;

    const recent = (this.db
      .prepare('SELECT COUNT(*) as cnt FROM traces WHERE start_time >= ?')
      .get(Date.now() - 60 * 60 * 1000) as { cnt: number }).cnt;

    return {
      totalTraces: total,
      errorRate: total > 0 ? errors / total : 0,
      avgDurationMs: avgRow.avg ?? 0,
      topFailures,
      recentTraces: recent,
    };
  }

  close(): void {
    this.db.close();
  }
}

// ─────────────────────── Raw row types ────────────────────────

interface RawTrace {
  id: string;
  name: string;
  agent_name: string;
  start_time: number;
  end_time: number | null;
  status: string;
  metadata: string | null;
}

interface RawSpan {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  start_time: number;
  end_time: number | null;
  status: string;
  attributes: string | null;
  error_message: string | null;
}

interface RawEvent {
  id: string;
  trace_id: string;
  span_id: string | null;
  name: string;
  timestamp: number;
  data: string | null;
}

function deserializeTrace(row: RawTrace): TraceRecord {
  return {
    id: row.id,
    name: row.name,
    agentName: row.agent_name,
    startTime: row.start_time,
    endTime: row.end_time ?? undefined,
    status: row.status as TraceRecord['status'],
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

function deserializeSpan(row: RawSpan): SpanRecord {
  return {
    id: row.id,
    traceId: row.trace_id,
    parentSpanId: row.parent_span_id ?? undefined,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time ?? undefined,
    status: row.status as SpanRecord['status'],
    attributes: row.attributes ? JSON.parse(row.attributes) : undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function deserializeEvent(row: RawEvent): EventRecord {
  return {
    id: row.id,
    traceId: row.trace_id,
    spanId: row.span_id ?? undefined,
    name: row.name,
    timestamp: row.timestamp,
    data: row.data ? JSON.parse(row.data) : undefined,
  };
}
