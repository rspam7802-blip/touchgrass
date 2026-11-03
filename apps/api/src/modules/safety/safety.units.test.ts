import { describe, expect, it } from 'vitest';
import { istDayStart } from '../verification/verification.service.js';
import { signLiveToken, verifyLiveToken } from './live-link.js';

const SECRET = 'x'.repeat(48);
const ID = '01890a5d-ac96-774b-bcce-b302099a8057';

describe('live location links (F-WEB-02)', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  const later = new Date('2026-11-01T12:00:00Z');

  it('round-trips until the link expires', () => {
    const token = signLiveToken(ID, later, SECRET);
    expect(token).toMatch(/^[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyLiveToken(token, SECRET, now)).toBe(ID);
    expect(verifyLiveToken(token, SECRET, later)).toBeNull();
  });

  it('rejects other secrets, edited parts and junk', () => {
    const token = signLiveToken(ID, later, SECRET);
    const [id, exp, sig] = token.split('.') as [string, string, string];
    expect(verifyLiveToken(token, 'y'.repeat(48), now)).toBeNull();
    expect(verifyLiveToken(`${id}.${Number(exp) + 1}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyLiveToken(`${id.replace('a', 'b')}.${exp}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyLiveToken(`${id}.${exp}.${sig.slice(1)}`, SECRET, now)).toBeNull();
    expect(verifyLiveToken(`${id}.soon.${sig}`, SECRET, now)).toBeNull();
    expect(verifyLiveToken('a.b', SECRET, now)).toBeNull();
  });
});

describe('verification attempts reset at midnight IST (F-SAF-01)', () => {
  it('starts the day at 18:30 UTC the evening before', () => {
    expect(istDayStart(new Date('2026-11-01T10:00:00Z')).toISOString()).toBe(
      '2026-10-31T18:30:00.000Z',
    );
    // 00:15 IST on 2 Nov is already the new day.
    expect(istDayStart(new Date('2026-11-01T18:45:00Z')).toISOString()).toBe(
      '2026-11-01T18:30:00.000Z',
    );
  });
});
