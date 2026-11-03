import { type GeoPoint, haversineMeters, LIMITS, offsetPoint } from '@touchgrass/shared';
import { createHmac } from 'node:crypto';

/** Radius of the "somewhere around here" circle shown before reveal; always contains the true spot. */
export const MYSTERY_AREA_RADIUS_M = LIMITS.mystery.areaRadiusMeters;
const MIN = LIMITS.mystery.minFuzzMeters;
const MAX = LIMITS.mystery.maxFuzzMeters;

function unitFloats(secret: string, eventId: string, attempt: number): [number, number] {
  const digest = createHmac('sha256', secret).update(`mystery:${eventId}:${attempt}`).digest();
  return [digest.readUInt32BE(0) / 0xffffffff, digest.readUInt32BE(4) / 0xffffffff];
}

/**
 * Public centre for a mystery event (F-EVT-12): anchored on the neighbourhood centroid when it is close enough,
 * then pushed a secret-keyed, deterministic 1–1.5 km. Guarantees: at least 1 km from the true spot (so the
 * circle never pinpoints it) and close enough that the 2 km area still contains it. Deterministic per event,
 * so repeated requests cannot be averaged to triangulate the spot.
 */
export function mysteryCenter(
  eventId: string,
  exact: GeoPoint,
  neighbourhoodCentroid: GeoPoint | null,
  secret: string,
): GeoPoint {
  const maxFromExact = MYSTERY_AREA_RADIUS_M - 300;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const [a, b] = unitFloats(secret, eventId, attempt);
    const base = neighbourhoodCentroid && attempt < 16 ? neighbourhoodCentroid : exact;
    const candidate = offsetPoint(base, MIN + a * (MAX - MIN), b * 360);
    const d = haversineMeters(candidate, exact);
    if (d >= MIN && d <= maxFromExact) return candidate;
  }
  // Offsetting from the exact spot by [MIN, MAX] always satisfies both bounds; reached only if both bases failed.
  const [a, b] = unitFloats(secret, eventId, 99);
  return offsetPoint(exact, MIN + a * (MAX - MIN), b * 360);
}
