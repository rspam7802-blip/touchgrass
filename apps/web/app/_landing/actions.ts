'use server';

import {
  InviteCheckBody,
  InviteCheckResponse,
  LaunchWaitlistBody,
  LaunchWaitlistResponse,
} from '@touchgrass/shared';
import { headers } from 'next/headers';
import { isSupportedLanguage } from '../../lib/i18n';
import { publicPost } from '../../lib/public-api';

/** The visitor's address chain, so the API's per-address limits apply per visitor (as the admin sign-in does). */
async function forwardedFor(): Promise<Record<string, string>> {
  const value = (await headers()).get('x-forwarded-for');
  return value ? { 'x-forwarded-for': value } : {};
}

export interface InviteCheckState {
  status: 'idle' | 'valid' | 'invalid' | 'error';
  code: string | null;
  inviterName: string | null;
  /** API error code when status is `error` (rate limited, unavailable). */
  error: string | null;
}

/** Landing page invite checker (D-169): valid or not, plus the inviter's name for member codes. Nothing else. */
export async function checkInviteAction(
  _prev: InviteCheckState,
  form: FormData,
): Promise<InviteCheckState> {
  const parsed = InviteCheckBody.safeParse({ code: form.get('code') });
  if (!parsed.success) return { status: 'invalid', code: null, inviterName: null, error: null };
  const res = await publicPost(
    '/v1/auth/invites/check',
    { code: parsed.data.code },
    InviteCheckResponse,
    await forwardedFor(),
  );
  if (!res.ok) return { status: 'error', code: null, inviterName: null, error: res.code };
  if (!res.data?.valid) return { status: 'invalid', code: null, inviterName: null, error: null };
  return {
    status: 'valid',
    code: parsed.data.code,
    inviterName: res.data.inviterName,
    error: null,
  };
}

export type WaitlistField = 'name' | 'phone' | 'email' | 'contact' | 'city' | 'consent';
const FIELDS: readonly WaitlistField[] = ['name', 'phone', 'email', 'contact', 'city', 'consent'];

export interface WaitlistValues {
  name: string;
  phone: string;
  email: string;
  city: string;
  note: string;
  consent: boolean;
}

export interface WaitlistState {
  done: boolean;
  fields: WaitlistField[];
  /** API error code (rate limited, unavailable). */
  error: string | null;
  /** What was typed, so a failed attempt keeps it. */
  values: WaitlistValues;
}

const text = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
};

/** Public waitlist form (D-169). The shared schema checks it here for field messages; the API checks again. */
export async function joinWaitlistAction(
  _prev: WaitlistState,
  form: FormData,
): Promise<WaitlistState> {
  const values: WaitlistValues = {
    name: text(form, 'name').slice(0, 60),
    phone: text(form, 'phone').slice(0, 20),
    email: text(form, 'email').slice(0, 254),
    city: text(form, 'city').slice(0, 60),
    note: text(form, 'note').slice(0, 200),
    consent: form.get('consent') === 'on',
  };
  const language = text(form, 'language');
  const body = {
    ...values,
    language: isSupportedLanguage(language) ? language : 'en',
  };
  const parsed = LaunchWaitlistBody.safeParse(body);
  if (!parsed.success) {
    const failed = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? 'contact')));
    return {
      done: false,
      fields: FIELDS.filter((f) => failed.has(f)),
      error: null,
      values,
    };
  }
  const res = await publicPost(
    '/v1/public/waitlist',
    body,
    LaunchWaitlistResponse,
    await forwardedFor(),
  );
  if (!res.ok) return { done: false, fields: [], error: res.code, values };
  return { done: true, fields: [], error: null, values };
}
