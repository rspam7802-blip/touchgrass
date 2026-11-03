import { z } from 'zod';
import { LIMITS } from '../constants';
import { NotificationCategory } from '../enums';
import { parseClock } from '../notifications';
import { MediaVariants } from './media';

// ---------- inbox (F-NOT-01) ----------

export const NotificationItem = z.object({
  id: z.uuid(),
  kind: z.string(),
  category: NotificationCategory,
  title: z.string(),
  body: z.string(),
  /** Deep link, `touchgrass://…`. */
  url: z.string(),
  read: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationPage = z.object({
  items: z.array(NotificationItem),
  unread: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPage>;

export const UnreadCount = z.object({ unread: z.number().int() });
export type UnreadCount = z.infer<typeof UnreadCount>;

export const MarkNotificationsReadBody = z
  .object({
    ids: z.array(z.uuid()).min(1).max(LIMITS.notifications.inboxPageMax).optional(),
    all: z.literal(true).optional(),
  })
  .refine((b) => (b.ids === undefined) !== (b.all === undefined), {
    message: 'Pass ids or all, not both',
  });
export type MarkNotificationsReadBody = z.infer<typeof MarkNotificationsReadBody>;

const Clock = z.string().refine((v) => parseClock(v) !== null, { message: 'Use HH:MM' });

export const QuietHours = z.object({ enabled: z.boolean(), start: Clock, end: Clock });
export type QuietHours = z.infer<typeof QuietHours>;

// ---------- calendar (F-CAL-01) ----------

export const CalendarFeed = z.object({
  /** https URL of the private feed (keep it secret: anyone with it sees your plans). */
  url: z.url(),
  /** Same feed for calendar apps that subscribe via webcal://. */
  webcalUrl: z.string(),
});
export type CalendarFeed = z.infer<typeof CalendarFeed>;

// ---------- analytics (F-PLT-05) ----------

/** Things only the app knows about; everything else is tracked server-side from domain events. */
export const CLIENT_ANALYTICS_EVENTS = [
  'app_opened',
  'screen_viewed',
  'share_tapped',
  'calendar_added',
  'calendar_subscribed',
  'notification_opened',
  'update_prompt_shown',
  'offline_shown',
] as const;
export const ClientAnalyticsEventName = z.enum(CLIENT_ANALYTICS_EVENTS);
export type ClientAnalyticsEventName = z.infer<typeof ClientAnalyticsEventName>;

export const ClientAnalyticsBody = z.object({
  events: z
    .array(
      z.object({
        name: ClientAnalyticsEventName,
        at: z.iso.datetime().optional(),
        properties: z
          .record(
            z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
            z.union([z.string().max(100), z.number(), z.boolean(), z.null()]),
          )
          .default({}),
      }),
    )
    .min(1)
    .max(LIMITS.analytics.maxClientEvents),
});
export type ClientAnalyticsBody = z.infer<typeof ClientAnalyticsBody>;

// ---------- share pages (F-GRW-02) ----------

export const PublicProfileView = z.object({
  id: z.uuid(),
  displayName: z.string(),
  verified: z.boolean(),
  /** Only when the profile is visible to everyone. */
  photo: MediaVariants.nullable(),
});
export type PublicProfileView = z.infer<typeof PublicProfileView>;

export const PublicCrewView = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  memberCount: z.number().int(),
  cover: MediaVariants.nullable(),
});
export type PublicCrewView = z.infer<typeof PublicCrewView>;
