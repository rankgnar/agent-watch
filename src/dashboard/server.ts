import express from 'express';
import { join } from 'path';
import { SQLiteStore } from '../store/sqlite';

interface DashboardOptions {
  port: number;
  host: string;
  dbPath?: string;
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  const { port, host, dbPath } = options;
  const store = new SQLiteStore(dbPath);
  const app = express();

  app.use(express.json());

  // Serve static dashboard
  app.use(express.static(join(__dirname, 'public')));

  // ── API ────────────────────────────────────────────────────────

  /** GET /api/traces — list recent traces with optional filters */
  app.get('/api/traces', (req, res) => {
    const limit = parseInt((req.query['limit'] as string) ?? '50', 10);
    const agentName = (req.query['agent'] as string) || undefined;
    const status = (req.query['status'] as string) || undefined;
    const sinceHours = parseFloat((req.query['since'] as string) ?? '168');
    const since = Date.now() - sinceHours * 60 * 60 * 1000;

    const traces = store.listTraces({ limit, agentName, status, since });
    res.json({ traces });
  });

  /** GET /api/traces/:id — get a single trace with its spans */
  app.get('/api/traces/:id', (req, res) => {
    const { id } = req.params;
    const trace = store.getTrace(id);
    if (!trace) {
      res.status(404).json({ error: 'Trace not found' });
      return;
    }
    const spans = store.getSpansForTrace(id);
    const events = store.getEventsForTrace(id);
    res.json({ trace, spans, events });
  });

  /** GET /api/stats — summary metrics */
  app.get('/api/stats', (req, res) => {
    const sinceHours = parseFloat((req.query['since'] as string) ?? '168');
    const since = Date.now() - sinceHours * 60 * 60 * 1000;
    const stats = store.getStats(since);
    res.json(stats);
  });

  /** GET /api/agents — list unique agent names */
  app.get('/api/agents', (_req, res) => {
    const traces = store.listTraces({ limit: 1000 });
    const agents = [...new Set(traces.map((t) => t.agentName))].sort();
    res.json({ agents });
  });

  // ── Fallback to SPA ────────────────────────────────────────────
  app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
  });

  return new Promise((resolve) => {
    app.listen(port, host, () => {
      resolve();
    });
  });
}
