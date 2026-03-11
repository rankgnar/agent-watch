/**
 * Anthropic integration for agent-watch.
 *
 * Monkey-patches the Anthropic client to automatically trace all
 * `messages.create` calls with token usage and timing.
 *
 * @example
 * ```typescript
 * import Anthropic from '@anthropic-ai/sdk';
 * import { createTracer } from 'agent-watch';
 *
 * const tracer = createTracer({ name: 'my-agent', store: 'sqlite' });
 * const anthropic = tracer.instrument(new Anthropic());
 *
 * // All calls are now automatically traced
 * const message = await anthropic.messages.create({
 *   model: 'claude-3-5-sonnet-20241022',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello' }],
 * });
 * ```
 *
 * The integration records:
 * - Model name
 * - Input / output token usage
 * - Latency (via span timing)
 * - Errors with message
 */

// Actual patching logic lives in Tracer._instrumentAnthropic.
export {};
