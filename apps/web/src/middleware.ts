import { NextResponse, type NextRequest } from 'next/server';

/** Signed-out visitors to private areas go to sign-in first; the API still authorises everything. */
const PROTECTED = ['/owner', '/trips', '/admin', '/account', '/book', '/notifications', '/issues', '/onboarding'];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.get('sid')) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth';
    url.search = `?returnTo=${encodeURIComponent(pathname + search)}${pathname.startsWith('/book') ? '&intent=booking' : ''}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|media|_next|sw.js|icon.svg|manifest.webmanifest).*)'] };
