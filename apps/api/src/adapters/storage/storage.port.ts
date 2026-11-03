export interface PresignedUpload {
  /** POST target; the client sends multipart/form-data with `fields` followed by the file. */
  url: string;
  fields: Record<string, string>;
  key: string;
  expiresAt: Date;
}

export interface ObjectHead {
  size: number;
  contentType: string | undefined;
}

/** Object storage (S3 in production, S3-compatible store locally, in-memory in unit tests). */
export abstract class ObjectStorage {
  /** Presigned POST so the size limit and content type are enforced by the store, not the client. */
  abstract createPresignedUpload(
    key: string,
    contentType: string,
    maxBytes: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;
  abstract head(key: string): Promise<ObjectHead | null>;
  abstract get(key: string): Promise<Buffer>;
  abstract put(
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void>;
  abstract delete(key: string): Promise<void>;
  /** `signingDate` lets callers bucket signatures (e.g. per hour) so URLs are stable and cacheable. */
  abstract signedDownloadUrl(
    key: string,
    expiresInSeconds: number,
    signingDate?: Date,
  ): Promise<string>;
  abstract publicUrl(key: string): string;
  abstract ensureBucket(): Promise<void>;
}
