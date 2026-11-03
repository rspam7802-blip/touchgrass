import { z } from 'zod';

export const InviteCode = z.object({
  id: z.uuid(),
  code: z.string(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  expiresAt: z.iso.datetime().nullable(),
  revoked: z.boolean(),
  label: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type InviteCode = z.infer<typeof InviteCode>;

export const MyInvites = z.object({
  quota: z.number().int(),
  remaining: z.number().int(),
  items: z.array(InviteCode),
  shareUrlBase: z.url(),
});
export type MyInvites = z.infer<typeof MyInvites>;

export const BulkInviteBody = z.object({
  count: z.number().int().min(1).max(500),
  maxUses: z.number().int().min(1).max(10_000).default(1),
  expiresAt: z.iso.datetime().nullable().default(null),
  label: z.string().trim().min(1).max(60),
});
export type BulkInviteBody = z.infer<typeof BulkInviteBody>;
