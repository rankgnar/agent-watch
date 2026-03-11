/**
 * Core types for agent-watch observability SDK.
 */

export type SpanStatus = 'ok' | 'error' | 'running';

export interface TraceRecord {
  id: string;
  name: string;
  agentName: string;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  metadata?: Record<string, unknown>;
}

export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes?: Record<string, unknown>;
  errorMessage?: string;
}

export interface EventRecord {
  id: string;
  traceId: string;
  spanId?: string;
  name: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface TracerConfig {
  /** Agent name — appears in all traces */
  name: string;
  /** Storage backend. Currently only 'sqlite' is supported. */
  store: 'sqlite';
  /** Path to the SQLite database file. Defaults to ~/.agent-watch/traces.db */
  dbPath?: string;
}

export interface TraceOptions {
  metadata?: Record<string, unknown>;
}

export interface SpanOptions {
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
}

export interface StatsResult {
  totalTraces: number;
  errorRate: number;
  avgDurationMs: number;
  topFailures: Array<{ name: string; count: number }>;
  recentTraces: number;
}
