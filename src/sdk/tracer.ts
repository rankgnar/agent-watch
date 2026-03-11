import { randomUUID } from 'crypto';
import type { TracerConfig, TraceOptions, SpanOptions, SpanStatus, TraceRecord } from '../types';
import { Span } from './span';
import { context } from './context';
import { SQLiteStore } from '../store/sqlite';

/**
 * A Trace represents a single agent invocation or operation.
 * It holds a tree of spans that capture sub-operations.
 */
export class Trace {
  readonly id: string;
  readonly name: string;
  readonly agentName: string;
  readonly startTime: number;

  private _endTime?: number;
  private _status: SpanStatus = 'running';
  private _metadata: Record<string, unknown>;
  private _spans: Map<string, Span> = new Map();
  private _rootSpans: Span[] = [];
  private _store: SQLiteStore;

  constructor(
    name: string,
    agentName: string,
    store: SQLiteStore,
    options: TraceOptions = {}
  ) {
    this.id = randomUUID();
    this.name = name;
    this.agentName = agentName;
    this.startTime = Date.now();
    this._metadata = options.metadata ?? {};
    this._store = store;

    // Persist immediately
    this._store.saveTrace(this.toRecord());
  }

  /**
   * Start a new span inside this trace.
   * If called within an async context that has a current span,
   * the new span is automatically parented.
   */
  startSpan(name: string, options: SpanOptions = {}): Span {
    const parentId = options.parentSpanId ?? context.getSpanId();
    const span = new Span(this.id, name, parentId, options.attributes);

    this._spans.set(span.id, span);

    if (parentId) {
      const parent = this._spans.get(parentId);
      if (parent) parent.addChild(span);
    } else {
      this._rootSpans.push(span);
    }

    this._store.saveSpan(span.toRecord());
    return span;
  }

  /**
   * End a span and update it in the store.
   */
  endSpan(span: Span, status: SpanStatus = 'ok', errorMessage?: string): void {
    span.end(status, errorMessage);
    this._store.saveSpan(span.toRecord());
  }

  /**
   * End the trace with the given status.
   */
  end(status?: SpanStatus): void {
    if (this._endTime !== undefined) return;
    this._endTime = Date.now();

    // Auto-compute status if not provided: error if any span errored
    if (status) {
      this._status = status;
    } else {
      let hasError = false;
      for (const span of this._spans.values()) {
        if (span.status === 'error') { hasError = true; break; }
      }
      this._status = hasError ? 'error' : 'ok';
    }

    // Close any still-running spans
    for (const span of this._spans.values()) {
      if (span.status === 'running') {
        span.end('ok');
        this._store.saveSpan(span.toRecord());
      }
    }

    this._store.saveTrace(this.toRecord());
  }

  get status(): SpanStatus { return this._status; }
  get endTime(): number | undefined { return this._endTime; }
  get durationMs(): number | undefined {
    return this._endTime !== undefined ? this._endTime - this.startTime : undefined;
  }

  toRecord(): TraceRecord {
    return {
      id: this.id,
      name: this.name,
      agentName: this.agentName,
      startTime: this.startTime,
      endTime: this._endTime,
      status: this._status,
      metadata: this._metadata,
    };
  }
}

/**
 * Tracer is the main entry point for the SDK.
 * Create one per agent and reuse it across all operations.
 */
export class Tracer {
  private _config: TracerConfig;
  private _store: SQLiteStore;

  constructor(config: TracerConfig) {
    this._config = config;
    this._store = new SQLiteStore(config.dbPath);
  }

  /**
   * Start a new trace. Call `.end()` when the operation is complete.
   */
  startTrace(name: string, options: TraceOptions = {}): Trace {
    return new Trace(name, this._config.name, this._store, options);
  }

  /**
   * Run a function inside a named trace.
   * The trace is automatically ended when the function resolves or throws.
   *
   * @example
   * const result = await tracer.withTrace('process-order', async (trace) => {
   *   const span = trace.startSpan('validate');
   *   // ... do work ...
   *   span.end('ok');
   *   return result;
   * });
   */
  async withTrace<T>(
    name: string,
    fn: (trace: Trace) => Promise<T>,
    options: TraceOptions = {}
  ): Promise<T> {
    const trace = this.startTrace(name, options);
    return context.run({ traceId: trace.id }, async () => {
      try {
        const result = await fn(trace);
        trace.end('ok');
        return result;
      } catch (err) {
        trace.end('error');
        throw err;
      }
    });
  }

