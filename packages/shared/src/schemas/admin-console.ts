import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../constants';
import { AdminRole, CityLaunchStatus, EventStatus, EventType } from '../enums';
import { GeoPoint } from './common';
import { LocalizedName } from './catalog';

/**
 * Who may open each admin section (F-WEB-03). super_admin implicitly holds every role. The API's `@Roles`
 * on each section's routes and the web dashboard's navigation both read this map, so they cannot drift.
 * City curators only ever see and change data in the cities they curate (enforced by the API, D-118).
 */
export const ADMIN_SECTIONS = {
  dashboard: ['admin', 'moderator', 'city_curator', 'support'],
  users: ['admin', 'moderator', 'support'],
  /** Customer 360 (D-192): support gets the lighter view, see `customerAccessFor`. */
  customers: ['admin', 'support'],
  verifications: ['admin', 'moderator'],
  moderation: ['admin', 'moderator', 'support'],
  events: ['admin', 'city_curator'],
  inviteCodes: ['admin'],
  /** Public launch waitlist (D-169): support handles removal requests; inviting needs `inviteCodes`. */
  waitlist: ['admin', 'support'],
  cities: ['admin', 'city_curator'],
  venues: ['admin', 'city_curator'],
  hostApplications: ['admin', 'city_curator'],
  icebreakers: ['admin', 'city_curator'],
  taxonomy: ['admin'],
  badges: ['admin', 'city_curator'],
  challenges: ['admin', 'city_curator'],
  featureFlags: ['super_admin'],
  payments: ['admin', 'support'],
  weights: ['admin'],
  notificationTemplates: ['admin'],
  analytics: ['admin', 'city_curator'],
  feedback: ['admin', 'city_curator', 'moderator'],
  settings: ['admin'],
  team: ['super_admin'],
  auditLog: ['admin'],
} as const satisfies Record<string, readonly AdminRole[]>;
export type AdminSection = keyof typeof ADMIN_SECTIONS;
export const ADMIN_SECTION_KEYS = Object.keys(ADMIN_SECTIONS) as AdminSection[];

/** Roles that may act in every city; anyone else holding only `city_curator` is limited to their cities. */
export const ALL_CITY_ROLES: readonly AdminRole[] = ['super_admin', 'admin'];

export function canAccessSection(roles: readonly string[], section: AdminSection): boolean {
  if (roles.includes('super_admin')) return true;
  return (ADMIN_SECTIONS[section] as readonly string[]).some((r) => roles.includes(r));
}

/** True for anyone holding at least one admin-dashboard role. */
export function isStaff(roles: readonly string[]): boolean {
  return roles.some((r) => (AdminRole.options as readonly string[]).includes(r));
}

// ---------- cities ----------

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const Bounds = z
  .object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  })
  .refine((b) => b.north > b.south && b.east > b.west, {
    message: 'North must be above south and east right of west',
    path: ['north'],
  });
export type Bounds = z.infer<typeof Bounds>;

const slug = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and dashes');

export const UpsertCityBody = z
  .object({
    slug,
    name: z.string().trim().min(2).max(60),
    centre: GeoPoint,
    bounds: Bounds,
    timezone: z.string().refine(isTimeZone, 'Unknown time zone'),
    launchStatus: CityLaunchStatus,
    languages: z
      .array(z.enum(SUPPORTED_LANGUAGES))
      .min(1)
      .max(SUPPORTED_LANGUAGES.length)
      .refine((l) => new Set(l).size === l.length, 'Duplicate language'),
  })
  .refine(
    (c) =>
      c.centre.lat >= c.bounds.south &&
      c.centre.lat <= c.bounds.north &&
      c.centre.lng >= c.bounds.west &&
      c.centre.lng <= c.bounds.east,
    { message: 'The centre must be inside the bounds', path: ['centre'] },
  );
export type UpsertCityBody = z.infer<typeof UpsertCityBody>;

export const UpsertNeighbourhoodBody = z.object({
  slug,
  name: z.string().trim().min(2).max(60),
  centroid: GeoPoint,
  /** The area is drawn as a circle of this radius around the centroid. */
  radiusKm: z.number().min(0.5).max(10),
});
export type UpsertNeighbourhoodBody = z.infer<typeof UpsertNeighbourhoodBody>;

export const WaitlistRequest = z.object({ name: z.string(), count: z.number().int() });

