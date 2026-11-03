import { afterAll, describe, expect, inject, it } from 'vitest';
import { SmtpEmailSender } from '../src/adapters/email/smtp.email.js';
import { S3ObjectStorage } from '../src/adapters/storage/s3.storage.js';

describe('S3ObjectStorage against an S3-compatible store', () => {
  const storage = new S3ObjectStorage({
    bucket: 'touchgrass-media-test',
    region: 'ap-south-1',
    endpoint: inject('s3Endpoint'),
    accessKeyId: 'touchgrass',
    secretAccessKey: 'touchgrass-secret',
    forcePathStyle: true,
    publicBaseUrl: `${inject('s3Endpoint')}/touchgrass-media-test`,
  });

  it('creates the bucket idempotently', async () => {
    await storage.ensureBucket();
    await storage.ensureBucket();
  });

  it('accepts a presigned POST upload within policy and rejects oversize files', async () => {
    const key = `profile/${Date.now()}/photo.jpg`;
    const up = await storage.createPresignedUpload(key, 'image/jpeg', 1024, 60);
    const post = (bytes: number): Promise<Response> => {
      const form = new FormData();
      for (const [k, v] of Object.entries(up.fields)) form.append(k, v);
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'photo.jpg');
      return fetch(up.url, { method: 'POST', body: form });
    };
    expect((await post(2048)).ok).toBe(false);
    const ok = await post(512);
    expect(ok.status).toBeLessThan(300);
    expect(await storage.head(key)).toEqual({ size: 512, contentType: 'image/jpeg' });
  });

  it('puts, gets, signs download URLs and deletes', async () => {
    const key = `lore/${Date.now()}/a b.webp`;
    await storage.put(key, Buffer.from('webp-bytes'), 'image/webp');
    expect((await storage.get(key)).toString()).toBe('webp-bytes');
    const signed = await storage.signedDownloadUrl(key, 60);
    expect(await (await fetch(signed)).text()).toBe('webp-bytes');
    expect(storage.publicUrl(key)).toMatch(/lore\/\d+\/a%20b\.webp$/);
    await storage.delete(key);
    expect(await storage.head(key)).toBeNull();
  });
});

describe('SmtpEmailSender against Mailpit', () => {
  afterAll(async () => {
    await fetch(`${inject('mailpitApi')}/api/v1/messages`, { method: 'DELETE' });
  });

  it('delivers a UTF-8 receipt', async () => {
    await new SmtpEmailSender(inject('smtpUrl'), 'TouchGrass <hello@touchgrass.app>').send({
      to: 'host@example.com',
      subject: 'Your TouchGrass receipt',
      html: '<p>₹499 for Sunday chai</p>',
      text: '₹499 for Sunday chai',
    });
    const res = (await (await fetch(`${inject('mailpitApi')}/api/v1/messages`)).json()) as {
      messages: { Subject: string; To: { Address: string }[] }[];
    };
    expect(res.messages[0]).toMatchObject({
      Subject: 'Your TouchGrass receipt',
      To: [{ Address: 'host@example.com' }],
    });
  });
});
