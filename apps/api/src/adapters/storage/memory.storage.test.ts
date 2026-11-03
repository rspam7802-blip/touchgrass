import { describe, expect, it } from 'vitest';
import { MemoryObjectStorage } from './memory.storage.js';

describe('MemoryObjectStorage', () => {
  it('enforces presigned upload policy', async () => {
    const s = new MemoryObjectStorage();
    const up = await s.createPresignedUpload('u/1.jpg', 'image/jpeg', 10, 60);
    expect(up.fields.key).toBe('u/1.jpg');
    expect(() => s.simulateUpload('u/2.jpg', Buffer.from('x'), 'image/jpeg')).toThrow(
      /No presigned/,
    );
    expect(() => s.simulateUpload('u/1.jpg', Buffer.from('x'), 'image/png')).toThrow(
      /Content-Type/,
    );
    expect(() => s.simulateUpload('u/1.jpg', Buffer.alloc(11), 'image/jpeg')).toThrow(/length/);
    s.simulateUpload('u/1.jpg', Buffer.from('hello'), 'image/jpeg');
    expect(await s.head('u/1.jpg')).toEqual({ size: 5, contentType: 'image/jpeg' });
    expect((await s.get('u/1.jpg')).toString()).toBe('hello');
  });
  it('rejects expired uploads', async () => {
    const s = new MemoryObjectStorage();
    await s.createPresignedUpload('k', 'image/jpeg', 10, -1);
    expect(() => s.simulateUpload('k', Buffer.from('x'), 'image/jpeg')).toThrow(/expired/);
  });
  it('puts, deletes and builds urls', async () => {
    const s = new MemoryObjectStorage('http://cdn');
    await s.ensureBucket();
    await s.put('a/b.webp', Buffer.from('x'), 'image/webp');
    expect(s.publicUrl('a/b.webp')).toBe('http://cdn/a/b.webp');
    expect(await s.signedDownloadUrl('a/b.webp', 60)).toContain('expires=60');
    await s.delete('a/b.webp');
    expect(await s.head('a/b.webp')).toBeNull();
    await expect(s.get('a/b.webp')).rejects.toThrow();
  });
});
