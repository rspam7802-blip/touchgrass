import { canAccessSection, LaunchWaitlistEntry, paginated } from '@touchgrass/shared';
import type { z } from 'zod';
import { currentRoles } from '../../../../../lib/admin-nav';
import { adminApi } from '../../../../../lib/admin-session';

export const dynamic = 'force-dynamic';

const MAX_PAGES = 100;
const Page = paginated(LaunchWaitlistEntry);
type Page = z.infer<typeof Page>;
const cell = (v: string | null | undefined): string => {
  const s = (v ?? '').replace(/\r?\n/g, ' ');
  // Quote everything; a leading = + - @ would run as a formula in a spreadsheet.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** The waitlist as a CSV file (D-191), all pages, newest first. */
export async function GET(request: Request): Promise<Response> {
  if (!canAccessSection(await currentRoles(), 'waitlist'))
    return new Response('Forbidden', { status: 403 });
  const status = new URL(request.url).searchParams.get('status') === 'all' ? 'all' : 'waiting';
  const lines = [
    [
      'Name',
      'Phone',
      'Email',
      'City',
      'Language',
      'Source',
      'Referred by',
      'Wants to do',
      'Signed up',
      'Invited',
      'Invite code',
    ]
      .map(cell)
      .join(','),
  ];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const qs: URLSearchParams = new URLSearchParams({
      limit: '100',
      status,
      ...(cursor ? { cursor } : {}),
    });
    const page: Page = await adminApi(`/v1/admin/waitlist?${qs.toString()}`, Page);
    for (const e of page.items)
      lines.push(
        [
          e.name,
          e.phone,
          e.email,
          e.city,
          e.language,
          e.source ?? '',
          e.referrer?.name ?? '',
          e.note,
          e.createdAt,
          e.invitedAt,
          e.inviteCode,
        ]
          .map(cell)
          .join(','),
      );
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${lines.join('\r\n')}\r\n`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="touchgrass-waitlist-${day}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
