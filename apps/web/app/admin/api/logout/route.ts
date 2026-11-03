import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, clearSessionCookies, rawApi } from '../../../../lib/admin-session';

export async function POST(req: Request): Promise<Response> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token) await rawApi('/v1/auth/logout', { method: 'POST', token }).catch(() => undefined);
  await clearSessionCookies();
  return NextResponse.redirect(new URL('/admin/login', req.url), 303);
}