export const AdminCity = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  centre: GeoPoint,
  bounds: Bounds,
  timezone: z.string(),
  launchStatus: CityLaunchStatus,
  languages: z.array(z.string()),
  neighbourhoods: z.array(
    z.object({ id: z.uuid(), slug: z.string(), name: z.string(), centroid: GeoPoint }),
  ),
  waitlist: z.number().int(),
  curators: z.array(z.object({ userId: z.uuid(), displayName: z.string().nullable() })),
});
export type AdminCity = z.infer<typeof AdminCity>;
export const AdminCityList = z.object({
  items: z.array(AdminCity),
  /** Places people asked for that aren't cities yet, most requested first. */
  requested: z.array(WaitlistRequest),
});
export type AdminCityList = z.infer<typeof AdminCityList>;

/** Join the waitlist for a city that isn't open yet, or for a place that isn't a city on TouchGrass. */
export const JoinCityWaitlistBody = z.union([
  z.object({ cityId: z.uuid() }),
  z.object({ cityName: z.string().trim().min(2).max(60) }),
]);
export type JoinCityWaitlistBody = z.infer<typeof JoinCityWaitlistBody>;

export const CityWaitlistStatus = z.object({
  joined: z.boolean(),
  cityId: z.uuid().nullable(),
  cityName: z.string().nullable(),
  /** 1-based place in the queue for that city (or requested name). */
  position: z.number().int().nullable(),
  joinedAt: z.iso.datetime().nullable(),
});
export type CityWaitlistStatus = z.infer<typeof CityWaitlistStatus>;

// ---------- team (admin roles) ----------

export const TeamMember = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: AdminRole,
  cityId: z.uuid().nullable(),
  cityName: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type TeamMember = z.infer<typeof TeamMember>;
export const TeamList = z.object({ items: z.array(TeamMember) });
export type TeamList = z.infer<typeof TeamList>;

export const GrantRoleBody = z
  .object({ userId: z.uuid(), role: AdminRole, cityId: z.uuid().nullable().default(null) })
  .refine((b) => (b.role === 'city_curator') === (b.cityId !== null), {
    message: 'City curators need a city; other roles apply everywhere',
    path: ['cityId'],
  });
export type GrantRoleBody = z.infer<typeof GrantRoleBody>;

// ---------- events ----------

export const AdminEventQuery = z.object({
  cityId: z.uuid().optional(),
  status: EventStatus.optional(),
  type: EventType.optional(),
  featured: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type AdminEventQuery = z.infer<typeof AdminEventQuery>;

export const Featured = z.object({ until: z.iso.datetime(), rank: z.number().int() });
export const AdminEventRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  type: EventType,
  status: EventStatus,
  cityId: z.uuid(),
  cityName: z.string(),
  startsAt: z.iso.datetime(),
  hostName: z.string().nullable(),
  going: z.number().int(),
  capacity: z.number().int(),
  pricePaise: z.number().int(),
  held: z.boolean(),
  featured: Featured.nullable(),
});
export type AdminEventRow = z.infer<typeof AdminEventRow>;
export const AdminEventPage = z.object({
  items: z.array(AdminEventRow),
  nextCursor: z.string().nullable(),
});
export type AdminEventPage = z.infer<typeof AdminEventPage>;

export const AdminEventDetail = AdminEventRow.extend({
  description: z.string(),
  endsAt: z.iso.datetime(),
  visibility: z.string(),
  cancelledReason: z.string().nullable(),
});
export type AdminEventDetail = z.infer<typeof AdminEventDetail>;

export const FeatureEventBody = z.object({
  until: z.iso.datetime(),
  /** Lower ranks show first among featured plans in the city's feed. */
  rank: z.number().int().min(1).max(10).default(1),
});
export type FeatureEventBody = z.infer<typeof FeatureEventBody>;

export const AdminCancelEventBody = z.object({ reason: z.string().trim().min(3).max(300) });
export type AdminCancelEventBody = z.infer<typeof AdminCancelEventBody>;

// ---------- taxonomy ----------

export const AdminTaxonomyItem = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: LocalizedName,
  emoji: z.string(),
  category: z.string().nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  usage: z.number().int(),
});
export type AdminTaxonomyItem = z.infer<typeof AdminTaxonomyItem>;
export const AdminTaxonomy = z.object({
  interests: z.array(AdminTaxonomyItem),
  vibeTags: z.array(AdminTaxonomyItem),
});
export type AdminTaxonomy = z.infer<typeof AdminTaxonomy>;

const taxonomyName = z.object({
  en: z.string().trim().min(1).max(40),
  te: z.string().trim().min(1).max(40),
  hi: z.string().trim().min(1).max(40),
});
const emoji = z.string().trim().min(1).max(8);
export const UpsertInterestBody = z.object({
  slug,
  name: taxonomyName,
  emoji,
  category: z.string().trim().min(2).max(30),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});
