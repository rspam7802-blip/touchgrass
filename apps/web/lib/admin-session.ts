import 'server-only';
import { type AuthTokens, ErrorEnvelope } from '@touchgrass/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { z } from 'zod';

/** Server-only API access for the admin dashboard. Tokens live in httpOnly cookies, never in browser JS. */
export const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const ACCESS_COOKIE = 'tg_admin_at';
export const REFRESH_COOKIE = 'tg_admin_rt';
export const ADMIN_ROLES = [
  'super_admin',
  'admin',
  'moderator',
  'city_curator',
  'support',
] as const;

const secure = process.env.NODE_ENV === 'production';
export const cookieOptions = {
  httpOnly: true,
  secure,
  sameSite: 'strict' as const,
  path: '/admin',
};

export class AdminApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export async function setSessionCookies(
  tokens: Pick<AuthTokens, 'accessToken' | 'refreshToken'>,
): Promise<void> {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, tokens.accessToken, { ...cookieOptions, maxAge: 15 * 60 });
  jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 });
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: ACCESS_COOKIE, path: '/admin' });
  jar.delete({ name: REFRESH_COOKIE, path: '/admin' });
}

export async function rawApi(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

export async function parse<T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> {
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const env = ErrorEnvelope.safeParse(json);
    throw new AdminApiError(
      env.success ? env.data.error.code : 'INTERNAL',
      env.success ? env.data.error.message : `HTTP ${res.status}`,
      res.status,
    );
  }
  return schema.parse(json);
}

/**
 * Authenticated admin API call from a server component or server action.
 * An expired access token bounces through the refresh route (which can set cookies) and back.
 */
export async function adminApi<T extends z.ZodType>(
  path: string,
  schema: T,
  init: RequestInit = {},
  returnTo = '/admin',
): Promise<z.infer<T>> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token)
    redirect(
      jar.get(REFRESH_COOKIE)
        ? `/admin/api/refresh?next=${encodeURIComponent(returnTo)}`
        : '/admin/login',
    );
  const res = await rawApi(path, { ...init, token });
  if (res.status === 401) redirect(`/admin/api/refresh?next=${encodeURIComponent(returnTo)}`);
  return parse(res, schema);
}

/** Decodes (without verifying; the API verifies) the role claim to tailor navigation. */
export function rolesFromToken(token: string | undefined): string[] {
  if (!token) return [];
  const payload = token.split('.')[1];
  if (!payload) return [];
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      roles?: unknown;
    };
    return Array.isArray(claims.roles)
      ? claims.roles.filter((r): r is string => typeof r === 'string')
      : [];
  } catch {
    return [];
  }
}

export function isAdminRole(roles: readonly string[]): boolean {
  return roles.some((r) => (ADMIN_ROLES as readonly string[]).includes(r));
}
