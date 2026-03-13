/**
 * agent-watch proxy server.
 *
 * Listens on 127.0.0.1 (localhost only — NEVER 0.0.0.0) and forwards all
 * requests to the configured target URL while capturing traces into SQLite.
 *
 * Security guarantees:
 *  - Binds only to 127.0.0.1
 *  - Authorization / API key headers are passed to the target but NEVER stored
 *  - Stored traces contain only redacted header summaries (last 4 chars of tokens)
 *  - No cookies or other sensitive headers are persisted
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { SQLiteStore } from '../store/sqlite';
import {
  parseRequest,
  parseResponse,
  parseStreamingChunks,
  redactHeaders,
  ParsedRequest,
} from './parsers';

export interface ProxyOptions {
  /** Target base URL, e.g. https://openrouter.ai/api/v1 */
  targetUrl: string;
  /** Port to listen on. Defaults to 4201 */
  port?: number;
  /** Agent name for traces. Defaults to 'proxy' */
  agentName?: string;
  /** Path to SQLite DB */
  dbPath?: string;
}

export interface ProxyServer {
  server: http.Server;
  close(): Promise<void>;
}

/** Start the proxy and return a handle. */
export async function startProxy(options: ProxyOptions): Promise<ProxyServer> {
  const {
    targetUrl,
    port = 4201,
    agentName = 'proxy',
    dbPath,
  } = options;

  const target = new URL(targetUrl);
  const store = new SQLiteStore(dbPath);
  const isHttps = target.protocol === 'https:';
  const transport = isHttps ? https : http;

  const server = http.createServer((req, res) => {
    const startTime = Date.now();
    const traceId = randomUUID();
    const path = req.url ?? '/';

    // ── Collect request body ────────────────────────────────────
    const requestChunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => requestChunks.push(chunk));
    req.on('end', () => {
      const requestBody = Buffer.concat(requestChunks);
      let requestJson: Record<string, unknown> = {};
      let isStreaming = false;

      try {
        requestJson = JSON.parse(requestBody.toString('utf8'));
        isStreaming = requestJson['stream'] === true;
      } catch {
        // Non-JSON body — treat as generic
      }

      const parsed = parseRequest(path, requestJson);

      // ── Build forwarded request ─────────────────────────────
      const targetPath = buildTargetPath(target, path);
      const targetPort = target.port
        ? parseInt(target.port, 10)
        : isHttps ? 443 : 80;

      // Forward all headers, but strip hop-by-hop
      const forwardHeaders: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (HOP_BY_HOP.has(k.toLowerCase())) continue;
        forwardHeaders[k] = v;
      }
      // Ensure Host is set to target
      forwardHeaders['host'] = target.hostname;

      const reqOptions: http.RequestOptions = {
        hostname: target.hostname,
        port: targetPort,
        path: targetPath,
        method: req.method ?? 'GET',
        headers: forwardHeaders,
      };

      // ── Forward to target ──────────────────────────────────
      const proxyReq = transport.request(reqOptions, (proxyRes) => {
        const statusCode = proxyRes.statusCode ?? 200;

        // Pass response headers back (strip hop-by-hop)
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (v === undefined) continue;
          if (HOP_BY_HOP.has(k.toLowerCase())) continue;
          res.setHeader(k, v);
        }
        res.statusCode = statusCode;

        const responseChunks: Buffer[] = [];
        const sseChunks: string[] = [];

        proxyRes.on('data', (chunk: Buffer) => {
          // Forward chunk immediately to client
          res.write(chunk);
          responseChunks.push(chunk);

          if (isStreaming) {
            sseChunks.push(chunk.toString('utf8'));
          }
        });

        proxyRes.on('end', () => {
          res.end();
          const endTime = Date.now();
          const latencyMs = endTime - startTime;

          // ── Parse response for trace storage ──────────────
          let parsedResponse;
          if (isStreaming) {
            parsedResponse = parseStreamingChunks(parsed.format, sseChunks);
          } else {
            const responseBody = Buffer.concat(responseChunks).toString('utf8');
            let responseJson: Record<string, unknown> = {};
            try { responseJson = JSON.parse(responseBody); } catch { /* raw */ }
            parsedResponse = parseResponse(parsed.format, responseJson);
          }

          // ── Save trace (no sensitive headers) ─────────────
          saveTrace({
            store,
            traceId,
            agentName,
            path,
            method: req.method ?? 'GET',
            parsed,
            parsedResponse,
            statusCode,
            latencyMs,
            startTime,
            endTime,
            isStreaming,
            requestHeaders: req.headers as Record<string, string | string[] | undefined>,
          });
        });

        proxyRes.on('error', (err) => {
          res.end();
          saveErrorTrace({
            store, traceId, agentName, path, parsed,
            startTime, endTime: Date.now(), error: err.message,
          });
        });
      });

      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
        }
        saveErrorTrace({
          store, traceId, agentName, path, parsed,
          startTime, endTime: Date.now(), error: err.message,
        });
      });

      // Write request body to upstream
      if (requestBody.length > 0) {
        proxyReq.write(requestBody);
      }
      proxyReq.end();
    });

    req.on('error', () => {
      // Client disconnected early — nothing to save
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // SECURITY: bind ONLY to 127.0.0.1, never 0.0.0.0
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        close: () =>
          new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
  });
}

