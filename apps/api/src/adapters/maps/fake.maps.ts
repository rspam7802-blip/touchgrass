import { haversineMeters, type GeoPoint } from '@touchgrass/shared';
import { HYDERABAD_PLACES } from './hyderabad.fixtures.js';
import {
  MapsProvider,
  type PlaceDetails,
  type PlaceSuggestion,
  type ReverseGeocodeResult,
} from './maps.port.js';

/** Static Hyderabad fixtures. Autocomplete matches case-insensitively on name/address, nearest first. */
export class FakeMapsProvider extends MapsProvider {
  autocomplete(query: string, near: GeoPoint): Promise<PlaceSuggestion[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return Promise.resolve([]);
    return Promise.resolve(
      HYDERABAD_PLACES.filter(
        (p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
      )
        .sort((a, b) => haversineMeters(near, a.location) - haversineMeters(near, b.location))
        .slice(0, 5)
        .map((p) => ({ placeId: p.placeId, primaryText: p.name, secondaryText: p.address })),
    );
  }

  placeDetails(placeId: string): Promise<PlaceDetails | null> {
    const p = HYDERABAD_PLACES.find((x) => x.placeId === placeId);
    return Promise.resolve(
      p ? { placeId: p.placeId, name: p.name, address: p.address, location: p.location } : null,
    );
  }

  reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    const nearest = [...HYDERABAD_PLACES].sort(
      (a, b) => haversineMeters(point, a.location) - haversineMeters(point, b.location),
    )[0];
    if (!nearest || haversineMeters(point, nearest.location) > 5000) return Promise.resolve(null);
    return Promise.resolve({
      address: `Near ${nearest.name}, ${nearest.address}`,
      locality: 'Hyderabad',
      sublocality: nearest.sublocality,
    });
  }
}
