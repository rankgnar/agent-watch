/**
 * auto.ts — Zero-config auto-instrumentation for agent-watch.
 *
 * Add ONE line to the top of your app:
 *
 *   require('agent-watch/auto');   // CommonJS
 *   import 'agent-watch/auto';     // ESM
 *
 * Every OpenAI and Anthropic call is then traced automatically.
 * Works with any OpenAI-compatible provider (OpenRouter, Groq, Together, Ollama)
 * because they all use the same OpenAI SDK pointed at a different baseURL.
 *
 * Optional env-var config — see auto-config.ts for the full list.
 */

import { randomUUID } from 'crypto';
import { loadAutoConfig } from './auto-config';
import { SQLiteStore } from './store/sqlite';
import { Span } from './sdk/span';
import { context } from './sdk/context';

// ── Bootstrap ────────────────────────────────────────────────────────────────

const config = loadAutoConfig();

if (!config.disabled) {
  const store = new SQLiteStore(config.dbPath);
  const agentName = config.agentName;

  // Single, minimal banner — not spammy.
  console.log(`[agent-watch] Tracing enabled → http://localhost:${config.port}`);

  // Auto-start dashboard when env var is set.
  if (config.startDashboard) {
    _startDashboardBackground(store, config.port);
  }

  _patchOpenAI(store, agentName);
  _patchAnthropic(store, agentName);
}

// ── OpenAI patching ───────────────────────────────────────────────────────────

/**
 * Monkey-patches `chat.completions.create` on the OpenAI SDK prototype so that
 * ALL client instances (existing and future) are traced automatically.
 *
 * Works with any baseURL — OpenRouter, Groq, Together, local Ollama, etc.
 * — because they all use the same OpenAI SDK class.
 */
function _patchOpenAI(store: SQLiteStore, agentName: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = _tryRequire('openai');
  if (!mod) return;

  // The CJS build may export the class directly or wrap it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OpenAI: any = (mod as any).default ?? mod;
  if (typeof OpenAI !== 'function') return;

  try {
    // Instantiate a probe client to walk up to the Completions prototype.
    // No network calls are made — we only need the prototype chain.
    const probe = new OpenAI({ apiKey: '_probe_', baseURL: 'http://localhost' });
    const completionsProto: Record<string, unknown> = Object.getPrototypeOf(probe.chat.completions);

    if (typeof completionsProto['create'] !== 'function') return;

    // Guard against double-patching.
    if ((completionsProto['create'] as { __awPatched?: boolean }).__awPatched) return;

    const original = completionsProto['create'] as (...args: unknown[]) => Promise<unknown>;

    const patched = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const traceId = context.getTraceId();
      const parentSpanId = context.getSpanId();
      const params = args[0] as Record<string, unknown> | undefined;
      const model = (params?.['model'] as string) ?? 'unknown';
      const messages = params?.['messages'];

      const spanName = `openai.chat.completions [${model}]`;
      const now = Date.now();

      // Auto-create a trace if we are not inside one already.
      let ownTraceId: string | undefined;
      if (!traceId) {
        ownTraceId = randomUUID();
        store.saveTrace({
          id: ownTraceId,
          name: spanName,
          agentName,
          startTime: now,
          status: 'running',
        });
      }

      const activeTraceId = ownTraceId ?? traceId ?? '';

      const span = new Span(
        activeTraceId,
        spanName,
        ownTraceId ? undefined : parentSpanId,
        {
          model,
          messageCount: Array.isArray(messages) ? messages.length : 0,
        },
        (s) => store.saveSpan(s.toRecord()),
      );
      store.saveSpan(span.toRecord());

      return context.run({ traceId: activeTraceId, spanId: span.id }, async () => {
        try {
          const result = await original.apply(this, args) as Record<string, unknown>;
          const usage = result?.['usage'] as Record<string, number> | undefined;
          span.setAttributes({
            promptTokens: usage?.['prompt_tokens'],
            completionTokens: usage?.['completion_tokens'],
            totalTokens: usage?.['total_tokens'],
          });
          span.end('ok');
          store.saveSpan(span.toRecord());

          if (ownTraceId) {
            store.saveTrace({
              id: ownTraceId,
              name: spanName,
              agentName,
              startTime: now,
              endTime: Date.now(),
              status: 'ok',
            });
          }

          return result;
        } catch (err) {
          span.endWithError(err);
          store.saveSpan(span.toRecord());

          if (ownTraceId) {
            store.saveTrace({
              id: ownTraceId,
              name: spanName,
              agentName,
              startTime: now,
              endTime: Date.now(),
              status: 'error',
            });
          }

          throw err;
        }
      });
    };

    (patched as { __awPatched?: boolean }).__awPatched = true;
    completionsProto['create'] = patched;
  } catch {
    // Silently skip — never break the user's app.
  }
}

