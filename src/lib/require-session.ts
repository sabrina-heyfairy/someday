import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, validSession } from "./session";

// Server-side check with the real HMAC compare. Call at the top of every protected page/route.
export async function requireSession(nextPath = "/") {
  const jar = await cookies();
  if (!validSession(jar.get(SESSION_COOKIE)?.value)) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
}
