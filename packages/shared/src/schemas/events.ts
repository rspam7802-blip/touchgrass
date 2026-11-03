import { z } from 'zod';
import { EventPerk, PaymentStatus, RefundPolicy } from './payments';
import { LIMITS, LOCALE_DEFAULTS } from '../constants';
import {
  EventStatus,
  EventType,
  EventVisibility,
  HostRole,
  ReliabilityTier,
  RsvpStatus,
} from '../enums';
import { GeoPoint } from './common';
import { Interest, VibeTag } from './catalog';
import { MediaVariants } from './media';
import { PersonCard } from './social';

const E = LIMITS.event;

/** Step-free access, accessible restroom, quiet space (F-A11Y-02). */
export const AccessibilityInfo = z.object({
  stepFree: z.boolean().default(false),
  accessibleRestroom: z.boolean().default(false),
  quietSpace: z.boolean().default(false),
});
export type AccessibilityInfo = z.infer<typeof AccessibilityInfo>;

export const Venue = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string(),
  location: GeoPoint,
  neighbourhoodName: z.string().nullable(),
  indoor: z.boolean(),
  accessibility: AccessibilityInfo,
  isPartner: z.boolean(),
});
export type Venue = z.infer<typeof Venue>;
export const VenueList = z.object({ items: z.array(Venue) });
export type VenueList = z.infer<typeof VenueList>;

export const PlaceSuggestionDto = z.object({
  placeId: z.string(),
  primaryText: z.string(),
  secondaryText: z.string(),
});
export const PlaceSuggestionList = z.object({ items: z.array(PlaceSuggestionDto) });
export const VenueSearchQuery = z.object({
  q: z.string().trim().min(2).max(100),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  session: z.string().min(1).max(100),
});
export type VenueSearchQuery = z.infer<typeof VenueSearchQuery>;
export const VenueSearchResponse = z.object({
  venues: z.array(Venue),
  places: z.array(PlaceSuggestionDto),
});
export type VenueSearchResponse = z.infer<typeof VenueSearchResponse>;
export const VenueFromPlaceBody = z.object({
  placeId: z.string().min(1).max(300),
  sessionToken: z.string().min(1).max(100),
});
export type VenueFromPlaceBody = z.infer<typeof VenueFromPlaceBody>;

/** Where an event happens: a known venue, or a custom pin with an address. */
export const EventWhere = z.union([
  z.object({ venueId: z.uuid() }),
  z.object({
    point: GeoPoint,
    address: z.string().trim().min(3).max(300),
    placeName: z.string().trim().max(120).nullable().default(null),
  }),
]);
export type EventWhere = z.infer<typeof EventWhere>;

const EventFields = z.object({
  type: EventType.exclude(['crew_session']).default('plan'),
  title: z.string().trim().min(E.titleMinLength).max(E.titleMaxLength),
  description: z.string().trim().max(E.descriptionMaxLength).default(''),
  coverMediaId: z.uuid().nullable().default(null),
  categoryInterestId: z.uuid(),
  interestIds: z.array(z.uuid()).max(5).default([]),
  vibeTagIds: z.array(z.uuid()).max(5).default([]),
  where: EventWhere,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  capacity: z.number().int().min(E.minCapacity).max(E.maxCapacity),
  minGroupSize: z.number().int().min(2).max(E.maxCapacity).default(2),
  pricePaise: z.number().int().min(0).max(10_000_000).default(0),
  visibility: EventVisibility.default('public'),
  /** Balanced events: no single gender bucket may exceed this share of capacity. */
  balancedMaxSharePct: z
    .number()
    .int()
    .min(E.balancedMinSharePct)
    .max(E.balancedMaxSharePct)
    .nullable()
    .default(null),
  soloFriendly: z.boolean().default(false),
  smallGroup: z.boolean().default(false),
  mystery: z.boolean().default(false),
  mysteryRevealMinutesBefore: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .default(120),
  allowPlusOnes: z.boolean().default(false),
  /** Paid plans only; defaults to full refunds until 24 h before (F-PAY-02). */
  refundPolicy: RefundPolicy.nullable().default(null),
  indoor: z.boolean().default(false),
  accessibility: AccessibilityInfo.default({
    stepFree: false,
    accessibleRestroom: false,
    quietSpace: false,
  }),
  publish: z.boolean().default(true),
});

function eventRules<T extends z.ZodType<Partial<z.infer<typeof EventFields>>>>(schema: T): T {
  return schema.superRefine((v, ctx) => {
    if (v.startsAt && v.endsAt) {
      const start = new Date(v.startsAt).getTime();
      const end = new Date(v.endsAt).getTime();
      if (end <= start)
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must end after it starts' });
      if (end - start > E.maxDurationHours * 3_600_000)
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Too long' });
    }
    if (
      v.smallGroup &&
      v.capacity !== undefined &&
      (v.capacity < E.smallGroupMin || v.capacity > E.smallGroupMax)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: `Small-group events hold ${E.smallGroupMin}–${E.smallGroupMax} people`,
      });
    }
    if (v.visibility === 'balanced' && v.balancedMaxSharePct === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['balancedMaxSharePct'],
        message: 'Balanced events need a ratio cap',
      });
    }
    if (v.minGroupSize !== undefined && v.capacity !== undefined && v.minGroupSize > v.capacity) {
      ctx.addIssue({ code: 'custom', path: ['minGroupSize'], message: 'Cannot exceed capacity' });
    }
  });
}

