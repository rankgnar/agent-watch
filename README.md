# agent-watch

[![npm version](https://img.shields.io/npm/v/agent-watch?color=blue)](https://www.npmjs.com/package/agent-watch)
[![CI](https://github.com/rankgnar/agent-watch/actions/workflows/ci.yml/badge.svg)](https://github.com/rankgnar/agent-watch/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node.js](https://img.shields.io/node/v/agent-watch)](package.json)

**Observability for AI apps in production.**
See every LLM call your app makes — model, tokens, latency, errors — in a local dashboard. Zero cloud. Zero config.

![agent-watch dashboard](assets/banner.jpg)

---

## Who is this for?

If you're **building software that calls AI APIs** (OpenAI, Anthropic, OpenRouter, Groq, Ollama, etc.), `agent-watch` shows you exactly what's happening under the hood:

- **Backend developers** building chatbots, AI assistants, or automated workflows
- **Startup teams** running AI agents in production that need to debug failures fast
- **Freelancers** building AI-powered apps for clients who ask "why did it break?"
- **Teams with AI pipelines** processing documents, analyzing data, or generating content

### The problem it solves

Your AI app calls GPT-4 or Claude 50 times per request. One of those calls fails, returns garbage, or takes 10 seconds. Without `agent-watch`, you dig through logs for hours. With it, you open a dashboard and see the exact call that failed, why, and how long it took.

### NOT for

- End users chatting with ChatGPT (you don't need this)
- Non-technical users (this is a developer tool)

---

## Quick Start

### Option 1: Proxy mode (any language — recommended)

Run one command. No code changes needed:

```bash
npx agent-watch --target https://openrouter.ai/api/v1
```

Then point your app to `http://localhost:4201` instead of the API URL:

```python
# Python
client = OpenAI(base_url="http://localhost:4201/v1")

# JavaScript
const client = new OpenAI({ baseURL: "http://localhost:4201/v1" });

# curl
curl http://localhost:4201/v1/chat/completions -H "Authorization: Bearer YOUR_KEY" ...
```

Open `http://localhost:4200` → see every call in real time.

Works with **any language** (Python, Go, Rust, Java, curl) and **any provider**:

```bash
npx agent-watch --target https://api.openai.com        # OpenAI
npx agent-watch --target https://api.anthropic.com      # Anthropic
npx agent-watch --target https://openrouter.ai/api/v1   # OpenRouter
npx agent-watch --target http://localhost:11434          # Ollama (local)
npx agent-watch --target https://api.groq.com/openai    # Groq
npx agent-watch --target https://api.together.xyz       # Together
npx agent-watch --target https://api.mistral.ai         # Mistral
```

> **Security:** The proxy only listens on `127.0.0.1` (your machine). API keys are forwarded to the provider but **never** stored locally.

### Option 2: One-liner for Node.js

If your app is Node.js, just add one line at the top:

```js
require('agent-watch/auto');
```

Every OpenAI/Anthropic call is traced automatically. Run the dashboard with:

```bash
npx agent-watch serve
```

---

## What you see in the dashboard

```
✓ classify-ticket      0.8s   gpt-4    tokens: 150    ok
✓ lookup-customer      0.2s   —        DB query       ok
✗ generate-response    ERROR  gpt-4    rate_limit     error
✓ retry-response       1.2s   gpt-4    tokens: 340    ok
✓ send-email           0.1s   —        SMTP           ok
```

Click any trace to see the full span tree — every step your agent took, with timing, token counts, and the exact error message when something breaks.

---

## Real-world use cases

### 🔍 "My AI agent is giving wrong answers"
Open the dashboard, find the trace, see which LLM call returned unexpected output. Fix the prompt, not the whole app.

### 💰 "How much are we spending on tokens?"
Every trace shows input/output token counts. See which agent or workflow burns the most API budget.

### ⚡ "The app is slow, but I don't know why"
Latency per span. Instantly see if it's the LLM (2s), the database (50ms), or the tool call (5s timeout).

### 🔄 "The agent is stuck in a loop"
The span tree makes it obvious — 47 identical calls to the same tool. No more guessing from flat logs.

### 🛡️ "We need an audit trail"
Regulated industries (finance, healthcare) need records of AI decisions. `agent-watch` stores the full decision tree with timestamps.

### 🧪 "Did my prompt change break anything?"
Compare traces before and after. See how token usage, latency, and outputs differ.

---

## CLI

```bash
agent-watch --target <url>           # Start proxy + dashboard
agent-watch serve --port 4200        # Dashboard only
agent-watch list                     # Recent traces
agent-watch list --status error      # Only failures
agent-watch replay <trace-id>        # Full span tree
agent-watch stats                    # Error rate, avg latency, top failures
```

---

## Configuration (optional)

| Variable | Default | Description |
|---|---|---|
| `AGENT_WATCH_NAME` | script filename | Agent name in the dashboard |
| `AGENT_WATCH_DB` | `~/.agent-watch/traces.db` | Custom database path |
| `AGENT_WATCH_DISABLED=true` | — | Disable without removing code |

---

## Advanced: Manual SDK

For fine-grained control over traces and spans:

```typescript
import { createTracer } from 'agent-watch';

const tracer = createTracer({ name: 'my-agent' });
const trace = tracer.startTrace('process-order');

const span = trace.startSpan('validate-input');
span.setAttributes({ orderId: '123' });
span.end('ok');

trace.end();
```

Full SDK docs: [SDK API Reference](#sdk-api)

<details>
<summary><strong>SDK API Reference</strong></summary>

### `createTracer(config)`

```typescript
const tracer = createTracer({
  name: 'my-agent',
  store: 'sqlite',
  dbPath: './traces.db',
});
```

### `tracer.startTrace(name)` / `tracer.withTrace(name, fn)`

```typescript
// Manual
const trace = tracer.startTrace('task');
trace.end();

// Automatic
await tracer.withTrace('task', async (trace) => { ... });
```

### `trace.startSpan(name)`

```typescript
const span = trace.startSpan('llm-call');
span.setAttributes({ model: 'gpt-4', tokens: 150 });
span.end('ok');          // or span.endWithError(error)
```

### `tracer.instrument(client)`

```typescript
const openai = tracer.instrument(new OpenAI());
const anthropic = tracer.instrument(new Anthropic());
// All calls are now automatically traced
```

</details>

---

## Self-hosted. Zero cloud. MIT.

All data stays in a local SQLite file. No accounts. No API keys. No data leaves your machine.

```
MIT License — Copyright (c) 2026 Raul Rosello
```

---

## Contributing

```bash
git clone https://github.com/rankgnar/agent-watch
cd agent-watch
npm install
npm run build
```

PRs welcome. Open an issue first for major changes.
