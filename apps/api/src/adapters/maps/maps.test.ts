import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonBody } from '../../test-support/env.js';
import { FakeMapsProvider } from './fake.maps.js';
import { GoogleMapsProvider } from './google.maps.js';

const madhapur = { lat: 17.4483, lng: 78.3915 };

describe('FakeMapsProvider', () => {
  const maps = new FakeMapsProvider();
  it('autocompletes Hyderabad fixtures nearest first', async () => {
    const results = await maps.autocomplete('mall', madhapur);
    expect(results[0]?.primaryText).toBe('Inorbit Mall');
    expect(results.length).toBeGreaterThan(1);
    expect(await maps.autocomplete('  ', madhapur)).toEqual([]);
  });
  it('returns details and reverse geocodes', async () => {
    expect(await maps.placeDetails('fx_kbr_park')).toMatchObject({ name: 'KBR National Park' });
    expect(await maps.placeDetails('nope')).toBeNull();
    expect(await maps.reverseGeocode({ lat: 17.4295, lng: 78.389 })).toMatchObject({
      sublocality: 'Madhapur',
    });
    expect(await maps.reverseGeocode({ lat: 12.97, lng: 77.59 })).toBeNull();
  });
});

describe('GoogleMapsProvider', () => {
  it('calls Places autocomplete with location bias', async () => {
    const f = fakeFetch([
      {
        body: {
          suggestions: [
            {
              placePrediction: {
                placeId: 'p1',
                structuredFormat: {
                  mainText: { text: 'Roastery' },
                  secondaryText: { text: 'Banjara Hills' },
                },
              },
            },
            { placePrediction: { placeId: 'p2', text: { text: 'Plain' } } },
            { queryPrediction: {} },
          ],
        },
      },
    ]);
    const res = await new GoogleMapsProvider('k', f.fetch).autocomplete('roast', madhapur, 'sess');
    expect(res).toEqual([
      { placeId: 'p1', primaryText: 'Roastery', secondaryText: 'Banjara Hills' },
      { placeId: 'p2', primaryText: 'Plain', secondaryText: '' },
    ]);
    expect(jsonBody(f.calls[0]?.init)).toMatchObject({
      input: 'roast',
      sessionToken: 'sess',
      includedRegionCodes: ['in'],
    });
  });
  it('fetches place details with a field mask', async () => {
    const f = fakeFetch([
      {
        body: {
          id: 'p1',
          displayName: { text: 'R' },
          formattedAddress: 'A',
          location: { latitude: 17.4, longitude: 78.4 },
        },
      },
      { body: { id: 'p2' } },
    ]);
    const g = new GoogleMapsProvider('k', f.fetch);
    expect(await g.placeDetails('p1', 's')).toEqual({
      placeId: 'p1',
      name: 'R',
      address: 'A',
      location: { lat: 17.4, lng: 78.4 },
    });
    expect((f.calls[0]?.init?.headers as Record<string, string>)['X-Goog-FieldMask']).toContain(
      'location',
    );
    expect(await g.placeDetails('p2', 's')).toBeNull();
  });
  it('reverse geocodes', async () => {
    const f = fakeFetch([
      {
        body: {
          status: 'OK',
          results: [
            {
              formatted_address: 'Road 36, Jubilee Hills',
              address_components: [
                { long_name: 'Hyderabad', types: ['locality'] },
                { long_name: 'Jubilee Hills', types: ['sublocality_level_1', 'sublocality'] },
              ],
            },
          ],
        },
      },
      { body: { status: 'ZERO_RESULTS', results: [] } },
    ]);
    const g = new GoogleMapsProvider('k', f.fetch);
    expect(await g.reverseGeocode(madhapur)).toEqual({
      address: 'Road 36, Jubilee Hills',
      locality: 'Hyderabad',
      sublocality: 'Jubilee Hills',
    });
    expect(await g.reverseGeocode(madhapur)).toBeNull();
  });
});
