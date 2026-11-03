/**
 * A short-lived, per-process copy of a small, admin-edited table (catalog, cities). Reads within `ttlMs`
 * share one load; concurrent misses share one in-flight query. Edits invalidate the copy in the process
 * that made them; other API processes see them within `ttlMs` (D-130). Never use it for user data.
 */
export class Snapshot<T> {
  private value: { at: number; data: T } | null = null;
  private inflight: Promise<T> | null = null;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<T> {
    if (this.value && this.now() - this.value.at < this.ttlMs) return this.value.data;
    if (this.inflight) return this.inflight;
    const loading = this.load().then(
      (data) => {
        this.value = { at: this.now(), data };
        this.inflight = null;
        return data;
      },
      (err: unknown) => {
        this.inflight = null;
        throw err;
      },
    );
    this.inflight = loading;
    return loading;
  }

  invalidate(): void {
    this.value = null;
  }
}