// ── Anthropic patching ────────────────────────────────────────────────────────

/**
 * Monkey-patches `messages.create` on the Anthropic SDK prototype so that
 * ALL client instances are traced automatically.
 */
function _patchAnthropic(store: SQLiteStore, agentName: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = _tryRequire('@anthropic-ai/sdk');
  if (!mod) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Anthropic: any = (mod as any).default ?? mod;
  if (typeof Anthropic !== 'function') return;

  try {
    const probe = new Anthropic({ apiKey: '_probe_' });
    const messagesProto: Record<string, unknown> = Object.getPrototypeOf(probe.messages);

    if (typeof messagesProto['create'] !== 'function') return;
    if ((messagesProto['create'] as { __awPatched?: boolean }).__awPatched) return;

    const original = messagesProto['create'] as (...args: unknown[]) => Promise<unknown>;

    const patched = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const traceId = context.getTraceId();
      const parentSpanId = context.getSpanId();
      const params = args[0] as Record<string, unknown> | undefined;
      const model = (params?.['model'] as string) ?? 'unknown';

      const spanName = `anthropic.messages [${model}]`;
      const now = Date.now();

      let ownTraceId: string | undefined;
      if (!traceId) {
        ownTraceId = randomUUID();
        store.saveTrace({
          id: ownTraceId,
          name: spanName,
          agentName,
          startTime: now,
          status: 'running',
        });
      }

      const activeTraceId = ownTraceId ?? traceId ?? '';

      const span = new Span(
        activeTraceId,
        spanName,
        ownTraceId ? undefined : parentSpanId,
        { model },
        (s) => store.saveSpan(s.toRecord()),
      );
      store.saveSpan(span.toRecord());

      return context.run({ traceId: activeTraceId, spanId: span.id }, async () => {
        try {
          const result = await original.apply(this, args) as Record<string, unknown>;
          const usage = result?.['usage'] as Record<string, number> | undefined;
          span.setAttributes({
            inputTokens: usage?.['input_tokens'],
            outputTokens: usage?.['output_tokens'],
          });
          span.end('ok');
          store.saveSpan(span.toRecord());

          if (ownTraceId) {
            store.saveTrace({
              id: ownTraceId,
              name: spanName,
              agentName,
              startTime: now,
              endTime: Date.now(),
              status: 'ok',
            });
          }

          return result;
        } catch (err) {
          span.endWithError(err);
          store.saveSpan(span.toRecord());

          if (ownTraceId) {
            store.saveTrace({
              id: ownTraceId,
              name: spanName,
              agentName,
              startTime: now,
              endTime: Date.now(),
              status: 'error',
            });
          }

          throw err;
        }
      });
    };

    (patched as { __awPatched?: boolean }).__awPatched = true;
    messagesProto['create'] = patched;
  } catch {
    // Silently skip.
  }
}

// ── Dashboard auto-start ─────────────────────────────────────────────────────

function _startDashboardBackground(store: SQLiteStore, port: number): void {
  // Import lazily so the dashboard server is only pulled in when requested.
  // The store passed here shares the same DB path as the instrumentation layer.
  void (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { startDashboard } = require('./dashboard/server') as {
        startDashboard: (opts: { port: number; host: string; dbPath?: string }) => Promise<void>;
      };
      await startDashboard({ port, host: 'localhost', dbPath: store['db']?.name });
    } catch {
      // Non-fatal: dashboard start failure must never crash the user's app.
    }
  })();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _tryRequire(id: string): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
  } catch {
    return null;
  }
}
