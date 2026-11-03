import { describe, expect, it } from 'vitest';
import {
  LocationPointBody,
  ResolveModerationBody,
  ReviewVerificationBody,
  SanctionBody,
  StartShareBody,
  SubmitVerificationBody,
  TrustedContactBody,
  VERIFICATION_POSES,
  VerificationPose,
} from './safety';

const UUID = '7b6f1c1e-6a3c-4d7a-9b1e-2f3c4d5e6f70';

describe('safety schemas (F-SAF-01, F-SAF-04, F-SAF-05)', () => {
  it('verification poses and submissions', () => {
    for (const p of VERIFICATION_POSES) expect(VerificationPose.parse(p)).toBe(p);
    expect(VerificationPose.safeParse('selfie').success).toBe(false);
    expect(SubmitVerificationBody.safeParse({ challengeId: UUID, mediaId: 'x' }).success).toBe(
      false,
    );
  });

  it('a rejection needs a reason, an approval does not', () => {
    expect(ReviewVerificationBody.parse({ decision: 'approved' })).toEqual({
      decision: 'approved',
      reason: null,
    });
    expect(ReviewVerificationBody.safeParse({ decision: 'rejected' }).success).toBe(false);
    expect(
      ReviewVerificationBody.parse({ decision: 'rejected', reason: 'POSE_MISMATCH' }).reason,
    ).toBe('POSE_MISMATCH');
  });

  it('trusted contacts need a name and an E.164 phone', () => {
    expect(TrustedContactBody.parse({ name: '  Amma ', phone: '+919876543210' })).toEqual({
      name: 'Amma',
      phone: '+919876543210',
    });
    expect(TrustedContactBody.safeParse({ name: '', phone: '+919876543210' }).success).toBe(false);
    expect(TrustedContactBody.safeParse({ name: 'Amma', phone: '98765' }).success).toBe(false);
  });

  it('shares last 15 minutes to 4 hours; points are bounded', () => {
    expect(StartShareBody.parse({ minutes: 60 })).toEqual({ eventId: null, minutes: 60 });
    expect(StartShareBody.safeParse({ minutes: 10 }).success).toBe(false);
    expect(StartShareBody.safeParse({ minutes: 241 }).success).toBe(false);
    expect(LocationPointBody.parse({ lat: 17.4, lng: 78.4 })).toEqual({
      lat: 17.4,
      lng: 78.4,
      accuracy: null,
    });
    expect(LocationPointBody.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(LocationPointBody.safeParse({ lat: 1, lng: 1, accuracy: 9999 }).success).toBe(false);
  });

  it('mutes and suspensions need a length, warnings and bans must not have one', () => {
    expect(SanctionBody.safeParse({ kind: 'mute', reason: 'spam in chat' }).success).toBe(false);
    expect(SanctionBody.parse({ kind: 'suspend', days: 7, reason: 'harassment' }).days).toBe(7);
    expect(SanctionBody.safeParse({ kind: 'ban', days: 7, reason: 'harassment' }).success).toBe(
      false,
    );
    expect(SanctionBody.parse({ kind: 'warn', reason: 'rude' })).toEqual({
      kind: 'warn',
      days: null,
      reason: 'rude',
    });
    expect(SanctionBody.safeParse({ kind: 'warn', reason: 'x' }).success).toBe(false);
  });

  it('resolving defaults to no sanction and no note', () => {
    expect(ResolveModerationBody.parse({ outcome: 'dismiss' })).toEqual({
      outcome: 'dismiss',
      sanction: null,
      note: '',
    });
  });
});
