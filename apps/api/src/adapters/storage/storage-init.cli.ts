import { loadEnv } from '../../config/env.js';
import { S3ObjectStorage } from './s3.storage.js';

/** Idempotently creates the media bucket in the local S3-compatible store (used by `pnpm dev`). */
const env = loadEnv();
const storage = new S3ObjectStorage({
  bucket: env.S3_BUCKET_MEDIA,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
});
await storage.ensureBucket();
process.stdout.write(`bucket ready: ${env.S3_BUCKET_MEDIA}\n`);
