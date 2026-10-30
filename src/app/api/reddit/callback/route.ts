import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, validSession } from "@/lib/session";
import { redditExchangeCode, redditMe } from "@/lib/sources";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const jar = await cookies();
  const back = (q: string) => NextResponse.redirect(new URL(`/sources?${q}`, process.env.APP_URL ?? req.url));
  if (!validSession(jar.get(SESSION_COOKIE)?.value)) return NextResponse.redirect(new URL("/login?next=/sources", req.url));
  const u = new URL(req.url);
  const code = u.searchParams.get("code"), state = u.searchParams.get("state"), err = u.searchParams.get("error");
  if (err) return back(`error=${encodeURIComponent(err)}`);
  if (!code || !state || state !== jar.get("reddit_oauth_state")?.value) return back("error=state+mismatch");
  try {
    const redirectUri = `${process.env.APP_URL ?? u.origin}/api/reddit/callback`;
    const tok = await redditExchangeCode(code, redirectUri);
    const username = await redditMe(tok.access_token);
    await sql`delete from sources where kind = 'reddit_saved'`;
    await sql`insert into sources (kind, label, config) values ('reddit_saved', ${`u/${username} saved`}, ${sql.json({ username, refresh_token: tok.refresh_token })})`;
    return back(`connected=${encodeURIComponent(username)}`);
  } catch (e) {
    return back(`error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
}
