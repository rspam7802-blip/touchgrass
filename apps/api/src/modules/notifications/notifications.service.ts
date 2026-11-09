import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  decodeCursor,
  DEFAULT_QUIET_WINDOW,
  encodeCursor,
  fillParams,
  formatClock,
  inQuietWindow,
  isNotificationKind,
  LIMITS,
  type NotificationCategory,
  type NotificationItem,
  type NotificationKind,
  type NotificationPage,
  NOTIFICATION_TEMPLATES,
  type NotificationParams,
  type NotificationTemplate,
  parseClock,
  type QuietHours,
  type QuietWindow,
  quietWindowEnd,
  renderNotification,
  type SupportedLanguage,
  TimeIdCursor,
  translate,
} from '@touchgrass/shared';
import { and, asc, count, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  notifications,
  notificationSettings,
  pendingPushes,
} from '../../infra/database/schema/index.js';
import { SettingsService } from '../account/settings.service.js';
import { UsersService } from '../users/users.service.js';
import { PushDispatchService } from './push-dispatch.service.js';
import {
  type OverrideMap,
  overrideKey,
  TemplateOverridesService,
} from './template-overrides.service.js';

const SCHEME = 'touchgrass://';
const N = LIMITS.notifications;

export interface NotifyResult {
  inbox: number;
  pushed: number;
  deferred: number;
}

type PendingRow = typeof pendingPushes.$inferSelect;

