/**
 * auto-config.ts — Optional configuration for agent-watch auto-instrumentation.
 *
 * All settings are driven by environment variables so users never need to touch
 * their code after adding `require('agent-watch/auto')`.
 *
 * Env vars:
 *   AGENT_WATCH_NAME       Agent name shown in the dashboard (default: script filename)
 *   AGENT_WATCH_DB         Path to the SQLite DB (default: ~/.agent-watch/traces.db)
 *   AGENT_WATCH_DISABLED   Set to "true" to disable without removing the require line
 *   AGENT_WATCH_DASHBOARD  Set to "true" to auto-start the dashboard on port 4200
 */

import { basename } from 'path';

export interface AutoConfig {
  /** Agent name shown in traces and the dashboard. */
  agentName: string;
  /** Resolved DB path, or undefined to use the default (~/.agent-watch/traces.db). */
  dbPath: string | undefined;
  /** When true, all instrumentation is skipped silently. */
  disabled: boolean;
  /** When true, the dashboard HTTP server is started automatically. */
  startDashboard: boolean;
  /** Dashboard port (always 4200 in auto mode). */
  port: number;
}

/**
 * Load and resolve configuration from environment variables.
 * Called once at module load time by auto.ts.
 */
export function loadAutoConfig(): AutoConfig {
  const disabled = process.env['AGENT_WATCH_DISABLED'] === 'true';

  // Derive a human-readable agent name from the entry-point script if not set.
  let agentName = process.env['AGENT_WATCH_NAME'] ?? '';
  if (!agentName) {
    const scriptPath = process.argv[1] ?? 'unknown';
    agentName = basename(scriptPath).replace(/\.(js|ts|mjs|cjs)$/, '');
  }

  const dbPath = process.env['AGENT_WATCH_DB'] || undefined;
  const startDashboard = process.env['AGENT_WATCH_DASHBOARD'] === 'true';
  const port = 4200;

  return { agentName, dbPath, disabled, startDashboard, port };
}
