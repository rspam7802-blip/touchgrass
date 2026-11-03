import { feeBreakdown, type GeoPoint } from '@touchgrass/shared';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { pepperedHash, randomToken } from '../common/auth/hashing.js';
import type { Tx } from '../infra/database/database.module.js';
import {
  eventHosts,
  events,
  hostAccounts,
  hostApplications,
  payments,
  payouts,
  payoutTransfers,
  rsvps,
  users,
  venuePerks,
  venues,
} from '../infra/database/schema/index.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Venue staff PIN for every seeded partner venue (development only). */
export const SEED_STAFF_PIN = '2468';
const FEE_BPS = 1000;

export interface PaymentsSeedContext {
  cityId: string;
  memberIds: string[];
  interestIds: string[];
  /** TOKEN_HASH_PEPPER: needed to store staff PINs the API can check. Without it PINs are left unset. */
  tokenPepper?: string;
}

export interface PaymentsSeedSummary {
  hostApplications: number;
  paidEvents: number;
  payments: number;
  payouts: number;
  partnerVenues: number;
  perks: number;
}

const PERKS = [
  {
    title: '10% off for TouchGrass groups of 4+',
    description: 'On the whole bill, dine-in only.',
    minGroupSize: 4,
  },
  {
    title: 'Free chai for the table',
    description: 'One cutting chai each, any time on the day.',
    minGroupSize: 2,
  },
];

const PAID_TITLES = [
  'Pottery wheel night',
  'Sunrise trek to Ananthagiri',
  'Stand-up open mic',
  'Biryani trail walk',
  'Salsa beginners social',
  'Board game tournament',
];

/**
 * Phase 6 seed: approved and pending host applications, payout accounts, six paid plans (four upcoming with paid
 * attendees and receipts, two completed with payouts), and partner venues with perks. Idempotent by slug.
 */
