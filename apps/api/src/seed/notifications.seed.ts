import type { NotificationKind, NotificationParams } from '@touchgrass/shared';
import { fillParams, NOTIFICATION_TEMPLATES } from '@touchgrass/shared';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '../infra/database/database.module.js';
import { notifications } from '../infra/database/schema/index.js';

export interface NotificationsSeedSummary {
  inboxItems: number;
}

const MIN = 60_000;

/**
 * Phase 10 seed (idempotent): seeded member #2 opens the app to a few inbox items (one unread squad request,
 * a plan reminder for their next plan, a badge), so the inbox and its deep links can be tried at once.
 */
export async function seedNotifications(
  tx: Tx,
  ctx: { memberIds: string[] },
  now: Date = new Date(),
): Promise<NotificationsSeedSummary> {
  const me = ctx.memberIds[1];
  const friend = ctx.memberIds[20];
  if (!me || !friend) throw new Error('Seed members #2 and #21 missing');
  const [has] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, me), eq(notifications.kind, 'friend_requested')))
    .limit(1);
  if (!has) {
    const names = await tx.execute<{ name: string }>(
      sql`SELECT display_name AS name FROM profiles WHERE user_id = ${friend}`,
    );
    const next = await tx.execute<{ id: string; title: string; starts_at: Date }>(sql`
      SELECT e.id, e.title, e.starts_at FROM events e JOIN rsvps r ON r.event_id = e.id
      WHERE r.user_id = ${me} AND r.status = 'going' AND e.status = 'published' AND e.starts_at > now()
      ORDER BY e.starts_at LIMIT 1`);
    const items: {
      kind: NotificationKind;
      params: NotificationParams;
      ago: number;
      read: boolean;
    }[] = [
      {
        kind: 'friend_requested',
        params: { name: names.rows[0]?.name ?? '' },
        ago: 25,
        read: false,
      },
      {
        kind: 'badge_earned',
        params: { emoji: '🌱', name: { en: 'Grass Toucher', te: 'గ్రాస్ టచర్', hi: 'ग्रास टचर' } },
        ago: 300,
        read: true,
      },
    ];
    const plan = next.rows[0];
    if (plan)
      items.push({
        kind: 'reminder_day',
        params: {
          title: plan.title,
          eventId: plan.id,
          when: { at: new Date(plan.starts_at).toISOString() },
        },
        ago: 90,
        read: false,
      });
    await tx.insert(notifications).values(
      items.map((i) => ({
        id: uuidv7(),
        userId: me,
        kind: i.kind,
        category: NOTIFICATION_TEMPLATES[i.kind].category,
        params: i.params,
        path: fillParams(NOTIFICATION_TEMPLATES[i.kind].link, i.params, 'en'),
        readAt: i.read ? new Date(now.getTime() - (i.ago - 5) * MIN) : null,
        createdAt: new Date(now.getTime() - i.ago * MIN),
      })),
    );
  }
  const total = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM notifications`);
  return { inboxItems: total.rows[0]?.n ?? 0 };
}
