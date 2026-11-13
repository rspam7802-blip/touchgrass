import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type ObjectHead, ObjectStorage, type PresignedUpload } from './storage.port.js';

const SIGNED_CACHE_MAX = 50_000;

export interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  /**
   * Where phones reach the store, when that differs from where the server does (local development: the
   * server uses localhost, a phone on the same Wi-Fi uses the laptop's address). Upload forms and download
   * links are signed for this host; everything the server does itself uses `endpoint`.
   */
  publicEndpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
}

export class S3ObjectStorage extends ObjectStorage {
  private readonly client: S3Client;
  /** Signs URLs only (never connects), so the signature matches the host the phone will call. */
  private readonly signer: S3Client;
  /** Links signed for the current hour bucket (per process; a cache, never shared state). */
  private readonly signed = new Map<string, string>();
  private signedFor = 0;

  constructor(private readonly config: S3StorageConfig) {
    super();
    const make = (endpoint: string | undefined): S3Client =>
      new S3Client({
        region: config.region,
        endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials:
          config.accessKeyId && config.secretAccessKey
            ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
            : undefined,
      });
    this.client = make(config.endpoint);
    this.signer = config.publicEndpoint ? make(config.publicEndpoint) : this.client;
  }

  async createPresignedUpload(
    key: string,
    contentType: string,
    maxBytes: number,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const { url, fields } = await createPresignedPost(this.signer, {
      Bucket: this.config.bucket,
      Key: key,
      Conditions: [
        ['content-length-range', 1, maxBytes],
        ['eq', '$Content-Type', contentType],
      ],
      Fields: { 'Content-Type': contentType },
      Expires: expiresInSeconds,
    });
    return { url, fields, key, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return { size: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (err) {
      if (
        err instanceof NotFound ||
        (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404)
      )
        return null;
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Empty object body for ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async put(
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl = 'public, max-age=31536000, immutable',
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  /**
   * With a `signingDate` (media links are signed at the start of the hour), the link is the same for everyone
   * all hour, so phones can cache the image and we sign it once per process: signing runs the whole AWS
   * middleware stack and was the feed's biggest CPU cost. Without one, every link is fresh.
   */
  async signedDownloadUrl(
    key: string,
    expiresInSeconds: number,
    signingDate?: Date,
  ): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.config.bucket, Key: key });
    if (!signingDate) return getSignedUrl(this.signer, command, { expiresIn: expiresInSeconds });
    const bucket = signingDate.getTime();
    if (bucket !== this.signedFor) {
      this.signed.clear();
      this.signedFor = bucket;
    }
    const id = `${String(expiresInSeconds)}|${key}`;
    const hit = this.signed.get(id);
    if (hit) return hit;
    const url = await getSignedUrl(this.signer, command, {
      expiresIn: expiresInSeconds,
      signingDate,
    });
    if (this.signed.size >= SIGNED_CACHE_MAX) this.signed.clear();
    this.signed.set(id, url);
    return url;
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
    }
  }
}
