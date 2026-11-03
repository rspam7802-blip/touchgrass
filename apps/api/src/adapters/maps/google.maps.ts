import type { GeoPoint } from '@touchgrass/shared';
import { type FetchFn, requestJson } from '../http/http-client.js';
import {
  MapsProvider,
  type PlaceDetails,
  type PlaceSuggestion,
  type ReverseGeocodeResult,
} from './maps.port.js';

interface AutocompleteResponse {
  suggestions?: {
    placePrediction?: {
      placeId: string;
      structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
      text?: { text: string };
    };
  }[];
}
interface PlaceResponse {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
}
interface GeocodeResponse {
  status: string;
  results: {
    formatted_address: string;
    address_components: { long_name: string; types: string[] }[];
  }[];
}

/** Google Places API (New) + Geocoding API. Session tokens bundle autocomplete + details for billing. */
export class GoogleMapsProvider extends MapsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
  }

  async autocomplete(
    query: string,
    near: GeoPoint,
    sessionToken: string,
  ): Promise<PlaceSuggestion[]> {
    const res = await requestJson<AutocompleteResponse>(
      this.fetchFn,
      'google-places',
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: { 'X-Goog-Api-Key': this.apiKey },
        body: {
          input: query,
          sessionToken,
          includedRegionCodes: ['in'],
          locationBias: {
            circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30000 },
          },
        },
      },
    );
    return (res.suggestions ?? []).flatMap((s) => {
      const p = s.placePrediction;
      if (!p) return [];
      return [
        {
          placeId: p.placeId,
          primaryText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
          secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
        },
      ];
    });
  }

  async placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetails | null> {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`;
    const res = await requestJson<PlaceResponse>(this.fetchFn, 'google-places', url, {
      headers: {
        'X-Goog-Api-Key': this.apiKey,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
      },
    });
    if (!res.location) return null;
    return {
      placeId: res.id,
      name: res.displayName?.text ?? '',
      address: res.formattedAddress ?? '',
      location: { lat: res.location.latitude, lng: res.location.longitude },
    };
  }

  async reverseGeocode(point: GeoPoint): Promise<ReverseGeocodeResult | null> {
    const params = new URLSearchParams({
      latlng: `${point.lat},${point.lng}`,
      key: this.apiKey,
      language: 'en',
    });
    const res = await requestJson<GeocodeResponse>(
      this.fetchFn,
      'google-geocoding',
      `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`,
    );
    const first = res.results[0];
    if (res.status !== 'OK' || !first) return null;
    const find = (type: string): string | undefined =>
      first.address_components.find((c) => c.types.includes(type))?.long_name;
    return {
      address: first.formatted_address,
      locality: find('locality'),
      sublocality: find('sublocality_level_1') ?? find('sublocality'),
    };
  }
}
