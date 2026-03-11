import { AsyncLocalStorage } from 'async_hooks';

export interface TraceContext {
  traceId: string;
  spanId?: string;
}

/**
 * AsyncLocalStorage-based context propagation.
 * Automatically carries trace/span IDs through async call chains
 * without manual threading of context.
 */
const storage = new AsyncLocalStorage<TraceContext>();

export const context = {
  /** Run a function inside a new trace context */
  run<T>(ctx: TraceContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  /** Get the current trace context, if any */
  get(): TraceContext | undefined {
    return storage.getStore();
  },

  /** Get the current trace ID, if any */
  getTraceId(): string | undefined {
    return storage.getStore()?.traceId;
  },

  /** Get the current span ID, if any */
  getSpanId(): string | undefined {
    return storage.getStore()?.spanId;
  },
};
