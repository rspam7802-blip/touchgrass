import { describe, expect, it } from 'vitest';
import {
  BoundingBox,
  E164Phone,
  GeoPoint,
  IdempotencyKey,
  PaginationQuery,
  paginated,
} from './common';
import { z } from 'zod';

describe('common schemas', () => {
  it('applies pagination defaults and bounds', () => {
    expect(PaginationQuery.parse({})).toEqual({ limit: 20 });
    expect(PaginationQuery.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
    expect(PaginationQuery.safeParse({ limit: 1000 }).success).toBe(false);
  });
  it('validates geo and bounding boxes', () => {
    expect(GeoPoint.safeParse({ lat: 17.44, lng: 78.38 }).success).toBe(true);
    expect(GeoPoint.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(BoundingBox.safeParse({ minLat: 17, minLng: 78, maxLat: 18, maxLng: 79 }).success).toBe(
      true,
    );
    expect(BoundingBox.safeParse({ minLat: 18, minLng: 78, maxLat: 17, maxLng: 79 }).success).toBe(
      false,
    );
  });
  it('validates phone and idempotency keys', () => {
    expect(E164Phone.safeParse('+919848022338').success).toBe(true);
    expect(E164Phone.safeParse('9848022338').success).toBe(false);
    expect(IdempotencyKey.safeParse('rsvp_0192f3a4').success).toBe(true);
    expect(IdempotencyKey.safeParse('short').success).toBe(false);
  });
  it('builds paginated response schemas', () => {
    const schema = paginated(z.object({ id: z.string() }));
    expect(schema.parse({ items: [{ id: 'a' }], nextCursor: null })).toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
    });
  });
});
