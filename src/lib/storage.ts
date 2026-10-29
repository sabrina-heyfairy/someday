import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MEDIA_DIR } from "./media";

// Media lives in MEDIA_DIR on disk while being processed (ffmpeg and yt-dlp need files).
// MEDIA_BACKEND=supabase mirrors each item's folder to a private Supabase Storage bucket after processing,
// and the /api/media route redirects to short-lived signed URLs. MEDIA_BACKEND=local (default) serves from disk.
export const BACKEND = (process.env.MEDIA_BACKEND ?? "local") as "local" | "supabase";
const BUCKET = process.env.SUPABASE_MEDIA_BUCKET ?? "media";
const KEEP_LOCAL = process.env.MEDIA_LOCAL_CACHE !== "0";

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("MEDIA_BACKEND=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", mp4: "video/mp4", mp3: "audio/mpeg" };
export const contentType = (p: string) => TYPES[p.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

// Upload every file in an item's folder. Idempotent (upsert). Optionally drop the local copy to save disk.
export async function syncItemDir(id: string, { dropLocal = !KEEP_LOCAL } = {}) {
  if (BACKEND !== "supabase") return;
  const dir = join(MEDIA_DIR, id);
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const abs = join(dir, f);
    if (!statSync(abs).isFile() || f === "thumb_src") continue;
    const { error } = await sb().storage.from(BUCKET).upload(`${id}/${f}`, readFileSync(abs), { contentType: contentType(f), upsert: true });
    if (error) throw new Error(`storage upload ${id}/${f}: ${error.message}`);
  }
  if (dropLocal) rmSync(dir, { recursive: true, force: true });
}

// Make sure a media file is on local disk (download from the bucket if needed). Returns the absolute path.
export async function ensureLocal(relPath: string): Promise<string> {
  const abs = join(MEDIA_DIR, relPath);
  if (existsSync(abs) || BACKEND !== "supabase") return abs;
  const { data, error } = await sb().storage.from(BUCKET).download(relPath);
  if (error || !data) throw new Error(`storage download ${relPath}: ${error?.message ?? "no data"}`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, Buffer.from(await data.arrayBuffer()));
  return abs;
}

// Where the browser should fetch a media file from. Local: served by our route. Supabase: signed URL, 1 hour.
export async function signedUrl(relPath: string): Promise<string | null> {
  if (BACKEND !== "supabase") return null;
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(relPath, 3600);
  if (error) return null;
  return data.signedUrl;
}
