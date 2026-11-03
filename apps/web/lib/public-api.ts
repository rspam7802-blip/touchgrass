import {
  CheckoutPage,
  localeTag,
  PerkPassPreview,
  PlusOnePreview,
  PublicCrewView,
  PublicEventView,
  PublicLiveView,
  PublicProfileView,
  type SupportedLanguage,
} from '@touchgrass/shared';
import type { z } from 'zod';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const APP_SCHEME = 'touchgrass://';

/** Public (unauthenticated) API read; null on 404, throws on anything else so errors are not hidden. */
async function publicGet<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 60 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return schema.parse(await res.json());
}

export function publicEvent(slug: string): Promise<PublicEventView | null> {
  if (!/^[A-Za-z0-9]{6,16}$/.test(slug)) return Promise.resolve(null);
  return publicGet(`/v1/public/events/${slug}`, PublicEventView);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Shared profile links (F-GRW-02). */
export function publicProfile(id: string): Promise<PublicProfileView | null> {
  if (!UUID.test(id)) return Promise.resolve(null);
  return publicGet(`/v1/public/users/${id}`, PublicProfileView);
}

/** Shared crew links (F-GRW-02). */
export function publicCrew(id: string): Promise<PublicCrewView | null> {
  if (!UUID.test(id)) return Promise.resolve(null);
  return publicGet(`/v1/public/crews/${id}`, PublicCrewView);
}

export function plusOnePreview(token: string): Promise<PlusOnePreview | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return Promise.resolve(null);
  return publicGet(`/v1/plus-ones/${token}`, PlusOnePreview);
}

/** Uncached public read for pages that change by the second (checkout status, perk passes). */
async function publicFresh<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return schema.parse(await res.json());
}

const LONG_TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

export function checkoutPage(token: string): Promise<CheckoutPage | null> {
  if (!LONG_TOKEN.test(token)) return Promise.resolve(null);
  return publicFresh(`/v1/checkout/${token}`, CheckoutPage);
}

/** Signed live-location links (F-WEB-02): `<shareId>.<expiresAtSeconds>.<signature>`. */
export const LIVE_TOKEN = /^[0-9a-f-]{36}\.\d{1,12}\.[A-Za-z0-9_-]{43}$/;

export function liveView(token: string): Promise<PublicLiveView | null> {
  if (!LIVE_TOKEN.test(token)) return Promise.resolve(null);
  return publicFresh(`/v1/live/${token}`, PublicLiveView);
}

export function perkPreview(token: string): Promise<PerkPassPreview | null> {
  if (!LONG_TOKEN.test(token)) return Promise.resolve(null);
  return publicFresh(`/v1/perk-passes/${token}`, PerkPassPreview);
}

export type PostResult<T> =
  { ok: true; data: T | null } | { ok: false; code: string; reason: string | null };

/** Public (unauthenticated) API write from a server action; stable error code + reason on failure. */
export async function publicPost<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T> | null,
): Promise<PostResult<T>> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (res.ok)
    return { ok: true, data: schema && res.status !== 204 ? schema.parse(await res.json()) : null };
  const err = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; details?: { reason?: string } };
  };
  return {
    ok: false,
    code: err.error?.code ?? 'INTERNAL',
    reason: err.error?.details?.reason ?? null,
  };
}

/** Fills `{{name}}` placeholders in a translation string. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

/** Plan times are shown in the plan's city time zone (IST for every city so far). */
export function formatWhen(
  iso: string,
  language: SupportedLanguage,
  timeZone: string = 'Asia/Kolkata',
): string {
  return new Intl.DateTimeFormat(localeTag(language), {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}
