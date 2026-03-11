/**
 * openai-basic.ts — Simple OpenAI tracing example
 *
 * Demonstrates how to trace OpenAI chat completions automatically
 * and add manual spans for your own logic.
 *
 * Run (after building):
 *   OPENAI_API_KEY=sk-... npx ts-node examples/openai-basic.ts
 */

import { createTracer } from '../src/sdk';

// NOTE: In a real project you'd import from 'openai'
// import OpenAI from 'openai';
// const openai = tracer.instrument(new OpenAI());

async function main() {
  const tracer = createTracer({
    name: 'openai-basic-example',
    store: 'sqlite',
  });

  // ── Example 1: Manual tracing ──────────────────────────────────

  const trace = tracer.startTrace('process-user-query');

  const parseSpan = trace.startSpan('parse-input');
  parseSpan.setAttributes({ inputLength: 42, type: 'text' });
  await sleep(10);
  parseSpan.end('ok');

  const llmSpan = trace.startSpan('llm-call');
  llmSpan.setAttributes({ model: 'gpt-4', promptTokens: 120 });

  // Simulate an LLM call
  await sleep(350);

  llmSpan.setAttributes({ completionTokens: 80, totalTokens: 200 });
  llmSpan.end('ok');

  const formatSpan = trace.startSpan('format-response');
  await sleep(5);
  formatSpan.end('ok');

  trace.end();

  console.log(`✓ Trace completed: ${trace.id}`);
  console.log(`  Duration: ${trace.durationMs}ms`);
  console.log(`  Status: ${trace.status}`);

  // ── Example 2: withTrace wrapper ───────────────────────────────

  const result = await tracer.withTrace('validate-and-respond', async (t) => {
    const span = t.startSpan('validate');
    span.setAttributes({ orderId: 'ord_123', userId: 'usr_abc' });
    await sleep(20);
    span.end('ok');

    const respond = t.startSpan('generate-response');
    await sleep(200);
    respond.setAttributes({ tokens: 150 });
    respond.end('ok');

    return { status: 'done', message: 'Order validated' };
  });

  console.log(`✓ withTrace result:`, result);

  // ── Example 3: Error tracing ───────────────────────────────────

  const errTrace = tracer.startTrace('failing-operation');
  const errSpan = errTrace.startSpan('database-lookup');
  errSpan.setAttributes({ table: 'orders', id: 'missing-id' });
  await sleep(50);
  errSpan.endWithError(new Error('Record not found: missing-id'));
  errTrace.end('error');

  console.log(`✓ Error trace: ${errTrace.id} [${errTrace.status}]`);
  console.log('\nRun `agent-watch list` to see these traces.');
  console.log('Run `agent-watch replay <id>` to inspect a trace.');
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
