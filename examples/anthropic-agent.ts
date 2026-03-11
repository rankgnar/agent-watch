/**
 * anthropic-agent.ts — Anthropic agent with tool calls
 *
 * Demonstrates tracing a multi-step Anthropic agent that uses
 * tool calls (function calling). Each tool invocation is wrapped
 * in a span so you can see exactly where time was spent.
 *
 * Run (after building):
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node examples/anthropic-agent.ts
 */

import { createTracer } from '../src/sdk';

// NOTE: In production you'd use the real Anthropic client:
// import Anthropic from '@anthropic-ai/sdk';
// const client = tracer.instrument(new Anthropic());

interface Tool {
  name: string;
  description: string;
  fn: (input: Record<string, unknown>) => Promise<unknown>;
}

const tools: Tool[] = [
  {
    name: 'search_web',
    description: 'Search the web for information',
    fn: async (input) => {
      await sleep(200 + Math.random() * 300);
      return { results: [`Result for: ${input['query']}`] };
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from disk',
    fn: async (input) => {
      await sleep(50);
      return { content: `Contents of ${input['path']}` };
    },
  },
  {
    name: 'write_summary',
    description: 'Write a summary to a file',
    fn: async (input) => {
      await sleep(30);
      return { written: true, path: input['path'] };
    },
  },
];

async function runAgent(userMessage: string) {
  const tracer = createTracer({
    name: 'anthropic-research-agent',
    store: 'sqlite',
  });

  const result = await tracer.withTrace('research-task', async (trace) => {
    // Step 1: Parse the user request
    const parseSpan = trace.startSpan('parse-request');
    parseSpan.setAttributes({ messageLength: userMessage.length });
    await sleep(10);
    parseSpan.end('ok');

    // Step 2: Simulated LLM call (would be auto-traced if using tracer.instrument())
    const llmSpan = trace.startSpan('anthropic.messages [claude-3-5-sonnet-20241022]');
    llmSpan.setAttributes({
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 150,
    });
    await sleep(500);
    llmSpan.setAttributes({ outputTokens: 80 });
    llmSpan.end('ok');

    // Step 3: Tool calls (agent loop)
    const toolCalls = [
      { name: 'search_web', input: { query: 'TypeScript observability patterns' } },
      { name: 'read_file', input: { path: '/docs/existing-notes.md' } },
    ];

    for (const call of toolCalls) {
      const toolSpan = trace.startSpan(`tool.${call.name}`, {
        attributes: { toolName: call.name, input: JSON.stringify(call.input) },
      });

      const tool = tools.find(t => t.name === call.name)!;
      try {
        const toolResult = await tool.fn(call.input);
        toolSpan.setAttributes({ outputLength: JSON.stringify(toolResult).length });
        toolSpan.end('ok');
      } catch (err) {
        toolSpan.endWithError(err);
      }
    }

    // Step 4: Final synthesis
    const synthSpan = trace.startSpan('synthesize-response');
    synthSpan.setAttributes({ toolCallCount: toolCalls.length });
    await sleep(400);
    synthSpan.end('ok');

    // Step 5: Write output
    const tool = tools.find(t => t.name === 'write_summary')!;
    const writeSpan = trace.startSpan('tool.write_summary');
    await tool.fn({ path: '/output/summary.md', content: 'Research complete.' });
    writeSpan.end('ok');

    return {
      message: 'Research task completed successfully.',
      toolCallsUsed: toolCalls.length,
    };
  });

  return result;
}

async function main() {
  console.log('Running research agent…\n');

  const result = await runAgent(
    'Research TypeScript observability patterns and summarize best practices.'
  );

  console.log('✓ Agent completed:', result);
  console.log('\nRun `agent-watch list` to see the trace.');
  console.log('Run `agent-watch replay <id>` to see the full span tree.');
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
