import { z } from 'zod';
import { LIMITS } from '../constants';

export const Uuid = z.uuid();

export const PaginationQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.pagination.maxLimit)
    .default(LIMITS.pagination.defaultLimit),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const BoundingBox = z
  .object({ minLat: z.number(), minLng: z.number(), maxLat: z.number(), maxLng: z.number() })
  .refine((b) => b.minLat < b.maxLat && b.minLng < b.maxLng, {
    message: 'min must be less than max',
  });
export type BoundingBox = z.infer<typeof BoundingBox>;

export const E164Phone = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164');

export const IdempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  checks: z.record(z.string(), z.enum(['up', 'down'])),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const AppConfigResponse = z.object({
  minSupportedVersion: z.string(),
  latestVersion: z.string(),
  flags: z.record(z.string(), z.boolean()),
});
export type AppConfigResponse = z.infer<typeof AppConfigResponse>;
