import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { defaultPreference } from './account/settings.service.js';
import { normalizePhoneOrThrow } from './auth/auth.service.js';
import { isInviteUsable } from './invites/invites.service.js';
import { renderVariant } from './media/media.processor.js';

describe('invite usability', () => {
  const now = new Date('2026-10-31T00:00:00Z');
  const base = { uses: 0, maxUses: 1, revokedAt: null, expiresAt: null };
  it('requires unrevoked, unexpired codes with remaining uses', () => {
    expect(isInviteUsable(base, now)).toBe(true);
    expect(isInviteUsable({ ...base, uses: 1 }, now)).toBe(false);
    expect(isInviteUsable({ ...base, revokedAt: now }, now)).toBe(false);
    expect(isInviteUsable({ ...base, expiresAt: new Date('2026-10-30T00:00:00Z') }, now)).toBe(
      false,
    );
    expect(isInviteUsable({ ...base, expiresAt: new Date('2026-11-30T00:00:00Z') }, now)).toBe(
      true,
    );
  });
});

describe('notification defaults', () => {
  it('marketing pushes are opt-in, everything else on', () => {
    expect(defaultPreference('marketing')).toEqual({
      category: 'marketing',
      push: false,
      inApp: true,
    });
    expect(defaultPreference('squad')).toEqual({ category: 'squad', push: true, inApp: true });
  });
});

describe('phone normalisation at the edge', () => {
  it('returns E.164 or a validation error', () => {
    expect(normalizePhoneOrThrow('98480 22338')).toBe('+919848022338');
    expect(() => normalizePhoneOrThrow('123')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });
});

describe('image variants', () => {
  it('auto-rotates by EXIF orientation, never enlarges, and drops metadata', async () => {
    const portraitByExif = await sharp({
      create: { width: 400, height: 200, channels: 3, background: '#1FA637' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await renderVariant(portraitByExif, 1080);
    expect({ w: out.width, h: out.height }).toEqual({ w: 200, h: 400 });
    const meta = await sharp(out.buffer).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    await expect(renderVariant(Buffer.from('nope'), 160)).rejects.toThrow();
  });
});
