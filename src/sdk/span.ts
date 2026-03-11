import { randomUUID } from 'crypto';
import type { SpanStatus, SpanRecord } from '../types';

export class Span {
  readonly id: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startTime: number;

  private _endTime?: number;
  private _status: SpanStatus = 'running';
  private _attributes: Record<string, unknown> = {};
  private _errorMessage?: string;
  private _children: Span[] = [];
  private _onEnd?: (span: Span) => void;

  constructor(
    traceId: string,
    name: string,
    parentSpanId?: string,
    attributes?: Record<string, unknown>,
    onEnd?: (span: Span) => void
  ) {
    this.id = randomUUID();
    this.traceId = traceId;
    this.parentSpanId = parentSpanId;
    this.name = name;
    this.startTime = Date.now();
    this._onEnd = onEnd;
    if (attributes) {
      this._attributes = { ...attributes };
    }
  }

  /** Set or merge additional attributes on this span */
  setAttributes(attrs: Record<string, unknown>): this {
    this._attributes = { ...this._attributes, ...attrs };
    return this;
  }

  /** Add a child span */
  addChild(span: Span): void {
    this._children.push(span);
  }

  /** End the span with a status */
  end(status: SpanStatus = 'ok', errorMessage?: string): void {
    if (this._endTime !== undefined) return; // already ended
    this._endTime = Date.now();
    this._status = status;
    if (errorMessage) this._errorMessage = errorMessage;
    this._onEnd?.(this);
  }

  /** End the span with an error */
  endWithError(error: unknown): void {
    const msg =
      error instanceof Error ? error.message : String(error);
    this.end('error', msg);
  }

  get endTime(): number | undefined {
    return this._endTime;
  }

  get status(): SpanStatus {
    return this._status;
  }

  get attributes(): Record<string, unknown> {
    return { ...this._attributes };
  }

  get errorMessage(): string | undefined {
    return this._errorMessage;
  }

  get children(): Span[] {
    return [...this._children];
  }

  get durationMs(): number | undefined {
    if (this._endTime === undefined) return undefined;
    return this._endTime - this.startTime;
  }

  /** Serialize to a plain record for storage */
  toRecord(): SpanRecord {
    return {
      id: this.id,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTime: this.startTime,
      endTime: this._endTime,
      status: this._status,
      attributes: this._attributes,
      errorMessage: this._errorMessage,
    };
  }
}
