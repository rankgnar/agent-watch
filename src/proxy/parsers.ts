/**
 * Parsers for different AI API formats.
 * Extracts model, tokens, and other metadata from requests and responses.
 */

export interface ParsedRequest {
  model?: string;
  format: 'openai-chat' | 'openai-completion' | 'anthropic' | 'generic';
  prompt?: string;
  system?: string;
  messages?: unknown[];
}

export interface ParsedResponse {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  content?: string;
  finishReason?: string;
  error?: string;
}

/** Detect format from request path + body */
export function parseRequest(path: string, body: Record<string, unknown>): ParsedRequest {
  // OpenAI chat completions
  if (path.includes('/chat/completions')) {
    return {
      format: 'openai-chat',
      model: (body['model'] as string) || undefined,
      messages: (body['messages'] as unknown[]) || undefined,
    };
  }

  // OpenAI completions (legacy)
  if (path.includes('/completions')) {
    return {
      format: 'openai-completion',
      model: (body['model'] as string) || undefined,
      prompt: (body['prompt'] as string) || undefined,
    };
  }

  // Anthropic messages
  if (path.includes('/messages')) {
    const system = body['system'];
    return {
      format: 'anthropic',
      model: (body['model'] as string) || undefined,
      system: typeof system === 'string' ? system : undefined,
      messages: (body['messages'] as unknown[]) || undefined,
    };
  }

  // Generic fallback
  return {
    format: 'generic',
    model: (body['model'] as string) || undefined,
  };
}

/** Parse a complete (non-streaming) response body */
export function parseResponse(format: ParsedRequest['format'], body: Record<string, unknown>): ParsedResponse {
  try {
    // Error response (common across providers)
    if (body['error']) {
      const err = body['error'] as Record<string, unknown>;
      return { error: (err['message'] as string) || JSON.stringify(err) };
    }

    if (format === 'openai-chat' || format === 'openai-completion') {
      return parseOpenAIResponse(body);
    }

    if (format === 'anthropic') {
      return parseAnthropicResponse(body);
    }

    // Generic: try to extract common fields
    const usage = body['usage'] as Record<string, unknown> | undefined;
    return {
      model: (body['model'] as string) || undefined,
      inputTokens: (usage?.['input_tokens'] as number) || (usage?.['prompt_tokens'] as number) || undefined,
      outputTokens: (usage?.['output_tokens'] as number) || (usage?.['completion_tokens'] as number) || undefined,
    };
  } catch {
    return {};
  }
}

function parseOpenAIResponse(body: Record<string, unknown>): ParsedResponse {
  const usage = body['usage'] as Record<string, unknown> | undefined;
  const choices = body['choices'] as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];

  let content: string | undefined;
  if (firstChoice) {
    const message = firstChoice['message'] as Record<string, unknown> | undefined;
    content = (message?.['content'] as string) ||
              (firstChoice['text'] as string) ||
              undefined;
  }

  return {
    model: (body['model'] as string) || undefined,
    inputTokens: (usage?.['prompt_tokens'] as number) || undefined,
    outputTokens: (usage?.['completion_tokens'] as number) || undefined,
    totalTokens: (usage?.['total_tokens'] as number) || undefined,
    content,
    finishReason: (firstChoice?.['finish_reason'] as string) || undefined,
  };
}

function parseAnthropicResponse(body: Record<string, unknown>): ParsedResponse {
  const usage = body['usage'] as Record<string, unknown> | undefined;
  const contentArr = body['content'] as Array<Record<string, unknown>> | undefined;

  let content: string | undefined;
  if (contentArr && contentArr.length > 0) {
    const textBlock = contentArr.find((b) => b['type'] === 'text');
    content = (textBlock?.['text'] as string) || undefined;
  }

  return {
    model: (body['model'] as string) || undefined,
    inputTokens: (usage?.['input_tokens'] as number) || undefined,
    outputTokens: (usage?.['output_tokens'] as number) || undefined,
    content,
    finishReason: (body['stop_reason'] as string) || undefined,
  };
}

