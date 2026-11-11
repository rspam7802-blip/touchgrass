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
