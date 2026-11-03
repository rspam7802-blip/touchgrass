import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_COOKIE = 'tg_admin_at';
const REFRESH_COOKIE = 'tg_admin_rt';

/** Every /admin page needs an admin session; login and the auth route handlers are open. */
export function proxy(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/admin/login') || pathname.startsWith('/admin/api/'))
    return NextResponse.next();
  if (req.cookies.has(ACCESS_COOKIE)) return NextResponse.next();
  const url = req.nextUrl.clone();
  if (req.cookies.has(REFRESH_COOKIE)) {
    url.pathname = '/admin/api/refresh';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
  } else {
    url.pathname = '/admin/login';
    url.search = '';
  }
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/admin/:path*'] };