export const CreateEventBody = eventRules(EventFields);
export type CreateEventBody = z.infer<typeof CreateEventBody>;

type Undefaulted<T extends z.ZodRawShape> = {
  [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K];
};
function withoutDefaults<T extends z.ZodRawShape>(shape: T): Undefaulted<T> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ]),
  ) as Undefaulted<T>;
}
/** Same fields without their create-time defaults, so an edit never resets what it did not mention. */
const EditableFields = z.object(
  withoutDefaults(EventFields.omit({ type: true, publish: true }).shape),
);

export const UpdateEventBody = eventRules(
  EditableFields.partial().refine((v) => Object.keys(v).length > 0, {
    message: 'Provide at least one field',
  }),
);
export type UpdateEventBody = z.infer<typeof UpdateEventBody>;

export const CancelEventBody = z.object({ reason: z.string().trim().max(500).default('') });
export type CancelEventBody = z.infer<typeof CancelEventBody>;

/** Location as the viewer is allowed to see it. Mystery events show only an approximate area until revealed. */
export const EventLocationView = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exact'),
    point: GeoPoint,
    address: z.string(),
    placeName: z.string().nullable(),
    neighbourhoodName: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('approximate'),
    center: GeoPoint,
    radiusMeters: z.number().int(),
    neighbourhoodName: z.string().nullable(),
    revealsAt: z.iso.datetime(),
  }),
]);
export type EventLocationView = z.infer<typeof EventLocationView>;

export const EventHost = z.object({ person: PersonCard, role: HostRole });
export type EventHost = z.infer<typeof EventHost>;

export const ViewerState = z.object({
  rsvp: RsvpStatus.nullable(),
  isHost: z.boolean(),
  hostRole: HostRole.nullable(),
  invitedBy: PersonCard.nullable(),
  /** Open waitlist offer the viewer can claim. */
  offer: z
    .object({ expiresAt: z.iso.datetime(), mode: z.enum(['sequential', 'broadcast']) })
    .nullable(),
  plusOne: z
    .object({
      kind: z.enum(['member', 'guest']),
      person: PersonCard.nullable(),
      claimed: z.boolean(),
    })
    .nullable(),
  /** 1-based place in line while waitlisted. */
  waitlistPosition: z.number().int().nullable(),
  canRsvp: z.boolean(),
  /** Why the viewer cannot pull up (stable code), if they cannot. */
  blockedReason: z.string().nullable(),
  canCheckIn: z.boolean(),
  /** Set while repeat no-shows keep the viewer out of popular plans (F-SAF-02). */
  cooldownUntil: z.iso.datetime().nullable(),
  /** The viewer's checkout for a paid plan while it is open or after paying (F-PAY-01). */
  payment: z
    .object({
      id: z.uuid(),
      status: PaymentStatus,
      holdExpiresAt: z.iso.datetime(),
      amountPaise: z.number().int(),
    })
    .nullable(),
});
export type ViewerState = z.infer<typeof ViewerState>;

export const EventSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  type: EventType,
  status: EventStatus,
  title: z.string(),
  cover: MediaVariants.nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** The plan's city time zone (IANA); times are shown in it (F-GRW-03). */
  timezone: z.string().default(LOCALE_DEFAULTS.timezone),
  location: EventLocationView,
  visibility: EventVisibility,
  capacity: z.number().int(),
  goingCount: z.number().int(),
  spotsLeft: z.number().int(),
  waitlistCount: z.number().int(),
  pricePaise: z.number().int(),
  soloFriendly: z.boolean(),
  smallGroup: z.boolean(),
  mystery: z.boolean(),
  indoor: z.boolean(),
  accessibility: AccessibilityInfo,
  category: Interest.nullable(),
  viewer: ViewerState,
});
export type EventSummary = z.infer<typeof EventSummary>;

export const EventDetail = EventSummary.extend({
  description: z.string(),
  hosts: z.array(EventHost),
  interests: z.array(Interest),
  vibeTags: z.array(VibeTag),
  minGroupSize: z.number().int(),
  allowPlusOnes: z.boolean(),
  balancedMaxSharePct: z.number().int().nullable(),
  /** Percentage (0–100) of going attendees coming without squad or +1 (F-EVT-10). */
  soloPercent: z.number().int(),
  cancelledReason: z.string().nullable(),
  shareUrl: z.url(),
  refundPolicy: RefundPolicy.nullable(),
  /** Perks at partner venues (F-PAY-04). */
  perks: z.array(EventPerk),
  /** Lore album (F-AFT-04) when the viewer may see it. */
  lore: z.object({ count: z.number().int(), canAdd: z.boolean() }).nullable(),
  /** Set for crew sessions (F-ENG-02). */
  crew: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** Held for review by the text filter: only its hosts can see it until then (F-SAF-06). */
  held: z.boolean(),
});
export type EventDetail = z.infer<typeof EventDetail>;