/**
 * Parse accumulated SSE chunks into a synthetic response object.
 * Handles both OpenAI and Anthropic streaming formats.
 */
export function parseStreamingChunks(
  format: ParsedRequest['format'],
  chunks: string[]
): ParsedResponse {
  const result: ParsedResponse = {};
  const contentParts: string[] = [];

  for (const raw of chunks) {
    // Each chunk may be "data: {...}\n" lines
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const jsonStr = line.slice(5).trim();
      if (jsonStr === '[DONE]') continue;

      try {
        const obj = JSON.parse(jsonStr) as Record<string, unknown>;

        if (format === 'anthropic') {
          parseAnthropicStreamChunk(obj, result, contentParts);
        } else {
          // OpenAI-compatible
          parseOpenAIStreamChunk(obj, result, contentParts);
        }
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  if (contentParts.length > 0) {
    result.content = contentParts.join('');
  }

  return result;
}

function parseOpenAIStreamChunk(
  obj: Record<string, unknown>,
  result: ParsedResponse,
  contentParts: string[]
): void {
  if (!result.model && obj['model']) {
    result.model = obj['model'] as string;
  }

  const choices = obj['choices'] as Array<Record<string, unknown>> | undefined;
  if (choices && choices.length > 0) {
    const delta = choices[0]['delta'] as Record<string, unknown> | undefined;
    if (delta?.['content']) {
      contentParts.push(delta['content'] as string);
    }
    if (choices[0]['finish_reason']) {
      result.finishReason = choices[0]['finish_reason'] as string;
    }
  }

  // Some providers include usage in the last chunk
  const usage = obj['usage'] as Record<string, unknown> | undefined;
  if (usage) {
    result.inputTokens = (usage['prompt_tokens'] as number) || result.inputTokens;
    result.outputTokens = (usage['completion_tokens'] as number) || result.outputTokens;
    result.totalTokens = (usage['total_tokens'] as number) || result.totalTokens;
  }
}

function parseAnthropicStreamChunk(
  obj: Record<string, unknown>,
  result: ParsedResponse,
  contentParts: string[]
): void {
  const type = obj['type'] as string;

  if (type === 'message_start') {
    const msg = obj['message'] as Record<string, unknown> | undefined;
    if (msg?.['model']) result.model = msg['model'] as string;
    const usage = msg?.['usage'] as Record<string, unknown> | undefined;
    if (usage) {
      result.inputTokens = (usage['input_tokens'] as number) || result.inputTokens;
    }
  } else if (type === 'content_block_delta') {
    const delta = obj['delta'] as Record<string, unknown> | undefined;
    if (delta?.['type'] === 'text_delta') {
      contentParts.push(delta['text'] as string);
    }
  } else if (type === 'message_delta') {
    const usage = obj['usage'] as Record<string, unknown> | undefined;
    if (usage) {
      result.outputTokens = (usage['output_tokens'] as number) || result.outputTokens;
    }
    const delta = obj['delta'] as Record<string, unknown> | undefined;
    if (delta?.['stop_reason']) {
      result.finishReason = delta['stop_reason'] as string;
    }
  }
}

/**
 * Redact sensitive headers for storage.
 * Keeps only last 4 chars of auth tokens.
 */
export function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const SENSITIVE = new Set([
    'authorization',
    'x-api-key',
    'api-key',
    'cookie',
    'set-cookie',
    'x-auth-token',
    'proxy-authorization',
  ]);

  const redacted: Record<string, string> = {};
  for (const [key, val] of Object.entries(headers)) {
    if (val === undefined) continue;
    const lower = key.toLowerCase();
    const value = Array.isArray(val) ? val.join(', ') : val;

    if (SENSITIVE.has(lower)) {
      // Keep scheme + last 4 chars, mask the rest
      if (lower === 'authorization' && value.startsWith('Bearer ')) {
        const token = value.slice(7);
        const last4 = token.slice(-4);
        redacted[key] = `Bearer sk-...${last4}`;
      } else {
        const last4 = value.slice(-4);
        redacted[key] = `...${last4}`;
      }
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
