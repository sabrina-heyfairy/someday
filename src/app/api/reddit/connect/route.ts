import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { SESSION_COOKIE, validSession } from "@/lib/session";
import { redditAuthorizeUrl, redditConfigured } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const jar = await cookies();
  if (!validSession(jar.get(SESSION_COOKIE)?.value)) return NextResponse.redirect(new URL("/login?next=/sources", req.url));
  if (!redditConfigured()) return NextResponse.redirect(new URL("/sources?error=not+configured", req.url));
  const state = randomBytes(16).toString("hex");
  jar.set("reddit_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  const redirectUri = `${process.env.APP_URL ?? new URL(req.url).origin}/api/reddit/callback`;
  return NextResponse.redirect(redditAuthorizeUrl(redirectUri, state));
}