// ─────────────────────────── Helpers ───────────────────────────

/** HTTP/1.1 hop-by-hop headers — must not be forwarded */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/** Build the path to forward to the target, preserving sub-paths. */
function buildTargetPath(target: URL, incomingPath: string): string {
  // target.pathname may be e.g. /api/v1, incomingPath may be /v1/chat/completions
  // Strip any overlap to avoid doubling the base path
  const base = target.pathname.replace(/\/$/, '');
  if (base === '' || base === '/') return incomingPath;

  // If the request path already starts with the base path, don't double it
  if (incomingPath.startsWith(base)) return incomingPath;

  return base + incomingPath;
}

interface SaveTraceArgs {
  store: SQLiteStore;
  traceId: string;
  agentName: string;
  path: string;
  method: string;
  parsed: ParsedRequest;
  parsedResponse: ReturnType<typeof parseResponse>;
  statusCode: number;
  latencyMs: number;
  startTime: number;
  endTime: number;
  isStreaming: boolean;
  requestHeaders: Record<string, string | string[] | undefined>;
}

function saveTrace(args: SaveTraceArgs): void {
  const {
    store, traceId, agentName, path, method, parsed, parsedResponse,
    statusCode, latencyMs, startTime, endTime, isStreaming,
  } = args;

  const status = parsedResponse.error || statusCode >= 400 ? 'error' : 'ok';
  const model = parsedResponse.model ?? parsed.model ?? 'unknown';
  const traceName = `${method} ${path}`;

  try {
    // Save trace
    store.saveTrace({
      id: traceId,
      name: traceName,
      agentName,
      startTime,
      endTime,
      status,
      metadata: {
        path,
        method,
        format: parsed.format,
        model,
        statusCode,
        streaming: isStreaming,
      },
    });

    // Save span with LLM attributes (no auth headers)
    store.saveSpan({
      id: randomUUID(),
      traceId,
      name: 'llm.call',
      startTime,
      endTime,
      status,
      attributes: {
        'llm.model': model,
        'llm.format': parsed.format,
        'llm.input_tokens': parsedResponse.inputTokens,
        'llm.output_tokens': parsedResponse.outputTokens,
        'llm.total_tokens': parsedResponse.totalTokens,
        'llm.finish_reason': parsedResponse.finishReason,
        'http.method': method,
        'http.path': path,
        'http.status_code': statusCode,
        'http.latency_ms': latencyMs,
        'llm.streaming': isStreaming,
        ...(parsedResponse.error ? { 'error.message': parsedResponse.error } : {}),
      },
      errorMessage: parsedResponse.error,
    });
  } catch (err) {
    // Don't crash the proxy on storage errors
    console.error('[agent-watch] Failed to save trace:', err);
  }
}

interface SaveErrorArgs {
  store: SQLiteStore;
  traceId: string;
  agentName: string;
  path: string;
  parsed: ParsedRequest;
  startTime: number;
  endTime: number;
  error: string;
}

function saveErrorTrace(args: SaveErrorArgs): void {
  const { store, traceId, agentName, path, parsed, startTime, endTime, error } = args;
  try {
    store.saveTrace({
      id: traceId,
      name: `proxy_error ${path}`,
      agentName,
      startTime,
      endTime,
      status: 'error',
      metadata: { path, format: parsed.format, error },
    });
  } catch {
    // Swallow storage errors
  }
}
