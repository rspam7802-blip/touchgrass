import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  buildIcs,
  type CalendarFeed,
  type EventSummary,
  fillParams,
  type IcsEvent,
  LIMITS,
  type SupportedLanguage,
  translate,
} from '@touchgrass/shared';
import { eq, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { calendarFeeds } from '../../infra/database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { UsersService } from '../users/users.service.js';

const DAY_MS = 86_400_000;
/** SEQUENCE counts seconds since this epoch, so every edit (updated_at) yields a larger number. */
const SEQUENCE_EPOCH = Date.UTC(2026, 0, 1);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Calendar sync (F-CAL-01): a private iCal feed per person and single-plan .ics files. Feed tokens are HMACs
 * of (user, version), so nothing secret is stored and resetting the link just bumps the version.
 */
@Injectable()
export class CalendarService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly events: EventsService,
    private readonly users: UsersService,
  ) {}

  private sign(userId: string, version: number): string {
    return createHmac('sha256', this.env.SIGNED_URL_SECRET)
      .update(`calendar:${userId}:${String(version)}`)
      .digest('base64url');
  }

  private token(userId: string, version: number): string {
    return `${userId}.${String(version)}.${this.sign(userId, version)}`;
  }

  private toFeed(userId: string, version: number): CalendarFeed {
    const url = `${this.env.API_PUBLIC_URL}/v1/calendar/${this.token(userId, version)}.ics`;
    return { url, webcalUrl: url.replace(/^https?:/, 'webcal:') };
  }

  async feed(userId: string): Promise<CalendarFeed> {
    const [row] = await this.db
      .insert(calendarFeeds)
      .values({ userId })
      .onConflictDoUpdate({ target: calendarFeeds.userId, set: { userId } })
      .returning({ version: calendarFeeds.version });
    return this.toFeed(userId, row?.version ?? 1);
  }

  /** A new link; the old one stops working at once. */
  async reset(userId: string): Promise<CalendarFeed> {
    const [row] = await this.db
      .insert(calendarFeeds)
      .values({ userId, version: 2 })
      .onConflictDoUpdate({
        target: calendarFeeds.userId,
        set: { version: sql`${calendarFeeds.version} + 1` },
      })
      .returning({ version: calendarFeeds.version });
    return this.toFeed(userId, row?.version ?? 2);
  }

  /** The user a feed token belongs to, if it is genuine and current. */
  async userForToken(token: string): Promise<string | null> {
    const [userId, versionRaw, sig] = token.split('.');
    if (!userId || !versionRaw || !sig || !UUID.test(userId) || !/^\d{1,9}$/.test(versionRaw))
      return null;
    const version = Number(versionRaw);
    const expected = Buffer.from(this.sign(userId, version));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    const [row] = await this.db
      .select({ version: calendarFeeds.version })
      .from(calendarFeeds)
      .where(eq(calendarFeeds.userId, userId));
    if (row?.version !== version) return null;
    const user = await this.users.findById(userId);
    return user?.status === 'active' ? userId : null;
  }

  private location(e: EventSummary, lang: SupportedLanguage): string | null {
    const loc = e.location;
    if (loc.kind === 'exact')
      return [loc.placeName, loc.address].filter((x): x is string => Boolean(x)).join(', ');
    return fillParams(
      translate('calendar.mysteryLocation', lang),
      { area: loc.neighbourhoodName ?? '' },
      lang,
    );
  }

  private toIcs(
    e: EventSummary,
    description: string,
    updatedAt: Date,
    lang: SupportedLanguage,
  ): IcsEvent {
    const link = `${this.env.WEB_PUBLIC_URL}/e/${e.slug}`;
    const open = fillParams(translate('calendar.openInApp', lang), { url: link }, lang);
    return {
      uid: `${e.id}@touchgrass.app`,
      sequence: Math.max(0, Math.floor((updatedAt.getTime() - SEQUENCE_EPOCH) / 1000)),
      start: new Date(e.startsAt),
      end: new Date(e.endsAt),
      updatedAt,
      title: e.title,
      description: [description, open].filter((x) => x.length > 0).join('\n\n'),
      location: this.location(e, lang),
      url: link,
      status: e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    };
  }

  private async language(userId: string): Promise<SupportedLanguage> {
    return (await this.users.languages([userId])).get(userId) ?? 'en';
  }

  /** The subscribed feed: hosted and seat-held plans from a month back to six months ahead. */
  async feedIcs(token: string, now: Date = new Date()): Promise<string> {
    const userId = await this.userForToken(token);
    if (!userId) throw AppError.notFound('Calendar');
    const lang = await this.language(userId);
    const C = LIMITS.calendar;
    const entries = await this.events.calendarFor(
      userId,
      new Date(now.getTime() - C.pastDays * DAY_MS),
      new Date(now.getTime() + C.futureDays * DAY_MS),
      now,
    );
    return buildIcs({
      name: translate('calendar.feedName', lang),
      refreshMinutes: 60,
      timezone: entries[0]?.summary.timezone,
      events: entries.map((x) => this.toIcs(x.summary, x.description, x.updatedAt, lang)),
    });
  }

  /** One plan as an .ics file, exactly as this viewer may see it. */
  async eventIcs(userId: string, eventId: string, now: Date = new Date()): Promise<string> {
    const [detail, lang] = await Promise.all([
      this.events.detailFor(userId, eventId),
      this.language(userId),
    ]);
    return buildIcs({
      name: detail.title,
      timezone: detail.timezone,
      events: [this.toIcs(detail, detail.description, now, lang)],
    });
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId));
  }
}
