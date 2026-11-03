import type { EventVisibility, GeoPoint } from '@touchgrass/shared';
import { offsetPoint } from '@touchgrass/shared';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '../infra/database/database.module.js';
import {
  activityEvents,
  eventHosts,
  eventInterests,
  eventInvites,
  events,
  eventVibeTags,
  rsvps,
  venues,
} from '../infra/database/schema/index.js';
import { mysteryCenter } from '../modules/events/mystery.js';
import { HYDERABAD_NEIGHBOURHOODS } from './hyderabad.js';
import { seedPersona } from './taxonomy.js';

/** Dev-only key for seeded mystery offsets (production events use SIGNED_URL_SECRET). */
const SEED_MYSTERY_SECRET = 'touchgrass-dev-seed-mystery-offsets';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const VENUE_KINDS: {
  name: string;
  indoor: boolean;
  stepFree: boolean;
  restroom: boolean;
  quiet: boolean;
}[] = [
  { name: 'Third Wave Coffee', indoor: true, stepFree: true, restroom: true, quiet: false },
  { name: 'Board Game Cafe', indoor: true, stepFree: true, restroom: true, quiet: true },
  { name: 'Lake Promenade', indoor: false, stepFree: true, restroom: false, quiet: false },
  { name: 'Community Park', indoor: false, stepFree: true, restroom: true, quiet: true },
  { name: 'Pickleball Courts', indoor: false, stepFree: true, restroom: true, quiet: false },
  { name: 'Climbing Wall', indoor: true, stepFree: false, restroom: true, quiet: false },
  { name: 'Irani Chai Spot', indoor: false, stepFree: false, restroom: false, quiet: false },
  { name: 'Bookstore Lounge', indoor: true, stepFree: true, restroom: true, quiet: true },
  { name: 'Rooftop Studio', indoor: true, stepFree: false, restroom: true, quiet: true },
  { name: 'Football Turf', indoor: false, stepFree: true, restroom: true, quiet: false },
];

const PLAN_TITLES = [
  'Sunrise walk + chai',
  'Board games night',
  'Pickleball for beginners',
  'Sketching at the lake',
  'Book swap & coffee',
  'Turf football 5-a-side',
  'Open mic warm-up',
  'Biryani crawl',
  'Bouldering intro',
  'Sunset frisbee',
  'Telugu movie night',
  'Run club 5K',
  'Pottery jam',
  'Karaoke (no judgement)',
  'Photo walk',
  'Startup founders chai',
  'Yoga in the park',
  'Quiz night',
  'Cycling loop',
  'Language exchange: Hindi ↔ Telugu',
];

export interface EventSeedContext {
  cityId: string;
  hoodIds: string[];
  adminId: string;
  /** memberIds[k] is seed persona k + 1. */
  memberIds: string[];
  interestIds: string[];
  vibeIds: string[];
}

export interface EventSeedSummary {
  venues: number;
  events: number;
  rsvps: number;
}

function persona(
  ctx: EventSeedContext,
  k: number,
): { id: string; gender: 'woman' | 'man' | 'non_binary'; verified: boolean } {
  const n = k + 1;
  return { id: ctx.memberIds[k] as string, gender: seedPersona(n).gender, verified: n % 3 === 0 };
}

const bucketOf = (p: { gender: string; verified: boolean }): 'woman' | 'man' | 'other' =>
  p.verified && p.gender === 'woman' ? 'woman' : p.verified && p.gender === 'man' ? 'man' : 'other';

/**
 * 50 venues (10 per neighbourhood) and 100 events spanning every type, visibility and flag: past plans with
 * check-ins and no-shows, full plans with waitlists, mystery plans, balanced and women-only plans, curated
 * events by the admin, cancellations. Deterministic and idempotent (fixed slugs; inserts skip existing rows).
 */
