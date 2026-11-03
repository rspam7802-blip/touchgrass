import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationCategory,
  type NotificationPreference,
  type RecordConsentBody,
  type RegisterDeviceBody,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { consents, devices, notificationPreferences } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';

/** Defaults: everything on except marketing pushes (opt-in). */
export function defaultPreference(category: NotificationCategory): NotificationPreference {
  return { category, push: category !== 'marketing', inApp: true };
}

/** Notification preferences, consent ledger and push devices (F-ACC-07, F-NOT-01). */
@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async notificationPreferences(userId: string): Promise<NotificationPreference[]> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    const stored = new Map(rows.map((r) => [r.category, r]));
    return NotificationCategory.options.map((category) => {
      const row = stored.get(category);
      return row ? { category, push: row.push, inApp: row.inApp } : defaultPreference(category);
    });
  }

  /** Each person's push / in-app choice for one category (defaults where they never chose). */
  async channelPrefs(
    userIds: string[],
    category: NotificationCategory,
  ): Promise<Map<string, { push: boolean; inApp: boolean }>> {
    const fallback = defaultPreference(category);
    const out = new Map(userIds.map((id) => [id, { push: fallback.push, inApp: fallback.inApp }]));
    if (userIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          inArray(notificationPreferences.userId, userIds),
          eq(notificationPreferences.category, category),
        ),
      );
    for (const r of rows) out.set(r.userId, { push: r.push, inApp: r.inApp });
    return out;
  }

  async updateNotificationPreferences(
    userId: string,
    items: NotificationPreference[],
  ): Promise<NotificationPreference[]> {
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        // Safety alerts (SOS, live location) can never be fully silenced.
        const push = item.category === 'safety' ? true : item.push;
        await tx
          .insert(notificationPreferences)
          .values({ userId, category: item.category, push, inApp: item.inApp })
          .onConflictDoUpdate({
            target: [notificationPreferences.userId, notificationPreferences.category],
            set: { push, inApp: item.inApp },
          });
      }
    });
    return this.notificationPreferences(userId);
  }

  async recordConsent(
    userId: string,
    body: RecordConsentBody,
    db: DbOrTx = this.db,
  ): Promise<void> {
    await db.insert(consents).values({
      id: uuidv7(),
      userId,
      kind: body.kind,
      granted: body.granted,
      version: body.version,
    });
  }

  async consents(
    userId: string,
  ): Promise<{ kind: string; granted: boolean; version: string; at: string }[]> {
    const rows = await this.db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(desc(consents.createdAt));
    return rows.map((r) => ({
      kind: r.kind,
      granted: r.granted,
      version: r.version,
      at: r.createdAt.toISOString(),
    }));
  }

  /** Push tokens move with the device: re-registering a token under another account reassigns it. */
  async registerDevice(userId: string, sessionId: string, body: RegisterDeviceBody): Promise<void> {
    await this.db
      .insert(devices)
      .values({
        id: uuidv7(),
        userId,
        sessionId,
        expoPushToken: body.expoPushToken,
        platform: body.platform,
      })
      .onConflictDoUpdate({
        target: devices.expoPushToken,
        set: { userId, sessionId, platform: body.platform, disabledAt: null },
      });
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    const rows = await this.db
      .update(devices)
      .set({ disabledAt: new Date() })
      .where(
        and(
          eq(devices.userId, userId),
          eq(devices.expoPushToken, token),
          isNull(devices.disabledAt),
        ),
      )
      .returning({ id: devices.id });
    if (rows.length === 0) throw AppError.notFound('Device');
  }

  async devices(
    userId: string,
  ): Promise<{ platform: string; registeredAt: string; active: boolean }[]> {
    const rows = await this.db.select().from(devices).where(eq(devices.userId, userId));
    return rows.map((d) => ({
      platform: d.platform,
      registeredAt: d.createdAt.toISOString(),
      active: d.disabledAt === null,
    }));
  }

  /** Active push tokens of the given people who allow push for `category` (default on, except marketing). */
  async pushTargets(
    userIds: string[],
    category: NotificationCategory,
  ): Promise<{ userId: string; token: string }[]> {
    if (userIds.length === 0) return [];
    const [tokens, prefs] = await Promise.all([
      this.db
        .select({ userId: devices.userId, token: devices.expoPushToken })
        .from(devices)
        .where(and(inArray(devices.userId, userIds), isNull(devices.disabledAt))),
      this.db
        .select({ userId: notificationPreferences.userId, push: notificationPreferences.push })
        .from(notificationPreferences)
        .where(
          and(
            inArray(notificationPreferences.userId, userIds),
            eq(notificationPreferences.category, category),
          ),
        ),
    ]);
    const optedOut = new Set(prefs.filter((p) => !p.push).map((p) => p.userId));
    const fallbackOff = !defaultPreference(category).push;
    const optedIn = new Set(prefs.filter((p) => p.push).map((p) => p.userId));
    return tokens.filter((t) => !optedOut.has(t.userId) && (!fallbackOff || optedIn.has(t.userId)));
  }

  /** Tokens Expo reports as no longer registered are switched off. */
  async disableTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return;
    await this.db
      .update(devices)
      .set({ disabledAt: new Date() })
      .where(inArray(devices.expoPushToken, tokens));
  }

  async eraseFor(userId: string, tx: DbOrTx): Promise<void> {
    await tx.delete(devices).where(eq(devices.userId, userId));
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  }

  async disableDevices(userId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(devices)
      .set({ disabledAt: new Date() })
      .where(and(eq(devices.userId, userId), isNull(devices.disabledAt)));
  }
}
