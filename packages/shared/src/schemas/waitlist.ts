import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../constants';
import { normalizeE164 } from '../phone';

/**
 * City as typed on the website, kept as a slug ("Hyderabad" → "hyderabad", "Navi Mumbai" → "navi-mumbai").
 * Letters of any script are kept so a city typed in Telugu or Hindi is not lost.
 */
export function waitlistCitySlug(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Public launch waitlist (D-169): people without an invite leave a contact so the team can invite them. */
/** utm_source as stored: lower-case letters, digits, - and _, at most 32; anything else is no source. */
export function normalizeWaitlistSource(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(v) ? v : null;
}

export const LaunchWaitlistBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    /** Indian mobile number in any common format; stored as E.164. */
    phone: z
      .string()
      .trim()
      .max(20)
      .optional()
      .transform((raw, ctx) => {
        if (raw === undefined || raw === '') return null;
        const e164 = normalizeE164(raw);
        if (!e164?.startsWith('+91')) {
          ctx.addIssue({ code: 'custom', message: 'Enter a valid Indian mobile number' });
          return z.NEVER;
        }
        return e164;
      }),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.union([z.null(), z.email()])),
    city: z
      .string()
      .trim()
      .max(60)
      .default('Hyderabad')
      .transform((raw, ctx) => {
        const slug = waitlistCitySlug(raw === '' ? 'Hyderabad' : raw);
        if (slug.length < 2) {
          ctx.addIssue({ code: 'custom', message: 'Enter a city' });
          return z.NEVER;
        }
        return slug;
      }),
    note: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : null)),
    language: z.enum(SUPPORTED_LANGUAGES).default('en'),
    /** Where they came from (D-191): the link's utm_source, normalised; anything odd is dropped. */
    source: z
      .string()
      .trim()
      .toLowerCase()
      .max(64)
      .optional()
      .transform((v) => normalizeWaitlistSource(v)),
    /** A friend's referral code from the link (?ref=), if any; checked by the API. */
    ref: z
      .string()
      .trim()
      .toUpperCase()
      .max(32)
      .optional()
      .transform((v) => (v ? v : null)),
    consent: z.literal(true),
  })
  .refine((b) => b.phone !== null || b.email !== null, {
    message: 'Give a phone number or an email',
    path: ['contact'],
  });
/** What the API works with after validation (E.164 phone, lower-case email, city slug). */
export type LaunchWaitlistBody = z.infer<typeof LaunchWaitlistBody>;
/** What a client sends. */
export type LaunchWaitlistInput = z.input<typeof LaunchWaitlistBody>;

/** Same answer whether the contact was new or already on the list. */
export const LaunchWaitlistResponse = z.object({ received: z.literal(true) });
export type LaunchWaitlistResponse = z.infer<typeof LaunchWaitlistResponse>;

export const LaunchWaitlistEntry = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  city: z.string(),
  note: z.string().nullable(),
  language: z.enum(SUPPORTED_LANGUAGES),
  createdAt: z.iso.datetime(),
  invitedAt: z.iso.datetime().nullable(),
  inviteCode: z.string().nullable(),
  /** Where they came from (D-191), null when unknown. */
  source: z.string().nullable().optional(),
  /** The member whose referral link brought them. */
  referrer: z.object({ id: z.uuid(), name: z.string() }).nullable().optional(),
  /** When they signed up with the code we sent (D-195); null while they have not. */
  joinedAt: z.iso.datetime().nullable().optional(),
  /** Last time they were invited again, and how many times (D-195). */
  reinvitedAt: z.iso.datetime().nullable().optional(),
  reinviteCount: z.number().int().optional(),
});
export type LaunchWaitlistEntry = z.infer<typeof LaunchWaitlistEntry>;

/** Someone can be invited again once a day at most (D-195). */
export const WAITLIST_REINVITE_COOLDOWN_HOURS = 24;

export const LaunchWaitlistQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** `waiting`: not invited yet; `invited`: invited but not signed up yet (D-195); `all`: everyone. */
  status: z.enum(['waiting', 'invited', 'all']).default('waiting'),
});
export type LaunchWaitlistQuery = z.infer<typeof LaunchWaitlistQuery>;

export const LaunchWaitlistInviteResult = z.object({
  entry: LaunchWaitlistEntry,
  code: z.string(),
  /** True when the code was also emailed to the entry's address. */
  emailed: z.boolean(),
  /** Why the email did not go out (the mail service's answer), for the admin who sent it. */
  emailError: z.string().nullable().optional(),
});
export type LaunchWaitlistInviteResult = z.infer<typeof LaunchWaitlistInviteResult>;

/** Waitlist insights (D-191): over the last 7, 30 or 90 days. */
export const WaitlistInsightsQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [7, 30, 90].includes(d), 'Use 7, 30 or 90')
    .default(30),
});
export type WaitlistInsightsQuery = z.infer<typeof WaitlistInsightsQuery>;

const Count = z.object({ key: z.string(), count: z.number().int() });
export const WaitlistInsights = z.object({
  days: z.number().int(),
  totals: z.object({
    allTime: z.number().int(),
    inPeriod: z.number().int(),
    today: z.number().int(),
    last7Days: z.number().int(),
    waiting: z.number().int(),
  }),
  /** Per day in IST, oldest first: sign-ups and invites sent that day. */
  daily: z.array(
    z.object({ day: z.iso.date(), signedUp: z.number().int(), invited: z.number().int() }),
  ),
  byCity: z.array(Count),
  byLanguage: z.array(Count),
  /** `unknown` for entries without a source. */
  bySource: z.array(Count),
  /** phone, email or both. */
  byContact: z.array(Count),
  /** Members whose referral links brought people, most first. */
  byReferrer: z.array(z.object({ id: z.uuid(), name: z.string(), count: z.number().int() })),
  /** People who signed up in the period, and how far they got. */
  funnel: z.object({
    signedUp: z.number().int(),
    invited: z.number().int(),
    joinedApp: z.number().int(),
    finishedProfile: z.number().int(),
  }),
});
export type WaitlistInsights = z.infer<typeof WaitlistInsights>;
