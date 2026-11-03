import { AuthTokens } from '@touchgrass/shared';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  clearSessionCookies,
  parse,
  rawApi,
  REFRESH_COOKIE,
  setSessionCookies,
} from '../../../../lib/admin-session';

/** Rotates the refresh token and returns to the page that needed it; any failure ends the session. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const nextParam = url.searchParams.get('next') ?? '/admin';
  const next =
    nextParam.startsWith('/admin') && !nextParam.startsWith('/admin/api') ? nextParam : '/admin';
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    try {
      const tokens = await parse(
        await rawApi('/v1/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        }),
        AuthTokens,
      );
      await setSessionCookies(tokens);
      return NextResponse.redirect(new URL(next, url.origin));
    } catch {
      // Fall through to sign-in: the refresh token was revoked, reused or expired.
    }
  }
  await clearSessionCookies();
  return NextResponse.redirect(new URL('/admin/login', url.origin));
}