/**
 * The notification engine (F-NOT-01). One call writes the inbox item (in-app preference permitting) and
 * delivers the push: right away, or held for the person's quiet hours, or batched with other low-priority
 * pushes into a digest. Copy is rendered from shared templates in each reader's language.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly push: PushDispatchService,
    private readonly overrides: TemplateOverridesService,
  ) {}

  // ---------- quiet hours ----------

  private async windows(userIds: string[]): Promise<Map<string, QuietWindow>> {
    const out = new Map(userIds.map((id) => [id, DEFAULT_QUIET_WINDOW]));
    if (userIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(notificationSettings)
      .where(inArray(notificationSettings.userId, userIds));
    for (const r of rows)
      out.set(r.userId, { enabled: r.quietEnabled, start: r.quietStart, end: r.quietEnd });
    return out;
  }

  async quietHours(userId: string): Promise<QuietHours> {
    const w = (await this.windows([userId])).get(userId) ?? DEFAULT_QUIET_WINDOW;
    return { enabled: w.enabled, start: formatClock(w.start), end: formatClock(w.end) };
  }

  async setQuietHours(userId: string, body: QuietHours): Promise<QuietHours> {
    const values = {
      quietEnabled: body.enabled,
      quietStart: parseClock(body.start) ?? DEFAULT_QUIET_WINDOW.start,
      quietEnd: parseClock(body.end) ?? DEFAULT_QUIET_WINDOW.end,
    };
    await this.db
      .insert(notificationSettings)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: notificationSettings.userId, set: values });
    return this.quietHours(userId);
  }

  // ---------- sending ----------

  /** Writes inbox items and delivers (or schedules) pushes for one notification to many people. */
  async notify(
    userIds: string[],
    kind: NotificationKind,
    params: NotificationParams,
    opts: { collapseKey?: string; now?: Date; tx?: Tx } = {},
  ): Promise<NotifyResult> {
    const now = opts.now ?? new Date();
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return { inbox: 0, pushed: 0, deferred: 0 };
    const t: NotificationTemplate = NOTIFICATION_TEMPLATES[kind];
    const path = fillParams(t.link, params, 'en');
    const prefs = await this.settings.channelPrefs(ids, t.category);

    // Inbox first, so the push can carry the item's id (opening the push marks it read).
    const inboxIds = new Map<string, string>();
    const inboxFor =
      'inbox' in t && t.inbox === false ? [] : ids.filter((id) => prefs.get(id)?.inApp !== false);
    if (inboxFor.length > 0) {
      const rows = inboxFor.map((userId) => ({
        id: uuidv7(),
        userId,
        kind,
        category: t.category,
        params,
        path,
      }));
      await (opts.tx ?? this.db).insert(notifications).values(rows);
      for (const r of rows) inboxIds.set(r.userId, r.id);
    }

    const pushFor = ids.filter((id) => prefs.get(id)?.push !== false);
    const urgent = t.urgent ?? false;
    const batch = t.batch ?? false;
    const windows = urgent ? new Map<string, QuietWindow>() : await this.windows(pushFor);
    const nowList: string[] = [];
    const later: (typeof pendingPushes.$inferInsert)[] = [];
    for (const userId of pushFor) {
      const w = windows.get(userId) ?? DEFAULT_QUIET_WINDOW;
      const at = batch ? new Date(now.getTime() + N.batchWindowMs) : now;
      const deliverAfter = urgent ? now : quietWindowEnd(at, w);
      if (deliverAfter.getTime() <= now.getTime()) nowList.push(userId);
      else
        later.push({
          id: uuidv7(),
          userId,
          notificationId: inboxIds.get(userId) ?? null,
          kind,
          category: t.category,
          params,
          path,
          collapseKey: opts.collapseKey ?? null,
          deliverAfter,
        });
    }
    if (later.length > 0) await (opts.tx ?? this.db).insert(pendingPushes).values(later);
    let pushed = 0;
    const overrides: OverrideMap = nowList.length > 0 ? await this.overrides.all() : new Map();
    if (nowList.length > 0)
      pushed = await this.push.sendToUsers(nowList, t.category, (lang, userId) => {
        const r = renderNotification(kind, params, lang, overrides.get(overrideKey(kind, lang)));
        const notificationId = inboxIds.get(userId);
        return {
          title: r.title,
          body: r.body,
          data: { url: `${SCHEME}${r.path}`, ...(notificationId ? { notificationId } : {}) },
          collapseKey: opts.collapseKey,
        };
      });
    return { inbox: inboxIds.size, pushed, deferred: later.length };
  }

  /**
   * Worker, every minute: sends held pushes that are due. Several for one person go out as a single digest
   * pointing at the inbox. Rows are claimed with SKIP LOCKED so replicas never double-send.
   */
  async flushPending(now: Date = new Date()): Promise<number> {
    const claimed = await this.db.transaction(async (tx) => {
      const res = await tx.execute<{ id: string }>(sql`
        SELECT id FROM pending_pushes WHERE deliver_after <= ${now}
        ORDER BY deliver_after LIMIT 1000 FOR UPDATE SKIP LOCKED`);
      const ids = res.rows.map((r) => r.id);
      if (ids.length === 0) return [];
      return tx.delete(pendingPushes).where(inArray(pendingPushes.id, ids)).returning();
    });
    if (claimed.length === 0) return 0;
    const byUser = new Map<string, PendingRow[]>();
    for (const r of claimed) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
    const windows = await this.windows([...byUser.keys()]);
    let sent = 0;
    for (const [userId, rows] of byUser) {
      const w = windows.get(userId) ?? DEFAULT_QUIET_WINDOW;
      // Quiet hours may have been switched on after these were queued: hold them until they end.
      if (inQuietWindow(now, w)) {
        const until = quietWindowEnd(now, w);
        await this.db
          .insert(pendingPushes)
          .values(rows.map((r) => ({ ...r, deliverAfter: until })));
        continue;
      }
      try {
        sent += await this.deliverGroup(userId, rows);
      } catch (err) {
        this.logger.warn(
          `Held push delivery failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return sent;
  }

  private async deliverGroup(userId: string, rows: PendingRow[]): Promise<number> {
    // One per collapse key: only the newest of a run of updates about the same thing matters.
    const latest = new Map<string, PendingRow>();
    for (const r of rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()))
      latest.set(r.collapseKey ?? r.id, r);
    const items = [...latest.values()].filter((r) => isNotificationKind(r.kind));
    const first = items[0];
    if (!first) return 0;
    const category = first.category as NotificationCategory;
    const overrides = await this.overrides.all();
    const copy = (lang: SupportedLanguage) => overrides.get(overrideKey(first.kind, lang));
    if (items.length === 1)
      return this.push.sendToUsers([userId], category, (lang) => {
        const r = renderNotification(
          first.kind as NotificationKind,
          toParams(first.params),
          lang,
          copy(lang),
        );
        return {
          title: r.title,
          body: r.body,
          data: {
            url: `${SCHEME}${r.path}`,
            ...(first.notificationId ? { notificationId: first.notificationId } : {}),
          },
          collapseKey: first.collapseKey ?? undefined,
        };
      });
    return this.push.sendToUsers([userId], category, (lang) => {
      const head = renderNotification(
        first.kind as NotificationKind,
        toParams(first.params),
        lang,
        copy(lang),
      );
      return {
        title: fillParams(
          translate('notifications.digestTitle', lang),
          { count: items.length },
          lang,
        ),
        body: fillParams(translate('notifications.digestBody', lang), { first: head.title }, lang),
        data: { url: `${SCHEME}notifications` },
        collapseKey: 'digest',
      };
    });
  }

  // ---------- inbox ----------

  private toItem(
    row: typeof notifications.$inferSelect,
    lang: SupportedLanguage,
    overrides: OverrideMap,
  ): NotificationItem | null {
    if (!isNotificationKind(row.kind)) return null;
    const r = renderNotification(
      row.kind,
      toParams(row.params),
      lang,
      overrides.get(overrideKey(row.kind, lang)),
    );
    return {
      id: row.id,
      kind: row.kind,
      category: row.category as NotificationCategory,
      title: r.title,
      body: r.body,
      url: `${SCHEME}${row.path}`,
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async unread(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return row?.n ?? 0;
  }

  async page(userId: string, cursor: string | undefined, limit: number): Promise<NotificationPage> {
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const [rows, langs, unread] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            after
              ? or(
                  lt(notifications.createdAt, new Date(after.t)),
                  and(
                    eq(notifications.createdAt, new Date(after.t)),
                    lt(notifications.id, after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit + 1),
      this.users.languages([userId]),
      this.unread(userId),
    ]);
    const lang = langs.get(userId) ?? 'en';
    const overrides = await this.overrides.all();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.flatMap((r) => {
        const item = this.toItem(r, lang, overrides);
        return item ? [item] : [];
      }),
      unread,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async markRead(
    userId: string,
    target: { ids?: string[]; all?: true },
    now: Date = new Date(),
  ): Promise<number> {
    await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          target.ids ? inArray(notifications.id, target.ids) : undefined,
        ),
      );
    return this.unread(userId);
  }

  /** Worker, daily: inbox items older than 90 days go. */
  async purgeOld(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .delete(notifications)
      .where(lte(notifications.createdAt, new Date(now.getTime() - N.inboxRetentionMs)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  /**
   * Takes back notifications that quote content which is now gone (removed, taken down or erased), from the
   * inbox and from pushes still waiting for quiet hours to end.
   */
  async withdraw(
    kind: string,
    paramKey: string,
    values: string[],
    db: Database | Tx = this.db,
  ): Promise<void> {
    if (values.length === 0) return;
    const matches = (col: typeof notifications.params | typeof pendingPushes.params) =>
      inArray(sql<string>`${col}->>${paramKey}`, values);
    await db
      .delete(pendingPushes)
      .where(and(eq(pendingPushes.kind, kind), matches(pendingPushes.params)));
    await db
      .delete(notifications)
      .where(and(eq(notifications.kind, kind), matches(notifications.params)));
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [rows, quiet] = await Promise.all([
      this.db
        .select({
          kind: notifications.kind,
          path: notifications.path,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(asc(notifications.createdAt)),
      this.quietHours(userId),
    ]);
    return { notifications: rows, quietHours: quiet };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(pendingPushes).where(eq(pendingPushes.userId, userId));
    await tx.delete(notifications).where(eq(notifications.userId, userId));
    await tx.delete(notificationSettings).where(eq(notificationSettings.userId, userId));
  }
}

/** Stored params come back as JSON; they were written from `NotificationParams`, so this only narrows the type. */
function toParams(json: Record<string, unknown>): NotificationParams {
  const out: NotificationParams = {};
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.at === 'string')
        out[k] = typeof o.tz === 'string' ? { at: o.at, tz: o.tz } : { at: o.at };
      else if (typeof o.t === 'string') out[k] = { t: o.t };
      else if (typeof o.en === 'string' && typeof o.te === 'string' && typeof o.hi === 'string')
        out[k] = { en: o.en, te: o.te, hi: o.hi };
    }
  }
  return out;
}
