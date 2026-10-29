import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { MEDIA_DIR } from "@/lib/media";
import { BACKEND, contentType, signedUrl } from "@/lib/storage";
import { cookies } from "next/headers";
import { SESSION_COOKIE, validSession } from "@/lib/session";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const jar = await cookies();
  if (!validSession(jar.get(SESSION_COOKIE)?.value)) return new Response("unauthorized", { status: 401 });
  const { path } = await ctx.params;
  const rel = path.join("/");
  if (rel.includes("..")) return new Response("not found", { status: 404 });
  const abs = normalize(join(MEDIA_DIR, rel));
  if (abs.startsWith(MEDIA_DIR) && existsSync(abs)) {
    const size = statSync(abs).size;
    const stream = createReadStream(abs);
    return new Response(stream as unknown as ReadableStream, { headers: { "Content-Type": contentType(abs), "Content-Length": String(size), "Cache-Control": "private, max-age=31536000" } });
  }
  if (BACKEND === "supabase") {
    const url = await signedUrl(rel);
    if (url) return Response.redirect(url, 302);
  }
  return new Response("not found", { status: 404 });
}
