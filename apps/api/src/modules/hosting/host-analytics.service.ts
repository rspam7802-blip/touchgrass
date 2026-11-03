import { Injectable } from '@nestjs/common';
import type { EventAnalytics, HostAnalytics } from '@touchgrass/shared';
import { AppError } from '../../common/errors/app-error.js';
import { EventAccessService } from '../events/event-access.service.js';
import { EventViewsService } from '../events/event-views.service.js';
import { type HostedEvent, HostEventStats } from '../events/stats/host-event-stats.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { FeedbackReader } from './feedback-reader.js';

const MAX_EVENTS = 100;

/** Conversion: RSVPs per 100 views, one decimal; 0 with no views. */
export function conversionPct(rsvps: number, views: number): number {
  return views === 0 ? 0 : Math.round((rsvps / views) * 1000) / 10;
}

/** Totals across plans: sums, conversion over the summed views, rating weighted by number of ratings. */
export function summarise(events: EventAnalytics[]): HostAnalytics['totals'] {
  const sum = (f: (e: EventAnalytics) => number): number => events.reduce((n, e) => n + f(e), 0);
  const views = sum((e) => e.views);
  const rsvps = sum((e) => e.rsvps);
  const ratingsCount = sum((e) => e.ratingsCount);
  const ratingTotal = sum((e) => (e.averageRating ?? 0) * e.ratingsCount);
  const themes = new Map<string, number>();
  for (const e of events)
    for (const t of e.themes) themes.set(t.theme, (themes.get(t.theme) ?? 0) + t.count);
  return {
    events: events.length,
    views,
    rsvps,
    conversionPct: conversionPct(rsvps, views),
    checkIns: sum((e) => e.checkIns),
    noShows: sum((e) => e.noShows),
    repeatAttendees: sum((e) => e.repeatAttendees),
    averageRating: ratingsCount > 0 ? Math.round((ratingTotal / ratingsCount) * 10) / 10 : null,
    ratingsCount,
    themes: [...themes.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme))
      .slice(0, 10),
    revenuePaise: sum((e) => e.revenuePaise),
  };
}

/** Host analytics (F-HST-02): per plan and overall, only for plans the caller hosts or co-hosts. */
@Injectable()
export class HostAnalyticsService {
  constructor(
    private readonly stats: HostEventStats,
    private readonly views: EventViewsService,
    private readonly payments: PaymentsService,
    private readonly feedback: FeedbackReader,
    private readonly access: EventAccessService,
  ) {}

  async overall(hostId: string): Promise<HostAnalytics> {
    const events = await this.forEvents(hostId, await this.stats.hostedEvents(hostId, MAX_EVENTS));
    return { totals: summarise(events), events };
  }

  async event(hostId: string, eventId: string): Promise<EventAnalytics> {
    const core = await this.access.requireHost(hostId, eventId, { roles: ['host', 'co_host'] });
    const [one] = await this.forEvents(hostId, [
      { id: core.id, title: core.title, startsAt: core.startsAt, status: core.status },
    ]);
    if (!one) throw AppError.notFound('Event');
    return one;
  }

  private async forEvents(hostId: string, events: HostedEvent[]): Promise<EventAnalytics[]> {
    const ids = events.map((e) => e.id);
    const [attendance, views, revenue, feedback] = await Promise.all([
      this.stats.attendance(ids, hostId),
      this.views.counts(ids),
      this.payments.revenueByEvent(ids),
      this.feedback.summaries(ids),
    ]);
    return events.map((e) => {
      const a = attendance.get(e.id) ?? { rsvps: 0, checkIns: 0, noShows: 0, repeatAttendees: 0 };
      const v = views.get(e.id) ?? 0;
      const f = feedback.get(e.id) ?? { averageRating: null, ratingsCount: 0, themes: [] };
      return {
        eventId: e.id,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        status: e.status,
        views: v,
        rsvps: a.rsvps,
        conversionPct: conversionPct(a.rsvps, v),
        checkIns: a.checkIns,
        noShows: a.noShows,
        repeatAttendees: a.repeatAttendees,
        averageRating: f.averageRating,
        ratingsCount: f.ratingsCount,
        themes: f.themes,
        revenuePaise: revenue.get(e.id) ?? 0,
      };
    });
  }
}
