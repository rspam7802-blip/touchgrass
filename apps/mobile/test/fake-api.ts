import { jsonResponse } from '../test-utils';

export interface RecordedCall {
  method: string;
  path: string;
  /** Full URL including the query string. */
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

type Handler = (
  call: RecordedCall,
) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/**
 * Route-table fake for the TouchGrass API. Unmatched requests return 404 with the standard envelope,
 * so a screen that calls the wrong endpoint fails loudly.
 */
export class FakeApi {
  readonly calls: RecordedCall[] = [];
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

  on(
    method: string,
    path: string | RegExp,
    handler: Handler | { status: number; body?: unknown },
  ): this {
    const pattern =
      typeof path === 'string'
        ? new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
        : path;
    this.routes.unshift({
      method,
      pattern,
      handler: typeof handler === 'function' ? handler : () => handler,
    });
    return this;
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const call: RecordedCall = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      url: url.href,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    this.calls.push(call);
    const route = this.routes.find((r) => r.method === call.method && r.pattern.test(call.path));
    if (!route)
      return jsonResponse(404, {
        error: { code: 'NOT_FOUND', message: `${call.method} ${call.path}` },
      });
    const res = await route.handler(call);
    return res.status === 204 || res.body === undefined
      ? new Response(null, { status: res.status })
      : jsonResponse(res.status, res.body);
  };
}

export const ids = {
  me: '0192f3a4-5b6c-7d8e-9f01-000000000001',
  other: '0192f3a4-5b6c-7d8e-9f01-000000000002',
  city: '0192f3a4-5b6c-7d8e-9f01-0000000000c1',
  waitCity: '0192f3a4-5b6c-7d8e-9f01-0000000000c2',
  hood: '0192f3a4-5b6c-7d8e-9f01-0000000000d1',
  session: '0192f3a4-5b6c-7d8e-9f01-0000000000e1',
  otherSession: '0192f3a4-5b6c-7d8e-9f01-0000000000e2',
  asset: '0192f3a4-5b6c-7d8e-9f01-0000000000f1',
  interests: Array.from({ length: 5 }, (_, i) => `0192f3a4-5b6c-7d8e-9f01-00000000010${i}`),
  vibes: Array.from({ length: 3 }, (_, i) => `0192f3a4-5b6c-7d8e-9f01-00000000020${i}`),
};

const name = (en: string) => ({ en, te: `${en}-te`, hi: `${en}-hi` });
export const interestsFixture = ids.interests.map((id, i) => ({
  id,
  slug: `i${i}`,
  name: name(`Interest ${i}`),
  emoji: '🌱',
  category: 'misc',
}));
export const vibesFixture = ids.vibes.map((id, i) => ({
  id,
  slug: `v${i}`,
  name: name(`Vibe ${i}`),
  emoji: '✨',
}));
export const citiesFixture = [
  {
    id: ids.city,
    slug: 'hyderabad',
    name: 'Hyderabad',
    centre: { lat: 17.38, lng: 78.48 },
    timezone: 'Asia/Kolkata',
    launchStatus: 'beta',
    languages: ['en', 'te', 'hi'],
  },
  {
    id: ids.waitCity,
    slug: 'pune',
    name: 'Pune',
    centre: { lat: 18.5, lng: 73.8 },
    timezone: 'Asia/Kolkata',
    launchStatus: 'waitlist',
    languages: ['en'],
  },
];
export const hoodsFixture = [
  {
    id: ids.hood,
    cityId: ids.city,
    slug: 'madhapur',
    name: 'Madhapur',
    centroid: { lat: 17.44, lng: 78.39 },
  },
];
const urls = {
  sm: 'https://cdn.test/sm.webp',
  md: 'https://cdn.test/md.webp',
  lg: 'https://cdn.test/lg.webp',
};

export function meFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.me,
    status: 'active',
    phoneMasked: '+91••••••••38',
    language: 'en',
    roles: [],
    displayName: 'Priya R.',
    bio: 'Sunrise trekker',
    bioHeld: false,
    mutedUntil: null,
    dateOfBirth: '1998-05-20',
    gender: 'woman',
    pronouns: 'she/her',
    cityId: ids.city,
    neighbourhoodId: ids.hood,
    spokenLanguages: ['English', 'Telugu'],
    visibility: 'everyone',
    photos: [{ mediaAssetId: ids.asset, position: 0, status: 'ready', urls }],
    interests: interestsFixture.slice(0, 3),
    vibeTags: vibesFixture.slice(0, 1),
    stats: { eventsAttended: 0, eventsHosted: 0, reliabilityTier: 'new' },
    onboarding: {
      name: true,
      photos: true,
      dateOfBirth: true,
      city: true,
      interests: true,
      complete: true,
    },
    tutorialComplete: true,
    verified: false,
    createdAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}

export const authResponseFixture = (overrides: Record<string, unknown> = {}) => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1-xxxxxxxxxxxxxxxxxxxxxxxx',
  accessTokenExpiresAt: '2026-10-31T00:15:00.000Z',
  sessionId: ids.session,
  isNewUser: true,
  user: {
    id: ids.me,
    status: 'onboarding',
    onboardingComplete: false,
    tutorialComplete: false,
    roles: [],
  },
  ...overrides,
});

export { urls as urlsFixture };
