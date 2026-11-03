import { AppError } from '../../common/errors/app-error.js';

export type FetchFn = typeof fetch;

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export class UpstreamError extends AppError {
  constructor(
    public readonly provider: string,
    public readonly upstreamStatus: number,
    public readonly upstreamBody: string,
  ) {
    super('DEPENDENCY_UNAVAILABLE', `${provider} request failed with status ${upstreamStatus}`);
    this.name = 'UpstreamError';
  }
}

/** JSON-over-HTTP helper shared by real adapters. Bounded by a timeout; non-2xx becomes UpstreamError. */
export async function requestJson<T>(
  fetchFn: FetchFn,
  provider: string,
  url: string,
  req: HttpRequest = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, req.timeoutMs ?? 8000);
  try {
    const res = await fetchFn(url, {
      method: req.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...req.headers,
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new UpstreamError(provider, res.status, text.slice(0, 500));
    return (text ? JSON.parse(text) : {}) as T;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(provider, 0, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}
