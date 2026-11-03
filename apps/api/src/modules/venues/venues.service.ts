import { Inject, Injectable } from '@nestjs/common';
import type { GeoPoint, Venue } from '@touchgrass/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { MapsProvider, type PlaceSuggestion } from '../../adapters/maps/maps.port.js';
import { pepperedHash, safeEqualHex } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { savedVenues, venues } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { CitiesService } from '../cities/cities.service.js';

const DEFAULT_ACCESSIBILITY = { stepFree: false, accessibleRestroom: false, quietSpace: false };

export interface VenueRow {
  id: string;
  cityId: string;
  neighbourhoodId: string | null;
  name: string;
  address: string;
  location: GeoPoint;
  indoor: boolean;
  accessibility: Venue['accessibility'];
  isPartner: boolean;
}

/** Venues (F-EVT-02 location search, saved places; partners and perks arrive in Phase 6). */
@Injectable()
export class VenuesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly maps: MapsProvider,
    private readonly cities: CitiesService,
  ) {}

  private columns() {
    return {
      id: venues.id,
      cityId: venues.cityId,
      neighbourhoodId: venues.neighbourhoodId,
      name: venues.name,
      address: venues.address,
      lat: sql<number>`ST_Y(${venues.location}::geometry)`,
      lng: sql<number>`ST_X(${venues.location}::geometry)`,
      indoor: venues.indoor,
      accessibility: venues.accessibility,
      isPartner: venues.isPartner,
    };
  }

  private static toRow(r: { lat: number; lng: number } & Omit<VenueRow, 'location'>): VenueRow {
    const { lat, lng, ...rest } = r;
    return { ...rest, location: { lat, lng } };
  }

  async byId(id: string): Promise<VenueRow | null> {
    const [row] = await this.db
      .select(this.columns())
      .from(venues)
      .where(eq(venues.id, id))
      .limit(1);
    return row ? VenuesService.toRow(row) : null;
  }

  async toDto(rows: VenueRow[]): Promise<Venue[]> {
    const names = await this.cities.neighbourhoodNames(
      rows.flatMap((r) => (r.neighbourhoodId ? [r.neighbourhoodId] : [])),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      location: r.location,
      neighbourhoodName: r.neighbourhoodId ? (names.get(r.neighbourhoodId) ?? null) : null,
      indoor: r.indoor,
      accessibility: r.accessibility,
      isPartner: r.isPartner,
    }));
  }

  /** Known venues near the user whose name matches (trigram), nearest first. */
  async search(query: string, near: GeoPoint, limit = 10): Promise<VenueRow[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const rows = await this.db
      .select(this.columns())
      .from(venues)
      .where(
        sql`${venues.name} % ${q} OR ${venues.name} ILIKE ${`%${q.replace(/[%_\\]/g, '\\$&')}%`}`,
      )
      .orderBy(
        sql`${venues.location} <-> ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)::geography`,
      )
      .limit(limit);
    return rows.map((r) => VenuesService.toRow(r));
  }

  autocomplete(query: string, near: GeoPoint, sessionToken: string): Promise<PlaceSuggestion[]> {
    return this.maps.autocomplete(query, near, sessionToken);
  }

  /** Resolves a Places result into a venue (reused if we already know that place). Only launched-city places. */
  async fromPlace(placeId: string, sessionToken: string, userId: string): Promise<VenueRow> {
    const [existing] = await this.db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.googlePlaceId, placeId))
      .limit(1);
    if (existing) return (await this.byId(existing.id)) as VenueRow;
    const place = await this.maps.placeDetails(placeId, sessionToken);
    if (!place) throw AppError.notFound('Place');
    const where = await this.cities.locate(place.location);
    if (!where)
      throw new AppError('VALIDATION_FAILED', 'That place is outside the cities TouchGrass serves');
    const id = uuidv7();
    await this.db
      .insert(venues)
      .values({
        id,
        cityId: where.cityId,
        neighbourhoodId: where.neighbourhoodId,
        name: place.name,
        address: place.address,
        location: place.location,
        googlePlaceId: placeId,
        accessibility: DEFAULT_ACCESSIBILITY,
        createdByUserId: userId,
      })
      .onConflictDoNothing({ target: venues.googlePlaceId });
    const [row] = await this.db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.googlePlaceId, placeId))
      .limit(1);
    return (await this.byId(row?.id ?? id)) as VenueRow;
  }

  async saved(userId: string): Promise<VenueRow[]> {
    const ids = await this.db
      .select({ id: savedVenues.venueId })
      .from(savedVenues)
      .where(eq(savedVenues.userId, userId))
      .orderBy(desc(savedVenues.createdAt));
    if (ids.length === 0) return [];
    const rows = await this.db
      .select(this.columns())
      .from(venues)
      .where(
        inArray(
          venues.id,
          ids.map((r) => r.id),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, VenuesService.toRow(r)]));
    return ids.flatMap((r) => {
      const v = byId.get(r.id);
      return v ? [v] : [];
    });
  }

  async save(userId: string, venueId: string): Promise<void> {
    if (!(await this.byId(venueId))) throw AppError.notFound('Venue');
    await this.db.insert(savedVenues).values({ userId, venueId }).onConflictDoNothing();
  }

  async unsave(userId: string, venueId: string): Promise<void> {
    await this.db
      .delete(savedVenues)
      .where(and(eq(savedVenues.userId, userId), eq(savedVenues.venueId, venueId)));
  }

  // ---------- partnerships (F-PAY-04): profile and staff PIN; perks live in the perks module ----------

  private pinHash(venueId: string, pin: string): string {
    return pepperedHash(this.env.TOKEN_HASH_PEPPER, `venue-pin:${venueId}:${pin}`);
  }

  async partnerInfo(
    ids: string[],
  ): Promise<
    Map<string, { name: string; isPartner: boolean; description: string; hasStaffPin: boolean }>
  > {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: venues.id,
        name: venues.name,
        isPartner: venues.isPartner,
        description: venues.description,
        pin: venues.staffPinHash,
      })
      .from(venues)
      .where(inArray(venues.id, ids));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          name: r.name,
          isPartner: r.isPartner,
          description: r.description,
          hasStaffPin: r.pin !== null,
        },
      ]),
    );
  }

  async setPartner(
    venueId: string,
    body: { isPartner: boolean; description: string; staffPin?: string },
  ): Promise<void> {
    const res = await this.db
      .update(venues)
      .set({
        isPartner: body.isPartner,
        description: body.description,
        ...(body.staffPin ? { staffPinHash: this.pinHash(venueId, body.staffPin) } : {}),
      })
      .where(eq(venues.id, venueId))
      .returning({ id: venues.id });
    if (res.length === 0) throw AppError.notFound('Venue');
  }

  /** Constant-time check of a venue staff PIN (perk redemption). */
  async checkStaffPin(venueId: string, pin: string): Promise<boolean> {
    const [row] = await this.db
      .select({ pin: venues.staffPinHash })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    return row?.pin ? safeEqualHex(row.pin, this.pinHash(venueId, pin)) : false;
  }

  /** Admin list: name search (trigram), optionally partners only, ordered by name then id. */
  async adminList(q: {
    q?: string;
    partner: 'all' | 'partners';
    after: { name: string; id: string } | null;
    limit: number;
    /** City curators see only their cities' venues (D-118). */
    cityIds?: readonly string[];
  }): Promise<VenueRow[]> {
    if (q.cityIds?.length === 0) return [];
    const rows = await this.db
      .select(this.columns())
      .from(venues)
      .where(
        and(
          q.partner === 'partners' ? eq(venues.isPartner, true) : undefined,
          q.cityIds ? inArray(venues.cityId, [...q.cityIds]) : undefined,
          q.q ? sql`${venues.name} ILIKE ${`%${q.q.replace(/[%_\\]/g, '\\$&')}%`}` : undefined,
          q.after
            ? sql`(${venues.name}, ${venues.id}) > (${q.after.name}, ${q.after.id})`
            : undefined,
        ),
      )
      .orderBy(venues.name, venues.id)
      .limit(q.limit);
    return rows.map((r) => VenuesService.toRow(r));
  }

  async cityOf(venueId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ cityId: venues.cityId })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    return row?.cityId ?? null;
  }

  async exportFor(userId: string): Promise<{ venueId: string; name: string; savedAt: string }[]> {
    const rows = await this.db
      .select({ venueId: savedVenues.venueId, name: venues.name, savedAt: savedVenues.createdAt })
      .from(savedVenues)
      .innerJoin(venues, eq(venues.id, savedVenues.venueId))
      .where(eq(savedVenues.userId, userId));
    return rows.map((r) => ({ ...r, savedAt: r.savedAt.toISOString() }));
  }

  /** Saved places go; venues the user added stay (shared places other events point at) but lose authorship. */
  async eraseFor(userId: string, tx: DbOrTx): Promise<void> {
    await tx.delete(savedVenues).where(eq(savedVenues.userId, userId));
    await tx
      .update(venues)
      .set({ createdByUserId: null })
      .where(eq(venues.createdByUserId, userId));
  }
}
