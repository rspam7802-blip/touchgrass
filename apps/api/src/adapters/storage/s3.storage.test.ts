import { describe, expect, it } from 'vitest';
import { S3ObjectStorage } from './s3.storage.js';

const base = {
  bucket: 'touchgrass-media',
  region: 'ap-south-1',
  accessKeyId: 'k',
  secretAccessKey: 's',
  forcePathStyle: true,
  publicBaseUrl: 'http://localhost:9000/touchgrass-media',
};

describe('S3ObjectStorage public endpoint', () => {
  it('signs phone-facing links and upload forms for the public address', async () => {
    const s3 = new S3ObjectStorage({
      ...base,
      endpoint: 'http://localhost:9000',
      publicEndpoint: 'http://192.168.1.5:9000',
    });
    expect(await s3.signedDownloadUrl('media/a/lg.webp', 60)).toMatch(
      /^http:\/\/192\.168\.1\.5:9000\/touchgrass-media\/media\/a\/lg\.webp\?/,
    );
    const upload = await s3.createPresignedUpload('uploads/a/original', 'image/jpeg', 10, 60);
    expect(upload.url).toBe('http://192.168.1.5:9000/touchgrass-media');
  });

  it('uses the server endpoint for links when no public one is set', async () => {
    const s3 = new S3ObjectStorage({ ...base, endpoint: 'http://localhost:9000' });
    expect(await s3.signedDownloadUrl('media/a/lg.webp', 60)).toMatch(/^http:\/\/localhost:9000\//);
  });
});

describe('S3ObjectStorage hourly links', () => {
  const s3 = new S3ObjectStorage({ ...base, endpoint: 'http://localhost:9000' });
  const hour = new Date('2026-11-13T10:00:00Z');

  it('signs at the given hour, so the same image has the same link all hour (phones can cache it)', async () => {
    const a = await s3.signedDownloadUrl('media/a/lg.webp', 7200, hour);
    const b = await s3.signedDownloadUrl('media/a/lg.webp', 7200, new Date(hour));
    expect(a).toBe(b);
    expect(a).toContain('X-Amz-Date=20261113T100000Z');
    expect(a).toContain('X-Amz-Expires=7200');
    expect(await s3.signedDownloadUrl('media/b/lg.webp', 7200, hour)).not.toBe(a);
  });

  it('a new hour gives a new link', async () => {
    const a = await s3.signedDownloadUrl('media/a/lg.webp', 7200, hour);
    const next = await s3.signedDownloadUrl(
      'media/a/lg.webp',
      7200,
      new Date(hour.getTime() + 3_600_000),
    );
    expect(next).not.toBe(a);
    expect(next).toContain('X-Amz-Date=20261113T110000Z');
  });

  it('links without an hour are always fresh', async () => {
    const a = await s3.signedDownloadUrl('media/a/lg.webp', 60);
    expect(a).not.toContain('X-Amz-Date=20261113T100000Z');
  });
});