  /**
   * Instrument an SDK client to automatically trace all API calls.
   * Currently supports OpenAI and Anthropic client objects.
   */
  instrument<T extends object>(client: T): T {
    // Detect and wrap known client types
    const clientAny = client as Record<string, unknown>;

    if (
      clientAny['chat'] &&
      (clientAny['chat'] as Record<string, unknown>)['completions']
    ) {
      // Looks like OpenAI client
      return this._instrumentOpenAI(client) as unknown as T;
    }

    if (clientAny['messages'] && typeof (clientAny['messages'] as Record<string, unknown>)['create'] === 'function') {
      // Looks like Anthropic client
      return this._instrumentAnthropic(client) as unknown as T;
    }

    return client;
  }

  private _instrumentOpenAI<T extends object>(client: T): T {
    const tracer = this;
    const clientAny = client as Record<string, unknown>;
    const chat = clientAny['chat'] as Record<string, unknown>;
    const completions = chat['completions'] as Record<string, unknown>;
    const originalCreate = completions['create'] as (...args: unknown[]) => Promise<unknown>;

    completions['create'] = async function (...args: unknown[]) {
      const traceId = context.getTraceId();
      const parentSpanId = context.getSpanId();
      const params = args[0] as Record<string, unknown> | undefined;
      const model = (params?.['model'] as string) ?? 'unknown';
      const messages = params?.['messages'];

      const spanName = `openai.chat.completions [${model}]`;

      let span: Span | undefined;
      if (traceId) {
        // We're inside an active trace — attach a span
        const trace = tracer._store.getActiveTrace(traceId);
        if (trace) {
          span = new Span(traceId, spanName, parentSpanId, {
            model,
            messageCount: Array.isArray(messages) ? messages.length : 0,
          });
          tracer._store.saveSpan(span.toRecord());
        }
      }

      return context.run(
        { traceId: traceId ?? '', spanId: span?.id },
        async () => {
          try {
            const result = await originalCreate.apply(completions, args) as Record<string, unknown>;
            if (span) {
              const usage = result?.['usage'] as Record<string, number> | undefined;
              span.setAttributes({
                promptTokens: usage?.['prompt_tokens'],
                completionTokens: usage?.['completion_tokens'],
                totalTokens: usage?.['total_tokens'],
              });
              span.end('ok');
              tracer._store.saveSpan(span.toRecord());
            }
            return result;
          } catch (err) {
            if (span) {
              span.endWithError(err);
              tracer._store.saveSpan(span.toRecord());
            }
            throw err;
          }
        }
      );
    };

    return client;
  }

  private _instrumentAnthropic<T extends object>(client: T): T {
    const tracer = this;
    const clientAny = client as Record<string, unknown>;
    const messages = clientAny['messages'] as Record<string, unknown>;
    const originalCreate = messages['create'] as (...args: unknown[]) => Promise<unknown>;

    messages['create'] = async function (...args: unknown[]) {
      const traceId = context.getTraceId();
      const parentSpanId = context.getSpanId();
      const params = args[0] as Record<string, unknown> | undefined;
      const model = (params?.['model'] as string) ?? 'unknown';

      const spanName = `anthropic.messages [${model}]`;

      let span: Span | undefined;
      if (traceId) {
        span = new Span(traceId, spanName, parentSpanId, { model });
        tracer._store.saveSpan(span.toRecord());
      }

      return context.run(
        { traceId: traceId ?? '', spanId: span?.id },
        async () => {
          try {
            const result = await originalCreate.apply(messages, args) as Record<string, unknown>;
            if (span) {
              const usage = result?.['usage'] as Record<string, number> | undefined;
              span.setAttributes({
                inputTokens: usage?.['input_tokens'],
                outputTokens: usage?.['output_tokens'],
              });
              span.end('ok');
              tracer._store.saveSpan(span.toRecord());
            }
            return result;
          } catch (err) {
            if (span) {
              span.endWithError(err);
              tracer._store.saveSpan(span.toRecord());
            }
            throw err;
          }
        }
      );
    };

    return client;
  }

  get store(): SQLiteStore {
    return this._store;
  }
}