export const EventList = z.object({
  items: z.array(EventSummary),
  nextCursor: z.string().nullable(),
});
export type EventList = z.infer<typeof EventList>;

export const PlusOneInput = z.union([
  z.object({ userId: z.uuid() }),
  z.object({ guest: z.literal(true) }),
]);
export const RsvpBody = z.object({
  status: z.enum(['going', 'interested']),
  plusOne: PlusOneInput.nullable().default(null),
});
export type RsvpBody = z.infer<typeof RsvpBody>;
export const RsvpResult = z.object({
  status: RsvpStatus,
  /** Guest +1 claim link (share with the non-member friend). */
  plusOneClaimUrl: z.url().nullable(),
  event: EventDetail,
});
export type RsvpResult = z.infer<typeof RsvpResult>;

export const Attendee = z.object({
  person: PersonCard,
  status: RsvpStatus,
  firstTime: z.boolean(),
  plusOneOf: z.uuid().nullable(),
  isHost: z.boolean(),
  /** Hosts see attendees' reliability tiers (F-SAF-02); null for everyone else. */
  reliabilityTier: ReliabilityTier.nullable(),
});
export type Attendee = z.infer<typeof Attendee>;
export const AttendeeList = z.object({ items: z.array(Attendee), hiddenCount: z.number().int() });
export type AttendeeList = z.infer<typeof AttendeeList>;

export const InviteUsersBody = z.object({
  userIds: z.array(z.uuid()).min(1).max(LIMITS.event.maxInviteBatch),
});
export type InviteUsersBody = z.infer<typeof InviteUsersBody>;
export const InviteLink = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
export const InviteeStatus = z.object({
  person: PersonCard,
  invited: z.boolean(),
  rsvp: RsvpStatus.nullable(),
});
export const InviteeList = z.object({ items: z.array(InviteeStatus) });
export type InviteeList = z.infer<typeof InviteeList>;

export const AddHostBody = z.object({ userId: z.uuid(), role: HostRole.exclude(['host']) });
export type AddHostBody = z.infer<typeof AddHostBody>;

export const Ticket = z.object({
  qr: z.string(),
  eventId: z.uuid(),
  validFrom: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export type Ticket = z.infer<typeof Ticket>;
export const CheckInBody = z.union([
  z.object({ qr: z.string().min(10).max(500) }),
  z.object({ point: GeoPoint }),
]);
export type CheckInBody = z.infer<typeof CheckInBody>;
export const CheckInResult = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  checkedInAt: z.iso.datetime(),
  method: z.enum(['qr', 'geofence']),
});
export type CheckInResult = z.infer<typeof CheckInResult>;

/** Minimal public projection for share pages and link previews (F-EVT-17, F-WEB-01). */
export const PublicEventView = z.discriminatedUnion('access', [
  z.object({
    access: z.literal('full'),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    cover: MediaVariants.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timezone: z.string().default(LOCALE_DEFAULTS.timezone),
    type: EventType.default('plan'),
    cityName: z.string().nullable().default(null),
    areaName: z.string().nullable(),
    hostName: z.string(),
    goingCount: z.number().int(),
    spotsLeft: z.number().int(),
    pricePaise: z.number().int(),
    mystery: z.boolean(),
    status: EventStatus,
  }),
  z.object({
    access: z.literal('teaser'),
    slug: z.string(),
    hostName: z.string(),
    startsAt: z.iso.datetime(),
    timezone: z.string().default(LOCALE_DEFAULTS.timezone),
    status: EventStatus,
  }),
]);
export type PublicEventView = z.infer<typeof PublicEventView>;

export const MyEventsQuery = z.object({
  scope: z.enum(['upcoming', 'hosting', 'past']).default('upcoming'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type MyEventsQuery = z.infer<typeof MyEventsQuery>;

/** Guest +1 claim (F-EVT-07): a non-member friend joins with the link their friend shared. */
export const ClaimPlusOneBody = z.object({ token: z.string().min(20).max(200) });
export type ClaimPlusOneBody = z.infer<typeof ClaimPlusOneBody>;
export const PlusOnePreview = z.object({
  inviterName: z.string(),
  event: PublicEventView,
});
export type PlusOnePreview = z.infer<typeof PlusOnePreview>;
export const ClaimPlusOneResult = z.object({ eventId: z.uuid(), slug: z.string() });
export type ClaimPlusOneResult = z.infer<typeof ClaimPlusOneResult>;
export const InviteUsersResult = z.object({ invited: z.number().int() });
export type InviteUsersResult = z.infer<typeof InviteUsersResult>;
export const BySlugQuery = z.object({ i: z.string().min(10).max(100).optional() });
export type BySlugQuery = z.infer<typeof BySlugQuery>;
