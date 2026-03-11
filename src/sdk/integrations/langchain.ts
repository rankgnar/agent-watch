/**
 * LangChain integration for agent-watch.
 *
 * Provides a BaseCallbackHandler that traces LangChain chains,
 * LLM calls, tools, and agents.
 *
 * @example
 * ```typescript
 * import { ChatOpenAI } from '@langchain/openai';
 * import { AgentWatchCallbackHandler } from 'agent-watch/integrations/langchain';
 * import { createTracer } from 'agent-watch';
 *
 * const tracer = createTracer({ name: 'my-agent', store: 'sqlite' });
 * const trace = tracer.startTrace('langchain-run');
 * const handler = new AgentWatchCallbackHandler(trace);
 *
 * const llm = new ChatOpenAI({ callbacks: [handler] });
 * const result = await llm.invoke('Hello');
 * trace.end();
 * ```
 */

import { Trace } from '../tracer';
import { Span } from '../span';

type LLMStartInput = {
  name?: string;
  prompts?: string[];
  messages?: unknown[][];
  invocationParams?: Record<string, unknown>;
};

type LLMEndOutput = {
  generations?: Array<Array<{ text: string }>>;
  llmOutput?: Record<string, unknown>;
};

type ChainStartInput = {
  name?: string;
};

type ToolStartInput = {
  name?: string;
  input?: string;
};

/**
 * LangChain callback handler that creates spans for each LangChain event.
 */
export class AgentWatchCallbackHandler {
  private trace: Trace;
  private spans: Map<string, Span> = new Map();

  constructor(trace: Trace) {
    this.trace = trace;
  }

  handleLLMStart(
    _llm: Record<string, unknown>,
    _prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    name?: string
  ): void {
    const input = _llm as LLMStartInput;
    const span = this.trace.startSpan(`llm.${input.name ?? name ?? 'call'}`, {
      attributes: {
        runId,
        promptCount: _prompts.length,
        model: (_extraParams?.['invocation_params'] as Record<string, unknown>)?.['model_name'],
      },
    });
    this.spans.set(runId, span);
  }

  handleLLMEnd(output: LLMEndOutput, runId: string): void {
    const span = this.spans.get(runId);
    if (!span) return;

    const tokenUsage = output.llmOutput?.['tokenUsage'] as Record<string, number> | undefined;
    if (tokenUsage) {
      span.setAttributes({
        promptTokens: tokenUsage['promptTokens'],
        completionTokens: tokenUsage['completionTokens'],
        totalTokens: tokenUsage['totalTokens'],
      });
    }

    span.end('ok');
    this.spans.delete(runId);
  }

  handleLLMError(err: Error, runId: string): void {
    const span = this.spans.get(runId);
    if (!span) return;
    span.endWithError(err);
    this.spans.delete(runId);
  }

  handleChainStart(
    _chain: ChainStartInput,
    _inputs: Record<string, unknown>,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    _runType?: string,
    name?: string
  ): void {
    const span = this.trace.startSpan(`chain.${_chain.name ?? name ?? 'run'}`, {
      attributes: { runId },
    });
    this.spans.set(runId, span);
  }

  handleChainEnd(_outputs: Record<string, unknown>, runId: string): void {
    const span = this.spans.get(runId);
    if (!span) return;
    span.end('ok');
    this.spans.delete(runId);
  }

  handleChainError(err: Error, runId: string): void {
    const span = this.spans.get(runId);
    if (!span) return;
    span.endWithError(err);
    this.spans.delete(runId);
  }

  handleToolStart(
    tool: ToolStartInput,
    input: string,
    runId: string
  ): void {
    const span = this.trace.startSpan(`tool.${tool.name ?? 'call'}`, {
      attributes: { runId, input },
    });
    this.spans.set(runId, span);
  }

  handleToolEnd(output: string, runId: string): void {
    const span = this.spans.get(runId);
    if (!span) return;
    span.setAttributes({ output });
    span.end('ok');
    this.spans.delete(runId);
  }

  handleToolError(err: Error, runId: string): void {
    const span = this.spans.get(runId);
    if (!span) return;
    span.endWithError(err);
    this.spans.delete(runId);
  }
}
