import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed, expiring viewer links for live location (F-WEB-02): `<shareId>.<expiresAtSeconds>.<signature>`.
 * Nothing is stored for the token itself; the share row decides whether there is still anything to show.
 */
export function signLiveToken(shareId: string, expiresAt: Date, secret: string): string {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return `${shareId}.${exp}.${signature(shareId, exp, secret)}`;
}

/** The share id if the token is genuine and not yet expired; null otherwise. */
export function verifyLiveToken(token: string, secret: string, now: Date): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [shareId, expRaw, sig] = parts as [string, string, string];
  if (!/^\d{1,12}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  const expected = Buffer.from(signature(shareId, exp, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (exp * 1000 <= now.getTime()) return null;
  return shareId;
}

function signature(shareId: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`live:${shareId}:${exp}`).digest('base64url');
}