export type UpsertInterestBody = z.infer<typeof UpsertInterestBody>;
export const UpsertVibeTagBody = z.object({
  slug,
  name: taxonomyName,
  emoji,
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});
export type UpsertVibeTagBody = z.infer<typeof UpsertVibeTagBody>;

// ---------- recommendation weights ----------

/**
 * Discovery ranking weights (F-DSC-07): each feature is normalised to about 0–1, so a weight reads as
 * "points for a perfect match". Admins tune them in the dashboard (D-121); these are the defaults.
 */
export const DEFAULT_RANKING_WEIGHTS = {
  interests: 3,
  vibes: 1.5,
  squadGoing: 4,
  friendsOfFriends: 2,
  distance: 2,
  soon: 1.5,
  popular: 1,
  soloFriendly: 1.5,
  weather: 1,
  fresh: 0.5,
  hostRating: 1.5,
} as const;
export type RankingWeightKey = keyof typeof DEFAULT_RANKING_WEIGHTS;
export const RANKING_WEIGHT_KEYS = Object.keys(DEFAULT_RANKING_WEIGHTS) as RankingWeightKey[];
export type RankingWeightValues = Record<RankingWeightKey, number>;

const weight = z.number().min(0).max(10).multipleOf(0.25);
export const RankingWeightsBody = z.object(
  Object.fromEntries(RANKING_WEIGHT_KEYS.map((k) => [k, weight])) as Record<
    RankingWeightKey,
    typeof weight
  >,
);
export type RankingWeightsBody = z.infer<typeof RankingWeightsBody>;
export const RankingWeights = z.object({
  weights: RankingWeightsBody,
  defaults: RankingWeightsBody,
  updatedAt: z.iso.datetime().nullable(),
});
export type RankingWeights = z.infer<typeof RankingWeights>;

// ---------- notification templates ----------

const Copy = z.object({ title: z.string(), body: z.string() });
export const AdminNotificationTemplate = z.object({
  kind: z.string(),
  category: z.string(),
  link: z.string(),
  inbox: z.boolean(),
  batch: z.boolean(),
  urgent: z.boolean(),
  placeholders: z.array(z.string()),
  defaults: z.object({ en: Copy, te: Copy, hi: Copy }),
  overrides: z.object({ en: Copy.nullable(), te: Copy.nullable(), hi: Copy.nullable() }),
});
export type AdminNotificationTemplate = z.infer<typeof AdminNotificationTemplate>;
export const AdminNotificationTemplateList = z.object({
  items: z.array(AdminNotificationTemplate),
});
export type AdminNotificationTemplateList = z.infer<typeof AdminNotificationTemplateList>;

export const TemplateOverrideBody = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(300),
});
export type TemplateOverrideBody = z.infer<typeof TemplateOverrideBody>;

/** `{{name}}` placeholders in a template string, in order of first use. */
export function placeholdersOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    const name = m[1];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// ---------- analytics overview ----------

export const ANALYTICS_METRICS = [
  'signed_up',
  'onboarded',
  'plan_created',
  'pulled_up',
  'checked_in',
  'payment_captured',
  'revenue_paise',
  'report_created',
  'city_waitlist_joined',
] as const;
export type AnalyticsMetric = (typeof ANALYTICS_METRICS)[number];

export const AnalyticsOverviewQuery = z.object({
  cityId: z.uuid().optional(),
  days: z.coerce
    .number()
    .int()
    .refine((d) => [7, 30, 90].includes(d), 'Use 7, 30 or 90')
    .default(7),
});
export type AnalyticsOverviewQuery = z.infer<typeof AnalyticsOverviewQuery>;

export const AnalyticsOverview = z.object({
  cityId: z.uuid().nullable(),
  days: z.number().int(),
  totals: z.object(
    Object.fromEntries(ANALYTICS_METRICS.map((m) => [m, z.number().int()])) as Record<
      AnalyticsMetric,
      z.ZodNumber
    >,
  ),
  activeUsers: z.number().int(),
  /** Check-ins per pull-up over the period, 0–1; null when nobody pulled up. */
  showUpRate: z.number().nullable(),
  daily: z.array(
    z.object({
      day: z.iso.date(),
      signedUp: z.number().int(),
      pulledUp: z.number().int(),
      checkedIn: z.number().int(),
      active: z.number().int(),
    }),
  ),
});
export type AnalyticsOverview = z.infer<typeof AnalyticsOverview>;
