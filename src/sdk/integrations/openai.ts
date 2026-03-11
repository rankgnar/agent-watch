/**
 * OpenAI integration for agent-watch.
 *
 * Monkey-patches the OpenAI client to automatically trace all
 * `chat.completions.create` calls with token usage and timing.
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * import { createTracer } from 'agent-watch';
 *
 * const tracer = createTracer({ name: 'my-agent', store: 'sqlite' });
 * const openai = tracer.instrument(new OpenAI());
 *
 * // All calls are now automatically traced
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello' }],
 * });
 * ```
 *
 * The integration records:
 * - Model name
 * - Message count
 * - Prompt / completion / total token usage
 * - Latency (via span timing)
 * - Errors with message
 */

// This file is intentionally a documentation/re-export shim.
// The actual patching logic lives in Tracer._instrumentOpenAI
// to keep it co-located with context propagation.
export {};
