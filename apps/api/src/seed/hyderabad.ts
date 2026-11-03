import type { GeoPoint } from '@touchgrass/shared';

/** Box polygon around a centroid; neighbourhood boundaries are approximate for seeding and fuzzing. */
export function boxAround(c: GeoPoint, halfLat: number, halfLng: number): GeoPoint[] {
  return [
    { lat: c.lat - halfLat, lng: c.lng - halfLng },
    { lat: c.lat + halfLat, lng: c.lng - halfLng },
    { lat: c.lat + halfLat, lng: c.lng + halfLng },
    { lat: c.lat - halfLat, lng: c.lng + halfLng },
  ];
}

export const HYDERABAD = {
  slug: 'hyderabad',
  name: 'Hyderabad',
  centre: { lat: 17.385, lng: 78.4867 },
  bounds: [
    { lat: 17.2, lng: 78.2 },
    { lat: 17.65, lng: 78.2 },
    { lat: 17.65, lng: 78.7 },
    { lat: 17.2, lng: 78.7 },
  ],
  timezone: 'Asia/Kolkata',
  launchStatus: 'beta' as const,
  languages: ['en', 'te', 'hi'],
};

export const HYDERABAD_NEIGHBOURHOODS: { slug: string; name: string; centroid: GeoPoint }[] = [
  { slug: 'gachibowli', name: 'Gachibowli', centroid: { lat: 17.4401, lng: 78.3489 } },
  { slug: 'madhapur', name: 'Madhapur', centroid: { lat: 17.4483, lng: 78.3915 } },
  { slug: 'jubilee-hills', name: 'Jubilee Hills', centroid: { lat: 17.4326, lng: 78.4071 } },
  { slug: 'banjara-hills', name: 'Banjara Hills', centroid: { lat: 17.4156, lng: 78.4347 } },
  { slug: 'kondapur', name: 'Kondapur', centroid: { lat: 17.4698, lng: 78.3571 } },
];
