/**
 * agent-watch SDK — Observability for AI agents in production.
 *
 * @example
 * ```typescript
 * import { createTracer } from 'agent-watch';
 *
 * const tracer = createTracer({ name: 'my-agent', store: 'sqlite' });
 *
 * const trace = tracer.startTrace('process-order');
 * const span = trace.startSpan('validate-input');
 * span.setAttributes({ orderId: '123' });
 * span.end('ok');
 * trace.end();
 * ```
 */

export { Tracer, Trace } from './tracer';
export { Span } from './span';
export { context } from './context';
export type {
  TracerConfig,
  TraceOptions,
  SpanOptions,
  SpanStatus,
  TraceRecord,
  SpanRecord,
  EventRecord,
  StatsResult,
} from '../types';

import { Tracer, Trace } from './tracer';
import type { TracerConfig } from '../types';

/**
 * Create a new Tracer instance.
 *
 * @param config - Tracer configuration
 * @returns A configured Tracer
 */
export function createTracer(config: TracerConfig): Tracer {
  return new Tracer(config);
}

/**
 * Run an async function inside a new trace.
 * Convenience wrapper for one-off traces without managing a Tracer instance.
 *
 * @example
 * ```typescript
 * import { withTrace } from 'agent-watch';
 *
 * const result = await withTrace('my-agent', 'process-order', async (trace) => {
 *   const span = trace.startSpan('step-1');
 *   // ... work ...
 *   span.end('ok');
 *   return 'done';
 * });
 * ```
 */
export async function withTrace<T>(
  agentName: string,
  traceName: string,
  fn: (trace: Trace) => Promise<T>
): Promise<T> {
  const tracer = new Tracer({ name: agentName, store: 'sqlite' });
  return tracer.withTrace(traceName, fn);
}
