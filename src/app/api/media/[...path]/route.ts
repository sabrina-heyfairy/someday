import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { MEDIA_DIR } from "@/lib/media";
import { cookies } from "next/headers";
import { SESSION_COOKIE, validSession } from "@/lib/session";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mp3: "audio/mpeg" };

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const jar = await cookies();
  if (!validSession(jar.get(SESSION_COOKIE)?.value)) return new Response("unauthorized", { status: 401 });
  const { path } = await ctx.params;
  const abs = normalize(join(MEDIA_DIR, ...path));
  if (!abs.startsWith(MEDIA_DIR) || !existsSync(abs)) return new Response("not found", { status: 404 });
  const ext = abs.split(".").pop()!.toLowerCase();
  const size = statSync(abs).size;
  const stream = createReadStream(abs);
  return new Response(stream as unknown as ReadableStream, { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Content-Length": String(size), "Cache-Control": "private, max-age=31536000" } });
}
