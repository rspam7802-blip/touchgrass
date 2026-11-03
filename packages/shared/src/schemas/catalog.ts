import { z } from 'zod';
import { CityLaunchStatus } from '../enums';
import { GeoPoint } from './common';

/** Names for admin-managed taxonomy, one per supported language. */
export const LocalizedName = z.object({
  en: z.string().min(1),
  te: z.string().min(1),
  hi: z.string().min(1),
});
export type LocalizedName = z.infer<typeof LocalizedName>;

export const City = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  centre: GeoPoint,
  timezone: z.string(),
  launchStatus: CityLaunchStatus,
  languages: z.array(z.string()),
});
export type City = z.infer<typeof City>;

export const Neighbourhood = z.object({
  id: z.uuid(),
  cityId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  centroid: GeoPoint,
});
export type Neighbourhood = z.infer<typeof Neighbourhood>;

export const Interest = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: LocalizedName,
  emoji: z.string(),
  category: z.string(),
});
export type Interest = z.infer<typeof Interest>;

export const VibeTag = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: LocalizedName,
  emoji: z.string(),
});
export type VibeTag = z.infer<typeof VibeTag>;

export const CityList = z.object({ items: z.array(City) });
export const NeighbourhoodList = z.object({ items: z.array(Neighbourhood) });
export const InterestList = z.object({ items: z.array(Interest) });
export const VibeTagList = z.object({ items: z.array(VibeTag) });
