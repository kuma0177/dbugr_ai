import { NextRequest, NextResponse } from 'next/server';

function isExternalHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return !['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const match = pathname.match(/^\/sessions\/([^/]+)\/record$/);

  if (!match) return NextResponse.next();

  const targetUrl = searchParams.get('url') ?? '';
  if (!targetUrl || !isExternalHttpUrl(targetUrl)) return NextResponse.next();

  const sessionId = match[1];
  const target = searchParams.get('target') === 'codex' ? 'codex' : 'claude';

  const redirectUrl = req.nextUrl.clone();
  redirectUrl.pathname = `/sessions/${sessionId}/launch`;
  redirectUrl.search = '';
  redirectUrl.searchParams.set('url', targetUrl);
  redirectUrl.searchParams.set('target', target);

  return NextResponse.redirect(redirectUrl);
}

export const config = {
  matcher: ['/sessions/:path*'],
};
