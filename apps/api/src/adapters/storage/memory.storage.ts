import { type ObjectHead, ObjectStorage, type PresignedUpload } from './storage.port.js';

/** In-memory object store for unit tests. `simulateUpload` stands in for the client's presigned POST. */
export class MemoryObjectStorage extends ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  private readonly pending = new Map<
    string,
    { contentType: string; maxBytes: number; expiresAt: Date }
  >();

  constructor(private readonly baseUrl = 'http://media.test') {
    super();
  }

  createPresignedUpload(
    key: string,
    contentType: string,
    maxBytes: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    this.pending.set(key, { contentType, maxBytes, expiresAt });
    return Promise.resolve({
      url: `${this.baseUrl}/upload`,
      fields: { key, 'Content-Type': contentType },
      key,
      expiresAt,
    });
  }

  simulateUpload(key: string, body: Buffer, contentType: string): void {
    const policy = this.pending.get(key);
    if (!policy) throw new Error('No presigned upload for key');
    if (policy.expiresAt.getTime() < Date.now()) throw new Error('Presigned upload expired');
    if (policy.contentType !== contentType) throw new Error('Content-Type does not match policy');
    if (body.length < 1 || body.length > policy.maxBytes)
      throw new Error('Content length outside policy');
    this.pending.delete(key);
    this.objects.set(key, { body, contentType });
  }

  head(key: string): Promise<ObjectHead | null> {
    const obj = this.objects.get(key);
    return Promise.resolve(obj ? { size: obj.body.length, contentType: obj.contentType } : null);
  }

  get(key: string): Promise<Buffer> {
    const obj = this.objects.get(key);
    return obj ? Promise.resolve(obj.body) : Promise.reject(new Error(`No such key ${key}`));
  }

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  signedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    return Promise.resolve(
      `${this.baseUrl}/${encodeURIComponent(key)}?expires=${expiresInSeconds}`,
    );
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  ensureBucket(): Promise<void> {
    return Promise.resolve();
  }
}
