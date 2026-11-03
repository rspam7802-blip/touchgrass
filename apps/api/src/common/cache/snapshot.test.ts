import { describe, expect, it, vi } from 'vitest';
import { Snapshot } from './snapshot.js';

describe('Snapshot', () => {
  it('serves one load within the TTL, shares in-flight loads, and reloads after expiry or invalidation', async () => {
    let t = 0;
    const load = vi.fn(() => Promise.resolve(t));
    const s = new Snapshot(load, 1000, () => t);
    expect(await Promise.all([s.get(), s.get()])).toEqual([0, 0]);
    expect(load).toHaveBeenCalledTimes(1);
    t = 999;
    expect(await s.get()).toBe(0);
    t = 1000;
    expect(await s.get()).toBe(1000);
    s.invalidate();
    expect(await s.get()).toBe(1000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not keep a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(1);
    const s = new Snapshot<number>(load, 1000);
    await expect(s.get()).rejects.toThrow('down');
    expect(await s.get()).toBe(1);
  });
});
