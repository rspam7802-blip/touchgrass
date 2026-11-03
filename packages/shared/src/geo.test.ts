import { describe, expect, it } from 'vitest';
import { haversineMeters, offsetPoint } from './geo';

const madhapur = { lat: 17.4483, lng: 78.3915 };
const gachibowli = { lat: 17.4401, lng: 78.3489 };

describe('geo', () => {
  it('computes distances between Hyderabad neighbourhoods', () => {
    const d = haversineMeters(madhapur, gachibowli);
    expect(d).toBeGreaterThan(4300);
    expect(d).toBeLessThan(4800);
    expect(haversineMeters(madhapur, madhapur)).toBe(0);
  });
  it('offsets points by distance and bearing', () => {
    for (const bearing of [0, 90, 180, 270, 45]) {
      const moved = offsetPoint(madhapur, 1500, bearing);
      expect(haversineMeters(madhapur, moved)).toBeCloseTo(1500, 0);
    }
  });
});
