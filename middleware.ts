import { NextResponse, type NextRequest } from "next/server";

// Fast, edge-safe gate: just checks the session cookie is present, and
// redirects to /login if not. This is defense in depth, not the
// authoritative check — each protected page still calls
// getCurrentUser() (a real DB lookup via lib/auth.ts) itself, since
// verifying against SQLite isn't possible from edge middleware.
const COOKIE_NAME = "gw_user_id";
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(COOKIE_NAME);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next's internals and static assets — every app page
  // and API route (other than the public paths above) requires a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
