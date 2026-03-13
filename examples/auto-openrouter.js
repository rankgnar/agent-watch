/**
 * auto-openrouter.js — Example: zero-config tracing with OpenRouter.
 *
 * This demonstrates how a single require() instruments every LLM call
 * automatically, including providers other than OpenAI itself.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... node examples/auto-openrouter.js
 */

require('./dist/auto.js'); // In real use: require('agent-watch/auto')

const OpenAI = require('openai');

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

async function main() {
  // Just use OpenAI normally — agent-watch captures everything
  const r = await client.chat.completions.create({
    model: 'anthropic/claude-3.5-sonnet',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  console.log(r.choices[0].message.content);
}

main();
