import type { GeoPoint } from '@touchgrass/shared';

export interface PlaceSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  address: string;
  location: GeoPoint;
}

export interface ReverseGeocodeResult {
  address: string;
  locality?: string;
  sublocality?: string;
}

/** Places autocomplete/details and geocoding (F-EVT-02 location search). */
export abstract class MapsProvider {
  abstract autocomplete(
    query: string,
    near: GeoPoint,
    sessionToken: string,
  ): Promise<PlaceSuggestion[]>;
  abstract placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetails | null>;
  abstract reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null>;
}