export async function seedEvents(
  tx: Tx,
  ctx: EventSeedContext,
  now: Date = new Date(),
): Promise<EventSeedSummary> {
  const venueRows: {
    id: string;
    hood: number;
    point: GeoPoint;
    name: string;
    address: string;
    indoor: boolean;
    access: { stepFree: boolean; accessibleRestroom: boolean; quietSpace: boolean };
  }[] = [];
  for (const [h, hood] of HYDERABAD_NEIGHBOURHOODS.entries()) {
    for (const [k, kind] of VENUE_KINDS.entries()) {
      const point = offsetPoint(hood.centroid, 150 + k * 90, k * 36 + h * 7);
      const name = `${kind.name} ${hood.name}`;
      const placeId = `seed_${hood.slug}_${k}`;
      const [existing] = await tx
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.googlePlaceId, placeId))
        .limit(1);
      const id = existing?.id ?? uuidv7();
      const access = {
        stepFree: kind.stepFree,
        accessibleRestroom: kind.restroom,
        quietSpace: kind.quiet,
      };
      if (!existing) {
        await tx.insert(venues).values({
          id,
          cityId: ctx.cityId,
          neighbourhoodId: ctx.hoodIds[h] ?? null,
          name,
          address: `${10 + k} Main Road, ${hood.name}, Hyderabad`,
          location: point,
          googlePlaceId: placeId,
          indoor: kind.indoor,
          accessibility: access,
          isPartner: k % 4 === 0,
        });
      }
      venueRows.push({
        id,
        hood: h,
        point,
        name,
        address: `${10 + k} Main Road, ${hood.name}, Hyderabad`,
        indoor: kind.indoor,
        access,
      });
    }
  }

  // Verified hosts (persona n with n % 3 === 0); women-only plans need verified women.
  const verifiedIdx = ctx.memberIds.map((_, k) => k).filter((k) => persona(ctx, k).verified);
  const verifiedWomen = verifiedIdx.filter((k) => persona(ctx, k).gender === 'woman');

  for (let n = 0; n < 100; n += 1) {
    const slug = `seedev${String(n).padStart(3, '0')}`;
    const [exists] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.slug, slug))
      .limit(1);
    if (exists) continue;

    const visibility: EventVisibility =
      n % 12 === 3
        ? 'women_only'
        : n % 10 === 4
          ? 'balanced'
          : n % 10 === 7
            ? 'invite_only'
            : n % 7 === 5
              ? 'friends_of_friends'
              : 'public';
    const curated = n % 7 === 0;
    const hostK = curated
      ? null
      : visibility === 'women_only'
        ? (verifiedWomen[n % verifiedWomen.length] as number)
        : (verifiedIdx[(n * 5) % verifiedIdx.length] as number);
    const hostId = hostK === null ? ctx.adminId : persona(ctx, hostK).id;
    const venue = venueRows[(n * 3) % venueRows.length];
    if (!venue) continue;
    const past = n % 5 === 0;
    const cancelled = !past && n % 19 === 2;
    const dayOffset = past ? -1 - (n % 30) : 1 + (n % 28);
    const startsAt = new Date(now.getTime() + dayOffset * DAY + ((n % 6) + 7) * HOUR);
    const endsAt = new Date(startsAt.getTime() + (2 + (n % 3)) * HOUR);
    const smallGroup = n % 6 === 1;
    const capacity = smallGroup ? 4 + (n % 5) : curated ? 40 : 6 + (n % 15);
    const mystery = n % 10 === 9;
    const id = uuidv7();
    const centroid = HYDERABAD_NEIGHBOURHOODS[venue.hood]?.centroid ?? null;
    await tx.insert(events).values({
      id,
      slug,
      type: curated ? 'curated' : 'plan',
      status: past ? 'completed' : cancelled ? 'cancelled' : 'published',
      title: PLAN_TITLES[n % PLAN_TITLES.length] as string,
      description: curated
        ? 'Curated by Team TouchGrass. Come solo, leave with a squad.'
        : 'Low-key plan, come as you are.',
      categoryInterestId: ctx.interestIds[n % ctx.interestIds.length] ?? null,
      cityId: ctx.cityId,
      neighbourhoodId: ctx.hoodIds[venue.hood] ?? null,
      venueId: venue.id,
      location: venue.point,
      address: venue.address,
      placeName: venue.name,
      approxCenter: mystery
        ? mysteryCenter(id, venue.point, centroid, SEED_MYSTERY_SECRET)
        : venue.point,
      startsAt,
      endsAt,
      capacity,
      minGroupSize: smallGroup ? 4 : 2,
      pricePaise: 0,
      visibility,
      balancedMaxSharePct: visibility === 'balanced' ? 60 : null,
      soloFriendly: n % 3 === 0,
      smallGroup,
      mystery,
      mysteryRevealMinutesBefore: 120,
      allowPlusOnes: n % 4 === 0,
      indoor: venue.indoor,
      accessibility: venue.access,
      creatorUserId: hostId,
      cancelledReason: cancelled ? 'Rain forecast, rescheduling soon' : null,
      cancelledAt: cancelled ? now : null,
      completedAt: past ? endsAt : null,
      publishedAt: now,
    });
    const extraInterest = ctx.interestIds[(n + 3) % ctx.interestIds.length];
    if (extraInterest)
      await tx
        .insert(eventInterests)
        .values({ eventId: id, interestId: extraInterest })
        .onConflictDoNothing();
    const vibe = ctx.vibeIds[n % ctx.vibeIds.length];
    if (vibe)
      await tx.insert(eventVibeTags).values({ eventId: id, vibeTagId: vibe }).onConflictDoNothing();
    await tx.insert(eventHosts).values({ eventId: id, userId: hostId, role: 'host' });
    const hostBucket = hostK === null ? 'other' : bucketOf(persona(ctx, hostK));
    await tx.insert(rsvps).values({
      eventId: id,
      userId: hostId,
      status: past ? 'checked_in' : 'going',
      genderBucket: hostBucket,
      checkedInAt: past ? startsAt : null,
      checkInMethod: past ? 'qr' : null,
    });

    // Attendees: people near the host in the ring (their squad and friends of friends), then others.
    const start = hostK ?? n * 7;
    const wanted =
      n % 8 === 2 ? capacity + 2 : Math.max(1, Math.floor(capacity * (0.3 + (n % 5) * 0.12)));
    const buckets = {
      woman: hostBucket === 'woman' ? 1 : 0,
      man: hostBucket === 'man' ? 1 : 0,
      other: hostBucket === 'other' ? 1 : 0,
    };
    const cap = Math.floor((capacity * 60) / 100);
    let seats = 1;
    let waitlisted = 0;
    for (let j = 1; j <= wanted + 10 && seats + waitlisted < wanted + 1; j += 1) {
      const k = (start + j) % ctx.memberIds.length;
      if (k === hostK) continue;
      const p = persona(ctx, k);
      if (visibility === 'women_only' && !(p.verified && p.gender === 'woman')) continue;
      const bucket = bucketOf(p);
      const full = seats >= capacity || (visibility === 'balanced' && buckets[bucket] >= cap);
      if (full && (past || cancelled)) continue;
      if (visibility === 'invite_only' || visibility === 'friends_of_friends')
        await tx
          .insert(eventInvites)
          .values({ id: uuidv7(), eventId: id, inviteeUserId: p.id, invitedBy: hostId })
          .onConflictDoNothing();
      if (full) {
        await tx.insert(rsvps).values({
          eventId: id,
          userId: p.id,
          status: 'waitlisted',
          genderBucket: bucket,
          waitlistedAt: new Date(now.getTime() - (10 - waitlisted) * HOUR),
        });
        waitlisted += 1;
        continue;
      }
      const noShow = past && j % 5 === 0;
      await tx.insert(rsvps).values({
        eventId: id,
        userId: p.id,
        status: past && !noShow ? 'checked_in' : cancelled ? 'cancelled' : 'going',
        genderBucket: bucket,
        checkedInAt: past && !noShow ? new Date(startsAt.getTime() + (j % 20) * 60_000) : null,
        checkInMethod: past && !noShow ? (j % 2 === 0 ? 'qr' : 'geofence') : null,
        cancelledAt: cancelled ? now : null,
      });
      buckets[bucket] += 1;
      seats += 1;
    }
    if (!past && !cancelled && visibility === 'public') {
      await tx.insert(activityEvents).values({
        id: uuidv7(),
        actorId: hostId,
        verb: 'plotted',
        objectType: 'event',
        objectId: id,
        cityId: ctx.cityId,
        sourceEventId: uuidv7(),
      });
    }
  }

  const res = await tx.execute<{ venues: number; events: number; rsvps: number }>(sql`
    SELECT (SELECT count(*)::int FROM venues WHERE google_place_id LIKE 'seed\_%') AS venues,
           (SELECT count(*)::int FROM events WHERE slug LIKE 'seedev%') AS events,
           (SELECT count(*)::int FROM rsvps r JOIN events e ON e.id = r.event_id WHERE e.slug LIKE 'seedev%') AS rsvps`);
  const row = res.rows[0];
  return { venues: row?.venues ?? 0, events: row?.events ?? 0, rsvps: row?.rsvps ?? 0 };
}
