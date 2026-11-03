import type { InviteCode, MyInvites } from '@touchgrass/shared';

/** A shareable link: reuse a still-usable invite code, else fall back to the plain landing page. */
export function inviteUrl(
  invites: MyInvites | undefined,
  webUrl: string,
  now: Date = new Date(),
): string {
  const usable = invites?.items.find(
    (i: InviteCode) =>
      !i.revoked &&
      i.uses < i.maxUses &&
      (i.expiresAt === null || new Date(i.expiresAt).getTime() > now.getTime()),
  );
  return usable && invites ? `${invites.shareUrlBase}/${usable.code}` : webUrl;
}
