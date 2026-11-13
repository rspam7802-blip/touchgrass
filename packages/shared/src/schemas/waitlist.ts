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
});
export type LaunchWaitlistEntry = z.infer<typeof LaunchWaitlistEntry>;

export const LaunchWaitlistQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** `waiting` lists only people not invited yet. */
  status: z.enum(['waiting', 'all']).default('waiting'),
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
