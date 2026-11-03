import { type ErrorCode, ErrorEnvelope } from '@touchgrass/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK',
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Client errors are not worth retrying; network and 5xx are. */
  get retryable(): boolean {
    return this.code === 'NETWORK' || this.status >= 500 || this.code === 'RATE_LIMITED';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  appVersion: string;
  getAccessToken?: () => string | null;
  /** Called once when the access token expired; returns a fresh token, or null to give up (signed out). */
  refreshAccessToken?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
}

/** Typed REST client. Every response is validated with the shared Zod schema; errors become ApiError. */
export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  get baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, '');
  }

  async request<T extends z.ZodType>(
    path: string,
    schema: T,
    opts: RequestOptions = {},
  ): Promise<z.infer<T>> {
    try {
      return await this.send(path, schema, opts, this.options.getAccessToken?.() ?? null);
    } catch (err) {
      if (
        !(err instanceof ApiError) ||
        err.code !== 'TOKEN_EXPIRED' ||
        !this.options.refreshAccessToken
      )
        throw err;
      const fresh = await this.options.refreshAccessToken();
      if (!fresh) throw err;
      return this.send(path, schema, opts, fresh);
    }
  }

  private async send<T extends z.ZodType>(
    path: string,
    schema: T,
    opts: RequestOptions,
    token: string | null,
  ): Promise<z.infer<T>> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-app-version': this.options.appVersion,
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
    if (token) headers.authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await (this.options.fetchFn ?? fetch)(`${this.baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch (err) {
      throw new ApiError(
        'NETWORK',
        err instanceof Error ? err.message : 'Network request failed',
        0,
      );
    }

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiError('INTERNAL', 'Malformed server response', res.status);
      }
    }
    if (!res.ok) {
      const envelope = ErrorEnvelope.safeParse(json);
      if (envelope.success) {
        throw new ApiError(
          envelope.data.error.code,
          envelope.data.error.message,
          res.status,
          envelope.data.error.details,
        );
      }
      throw new ApiError(
        res.status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED',
        `HTTP ${res.status}`,
        res.status,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new ApiError('INTERNAL', 'Unexpected response shape', res.status, parsed.error.issues);
    return parsed.data;
  }
}
