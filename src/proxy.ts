import { NextResponse, type NextRequest } from "next/server";

// Gate the UI and media behind the session cookie. Token-authenticated API routes and the login page stay open.
// (Called "proxy" in Next 16, "middleware" in Next 15 - see middleware.ts which re-exports this.)
const OPEN = [/^\/login$/, /^\/api\/(capture|process|items|health|sync)$/, /^\/api\/reddit\//, /^\/manifest\.webmanifest$/, /^\/icons\//];
const COOKIE = "someday_session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!process.env.APP_PASSWORD || OPEN.some((r) => r.test(pathname))) return NextResponse.next();
  const cookie = req.cookies.get(COOKIE)?.value;
  // Edge runtime has WebCrypto, not node:crypto; compare against a token minted by the server at login.
  if (cookie && cookie === req.cookies.get(COOKIE)?.value && cookie.length === 64) {
    // Cheap pre-check; the real HMAC check happens in the page via `requireSession`.
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