export async function seedPayments(
  tx: Tx,
  ctx: PaymentsSeedContext,
  now: Date = new Date(),
): Promise<PaymentsSeedSummary> {
  const verified = (
    await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ctx.memberIds), isNotNull(users.verifiedAt)))
  ).map((u) => u.id);
  const ordered = ctx.memberIds.filter((id) => verified.includes(id));
  const hosts = ordered.slice(0, 4);
  const pendingApplicants = ordered.slice(4, 7);

  for (const [i, userId] of [...hosts, ...pendingApplicants].entries()) {
    const approved = i < hosts.length;
    const [existing] = await tx
      .select({ id: hostApplications.id })
      .from(hostApplications)
      .where(eq(hostApplications.userId, userId))
      .limit(1);
    if (existing) continue;
    await tx.insert(hostApplications).values({
      id: uuidv7(),
      userId,
      status: approved ? 'approved' : 'pending',
      about:
        'I organise small weekend meetups around Hyderabad and love bringing strangers together.',
      experience: 'Hosted monthly community plans for over a year, groups of 8 to 30.',
      eventIdeas:
        'Workshops and outdoor mornings with a small ticket to cover materials and venue.',
      links: ['https://instagram.com/touchgrass.hyd'],
      reviewedAt: approved ? new Date(now.getTime() - 20 * DAY) : null,
      reviewNote: approved ? 'Great track record.' : null,
    });
  }
  // Payout accounts: three active, one still in KYC.
  for (const [i, userId] of hosts.entries())
    await tx
      .insert(hostAccounts)
      .values({
        userId,
        providerAccountId: `acc_seed${String(i)}`,
        status: i < 3 ? 'activated' : 'created',
        legalBusinessName: `Seed Host ${String(i + 1)}`,
        contactName: `Seed Host ${String(i + 1)}`,
        email: `host${String(i + 1)}@example.com`,
        activatedAt: i < 3 ? new Date(now.getTime() - 10 * DAY) : null,
      })
      .onConflictDoNothing();

  // Partner venues: profile, staff PIN, perks.
  const partners = await tx
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(eq(venues.isPartner, true), sql`${venues.googlePlaceId} LIKE 'seed\\_%'`));
  for (const [i, v] of partners.entries()) {
    await tx
      .update(venues)
      .set({
        description: `${v.name} welcomes TouchGrass groups. Ask staff for the TouchGrass corner.`,
        ...(ctx.tokenPepper
          ? { staffPinHash: pepperedHash(ctx.tokenPepper, `venue-pin:${v.id}:${SEED_STAFF_PIN}`) }
          : {}),
      })
      .where(eq(venues.id, v.id));
    const perk = PERKS[i % PERKS.length];
    const [has] = await tx
      .select({ id: venuePerks.id })
      .from(venuePerks)
      .where(eq(venuePerks.venueId, v.id))
      .limit(1);
    if (!has && perk) await tx.insert(venuePerks).values({ id: uuidv7(), venueId: v.id, ...perk });
  }

  // Paid plans at partner venues.
  const venueRows =
    partners.length === 0
      ? []
      : await tx
          .select({
            id: venues.id,
            name: venues.name,
            address: venues.address,
            hoodId: venues.neighbourhoodId,
            lat: sql<number>`ST_Y(${venues.location}::geometry)`,
            lng: sql<number>`ST_X(${venues.location}::geometry)`,
          })
          .from(venues)
          .where(
            inArray(
              venues.id,
              partners.map((p) => p.id),
            ),
          );
  const attendeesPool = ctx.memberIds.filter((id) => !hosts.includes(id));
  for (let n = 0; n < PAID_TITLES.length && hosts.length > 0 && venueRows.length > 0; n += 1) {
    const slug = `seedpd${String(n).padStart(3, '0')}`;
    const [exists] = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.slug, slug))
      .limit(1);
    if (exists) continue;
    const hostId = hosts[n % hosts.length] as string;
    const venue = venueRows[n % venueRows.length];
    if (!venue) continue;
    const completed = n >= 4;
    const startsAt = completed
      ? new Date(now.getTime() - (3 + n) * DAY)
      : new Date(now.getTime() + (2 + n * 3) * DAY + 10 * HOUR);
    const endsAt = new Date(startsAt.getTime() + 3 * HOUR);
    const price = 29_900 + n * 10_000;
    const point: GeoPoint = { lat: venue.lat, lng: venue.lng };
    const eventId = uuidv7();
    await tx.insert(events).values({
      id: eventId,
      slug,
      type: 'plan',
      status: completed ? 'completed' : 'published',
      title: PAID_TITLES[n] as string,
      description: 'Ticket covers materials and a drink. Refunds per the policy below.',
      categoryInterestId: ctx.interestIds[n % ctx.interestIds.length] ?? null,
      cityId: ctx.cityId,
      neighbourhoodId: venue.hoodId,
      venueId: venue.id,
      location: point,
      address: venue.address,
      placeName: venue.name,
      approxCenter: point,
      startsAt,
      endsAt,
      capacity: 12,
      minGroupSize: 4,
      pricePaise: price,
      refundPolicy:
        n % 3 === 1
          ? { kind: 'partial', cutoffHours: 48, partialPct: 50 }
          : n % 3 === 2
            ? { kind: 'none', cutoffHours: 0, partialPct: null }
            : { kind: 'full', cutoffHours: 24, partialPct: null },
      visibility: 'public',
      indoor: true,
      accessibility: { stepFree: true, accessibleRestroom: n % 2 === 0, quietSpace: false },
      creatorUserId: hostId,
      completedAt: completed ? endsAt : null,
      publishedAt: new Date(now.getTime() - 30 * DAY),
    });
    await tx.insert(eventHosts).values({ eventId, userId: hostId, role: 'host' });
    await tx.insert(rsvps).values({
      eventId,
      userId: hostId,
      status: completed ? 'checked_in' : 'going',
      checkedInAt: completed ? startsAt : null,
      checkInMethod: completed ? 'qr' : null,
    });
    const buyers = Array.from(
      { length: 4 },
      (_, j) => attendeesPool[(n * 7 + j * 3) % attendeesPool.length] as string,
    );
    const paymentIds: { id: string; providerPaymentId: string; amount: number }[] = [];
    for (const [j, userId] of [...new Set(buyers)].entries()) {
      const capturedAt = new Date(Math.min(now.getTime(), startsAt.getTime()) - (5 + j) * DAY);
      const seq = await tx.execute<{ n: number }>(
        sql`SELECT nextval('receipt_number_seq')::int AS n`,
      );
      const id = uuidv7();
      const providerPaymentId = `pay_seed${slug}${String(j)}`;
      await tx.insert(payments).values({
        id,
        eventId,
        userId,
        status: 'captured',
        amountPaise: price,
        feeBps: FEE_BPS,
        providerOrderId: `order_seed${slug}${String(j)}`,
        providerPaymentId,
        method: j % 3 === 2 ? 'card' : 'upi',
        checkoutTokenHash: pepperedHash('seed', randomToken()),
        holdExpiresAt: new Date(capturedAt.getTime() + 10 * 60_000),
        capturedAt,
        receiptNumber: `TG-${String(capturedAt.getUTCFullYear())}-${String(seq.rows[0]?.n ?? 0).padStart(6, '0')}`,
        createdAt: capturedAt,
      });
      await tx
        .insert(rsvps)
        .values({
          eventId,
          userId,
          status: completed ? (j === 3 ? 'going' : 'checked_in') : 'going',
          checkedInAt: completed && j !== 3 ? new Date(startsAt.getTime() + j * 300_000) : null,
          checkInMethod: completed && j !== 3 ? 'qr' : null,
        })
        .onConflictDoNothing();
      paymentIds.push({ id, providerPaymentId, amount: price });
    }
    if (!completed) continue;
    // Completed plans have their payout: paid for an active host, on hold while KYC is pending.
    const active = hosts.indexOf(hostId) < 3;
    const shares = paymentIds.map((p) => ({ ...p, b: feeBreakdown(p.amount, FEE_BPS) }));
    const payoutId = uuidv7();
    await tx.insert(payouts).values({
      id: payoutId,
      eventId,
      hostUserId: hostId,
      status: active ? 'paid' : 'on_hold',
      holdReason: active ? null : 'KYC_REQUIRED',
      grossPaise: shares.reduce((s, p) => s + p.amount, 0),
      refundsPaise: 0,
      platformFeePaise: shares.reduce((s, p) => s + p.b.platformFeePaise, 0),
      gstPaise: shares.reduce((s, p) => s + p.b.gstPaise, 0),
      netPaise: shares.reduce((s, p) => s + p.b.hostNetPaise, 0),
      paidAt: active ? new Date(endsAt.getTime() + 26 * HOUR) : null,
    });
    await tx.insert(payoutTransfers).values(
      shares.map((p, j) => ({
        id: uuidv7(),
        payoutId,
        paymentId: p.id,
        amountPaise: p.b.hostNetPaise,
        status: active ? ('processed' as const) : ('pending' as const),
        providerTransferId: active ? `trf_seed${slug}${String(j)}` : null,
      })),
    );
  }

  const res = await tx.execute<Record<keyof PaymentsSeedSummary, number>>(sql`
    SELECT (SELECT count(*)::int FROM host_applications) AS "hostApplications",
           (SELECT count(*)::int FROM events WHERE slug LIKE 'seedpd%') AS "paidEvents",
           (SELECT count(*)::int FROM payments p JOIN events e ON e.id = p.event_id WHERE e.slug LIKE 'seedpd%') AS payments,
           (SELECT count(*)::int FROM payouts p JOIN events e ON e.id = p.event_id WHERE e.slug LIKE 'seedpd%') AS payouts,
           (SELECT count(*)::int FROM venues WHERE is_partner AND google_place_id LIKE 'seed\\_%') AS "partnerVenues",
           (SELECT count(*)::int FROM venue_perks k JOIN venues v ON v.id = k.venue_id WHERE v.google_place_id LIKE 'seed\\_%') AS perks`);
  const row = res.rows[0];
  return {
    hostApplications: row?.hostApplications ?? 0,
    paidEvents: row?.paidEvents ?? 0,
    payments: row?.payments ?? 0,
    payouts: row?.payouts ?? 0,
    partnerVenues: row?.partnerVenues ?? 0,
    perks: row?.perks ?? 0,
  };
}
