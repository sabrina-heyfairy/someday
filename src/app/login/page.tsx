import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { passwordMatches, SESSION_COOKIE, sessionToken, gateEnabled } from "@/lib/session";

export const dynamic = "force-dynamic";

async function login(fd: FormData) {
  "use server";
  const next = String(fd.get("next") || "/");
  const pw = String(fd.get("password") ?? "");
  if (!gateEnabled() || passwordMatches(pw)) {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, sessionToken(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    redirect(next.startsWith("/") ? next : "/");
  }
  redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return (
    <form action={login} className="card max-w-sm mx-auto mt-16 rounded-2xl p-6 space-y-3">
      <h1 className="font-semibold text-lg">Someday</h1>
      <p className="text-sm muted">This is a private stash. Enter the password to continue.</p>
      <input type="hidden" name="next" value={sp.next ?? "/"} />
      <input type="password" name="password" autoFocus placeholder="Password" className="card w-full rounded-xl px-3 py-2" />
      {sp.error && <p className="text-sm" style={{ color: "var(--accent)" }}>That wasn't it.</p>}
      <button className="rounded-xl px-4 py-2 text-white font-medium w-full" style={{ background: "var(--accent)" }}>Unlock</button>
    </form>
  );
}
