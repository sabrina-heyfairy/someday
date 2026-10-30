import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const MEDIA_DIR = resolve(process.env.MEDIA_DIR || "./data/media");

export function itemDir(id: string) {
  const d = join(MEDIA_DIR, id);
  mkdirSync(d, { recursive: true });
  return d;
}
export const rel = (abs: string) => abs.slice(MEDIA_DIR.length + 1);
export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export function detectSource(url: string | null | undefined, kind: string): string {
  if (!url) return kind === "image" ? "screenshot" : "text";
  const h = new URL(url).hostname.replace(/^www\./, "");
  if (/instagram\.com$/.test(h)) return "instagram";
  if (/tiktok\.com$/.test(h)) return "tiktok";
  if (/facebook\.com$|fb\.watch$|fb\.com$/.test(h)) return "facebook";
  if (/reddit\.com$|redd\.it$/.test(h)) return "reddit";
  if (/youtube\.com$|youtu\.be$/.test(h)) return "youtube";
  if (/pinterest\.|pin\.it$/.test(h)) return "pinterest";
  return "web";
}

const SHORTENERS = /^(vm\.tiktok\.com|vt\.tiktok\.com|pin\.it|fb\.watch|redd\.it|t\.co|youtu\.be|bit\.ly|a\.co|amzn\.to)$/;

// Short links (vm.tiktok.com/xyz, pin.it/abc) hide the real post id; follow them once.
export async function resolveShortLink(url: string): Promise<string> {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const tiktokShare = host === "tiktok.com" && /^\/t\//.test(u.pathname);
    if (!SHORTENERS.test(host) && !tiktokShare) return url;
    if (u.hostname === "youtu.be") return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
    const r = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" } });
    return r.url && r.url !== url ? r.url : url;
  } catch { return url; }
}

// Strip tracking junk and platform URL variants so the same post shared twice dedupes.
export function canonicalize(url: string): string {
  const u = new URL(url);
  u.hash = "";
  const host = u.hostname.replace(/^(www|m|mobile|old|new)\./, "");
  let path = u.pathname.replace(/\/+$/, "");
  let query = "";
  if (/youtube\.com$/.test(host)) {
    const id = u.searchParams.get("v") ?? path.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1];
    return id ? `https://youtube.com/watch?v=${id}` : `https://${host}${path}`;
  }
  if (/instagram\.com$/.test(host)) {
    const m = path.match(/^\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    if (m) return `https://instagram.com/p/${m[1]}`;
  }
  if (/tiktok\.com$/.test(host)) {
    const m = path.match(/\/(?:video|photo|v)\/(\d+)/);
    if (m) return `https://tiktok.com/v/${m[1]}`;
  }
  if (/reddit\.com$/.test(host)) {
    const m = path.match(/^\/r\/([^/]+)\/comments\/([a-z0-9]+)/i);
    if (m) return `https://reddit.com/r/${m[1]}/comments/${m[2]}`;
  }
  if (/facebook\.com$/.test(host)) {
    const v = u.searchParams.get("v") ?? path.match(/\/(?:reel|videos|watch)\/(\d+)/)?.[1];
    if (v) return `https://facebook.com/reel/${v}`;
    const sid = u.searchParams.get("story_fbid"); const pid = u.searchParams.get("id");
    if (sid && pid) return `https://facebook.com/permalink.php?story_fbid=${sid}&id=${pid}`;
  }
  if (/pinterest\./.test(host)) {
    const m = path.match(/^\/pin\/(\d+)/);
    if (m) return `https://pinterest.com/pin/${m[1]}`;
  }
  const keep = new Set(["v", "id", "p", "q", "story_fbid"]);
  for (const k of [...u.searchParams.keys()]) if (!keep.has(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  query = u.searchParams.toString();
  return `https://${host}${path || "/"}${query ? "?" + query : ""}`;
}

export type YtMeta = {
  title?: string; description?: string; uploader?: string; uploader_id?: string; channel?: string;
  duration?: number; thumbnail?: string; webpage_url?: string; extractor_key?: string; _type?: string;
  vcodec?: string; formats?: unknown[]; ext?: string;
};

// Logged-in fetching. YTDLP_COOKIES_FROM_BROWSER=safari|chrome|firefox reads the browser's cookie jar (laptop; Safari needs
// Full Disk Access for the terminal). YTDLP_COOKIES_FILE=/data/cookies.txt uses an exported Netscape cookies file (servers).
export function ytCookieArgs(): string[] {
  if (process.env.YTDLP_COOKIES_FILE && existsSync(process.env.YTDLP_COOKIES_FILE)) return ["--cookies", process.env.YTDLP_COOKIES_FILE];
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) return ["--cookies-from-browser", process.env.YTDLP_COOKIES_FROM_BROWSER];
  return [];
}

export async function ytMeta(url: string): Promise<YtMeta | null> {
  try {
    const { stdout } = await run("yt-dlp", ["-J", "--no-playlist", "--no-warnings", ...ytCookieArgs(), url], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    return JSON.parse(stdout) as YtMeta;
  } catch {
    return null;
  }
}

export async function ytDownload(url: string, dir: string): Promise<string | null> {
  try {
    await run("yt-dlp", ["--no-playlist", "--no-warnings", ...ytCookieArgs(), "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4", "-o", join(dir, "video.%(ext)s"), url], { timeout: 180_000 });
    const f = readdirSync(dir).find((n) => n.startsWith("video."));
    return f ? join(dir, f) : null;
  } catch {
    return null;
  }
}

export async function keyframes(video: string, dir: string, duration?: number): Promise<string[]> {
  const n = 8;
  const every = Math.max(1, Math.floor((duration || 30) / n));
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", `fps=1/${every},scale=768:-2`, "-frames:v", String(n), "-q:v", "4", join(dir, "frame_%02d.jpg")]);
  return readdirSync(dir).filter((f) => f.startsWith("frame_")).sort().map((f) => join(dir, f));
}

export async function extractAudio(video: string, dir: string): Promise<string | null> {
  const out = join(dir, "audio.mp3");
  try {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", out]);
    return existsSync(out) ? out : null;
  } catch {
    return null;
  }
}

export async function toJpeg(input: string, out: string, maxW = 1024): Promise<string> {
  if (/\.heic$/i.test(input) && process.platform === "darwin") {
    // ffmpeg builds usually lack HEIC; macOS sips converts natively.
    const mid = out.replace(/\.jpg$/, ".heic.jpg");
    await run("sips", ["-s", "format", "jpeg", input, "--out", mid]);
    input = mid;
  }
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-vf", `scale='min(${maxW},iw)':-2`, "-q:v", "3", out]);
  return out;
}

// 64-bit difference hash: 9x8 grayscale, compare horizontal neighbours. Returns a 64-char bit string.
export async function dhash(imagePath: string): Promise<string | null> {
  try {
    const { stdout } = await run("ffmpeg", ["-loglevel", "error", "-i", imagePath, "-vf", "scale=9:8:flags=area,format=gray", "-frames:v", "1", "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1024 * 1024 });
    const px = stdout as unknown as Buffer;
    if (px.length < 72) return null;
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] < px[y * 9 + x + 1] ? "1" : "0";
    // Flat images (solid colours, blank screens) hash to ~all zeros/ones and would match each other; treat as no fingerprint.
    const ones = bits.split("1").length - 1;
    if (ones < 6 || ones > 58) return null;
    return bits;
  } catch { return null; }
}

export async function download(url: string, out: string, auth?: { user: string; pass: string }): Promise<Buffer> {
  const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0 (Macintosh) someday/0.1" };
  if (auth) headers.Authorization = "Basic " + Buffer.from(`${auth.user}:${auth.pass}`).toString("base64");
  const r = await fetch(url, { headers, redirect: "follow" });
  if (!r.ok) throw new Error(`download ${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(out, buf);
  return buf;
}

export type PageInfo = { title?: string; description?: string; image?: string; text?: string; author?: string; error?: string };

// Fallback for non-video links: og tags + visible text. Reddit gets its JSON API.
export async function pageInfo(url: string): Promise<PageInfo> {
  const src = detectSource(url, "link");
  try {
    if (src === "reddit") {
      // Reddit's JSON API: always via www (old./m. redirect to HTML), fall through to HTML scraping if it fails.
      try {
        const u = new URL(url); u.hostname = "www.reddit.com"; u.search = ""; u.pathname = u.pathname.replace(/\/$/, "") + ".json";
        const r = await fetch(u, { headers: { "User-Agent": "someday/0.1 personal bookmark tool" } });
        if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) {
          const j = await r.json();
          const post = j?.[0]?.data?.children?.[0]?.data;
          if (post) {
            const comments = (j?.[1]?.data?.children ?? []).slice(0, 15).map((c: { data?: { body?: string } }) => c.data?.body).filter(Boolean).join("\n---\n");
            const gallery = post.media_metadata ? Object.values(post.media_metadata as Record<string, { s?: { u?: string } }>).map((m) => m.s?.u?.replace(/&amp;/g, "&")).filter(Boolean)[0] : undefined;
            const image = post.url_overridden_by_dest?.match(/\.(jpe?g|png|webp)(\?|$)/i) ? post.url_overridden_by_dest : gallery ?? post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, "&") ?? (post.thumbnail?.startsWith("http") ? post.thumbnail : undefined);
            return { title: post.title, description: post.selftext?.slice(0, 2000), author: post.author ? `u/${post.author}` : undefined, image, text: `${post.selftext ?? ""}\n\nTop comments:\n${comments}`.slice(0, 8000) };
          }
        }
      } catch { /* fall through to HTML */ }
    }
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124 Safari/537.36" }, redirect: "follow" });
    if (!r.ok) throw new Error(`page fetch ${r.status}`);
    const html = await r.text();
    const og = (p: string) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)`, "i"))?.[1] ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, "i"))?.[1];
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
    return { title: og("og:title") ?? html.match(/<title>([^<]*)/i)?.[1], description: og("og:description") ?? og("description"), image: og("og:image"), author: og("author"), text };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const decodeEntities = (v: string) => v.replace(/&amp;/g, "&").replace(/\\u0026/g, "&").replace(/\\\//g, "/");

export type TikTokEmbed = { id: string; image?: string; title?: string; author?: string };

// TikTok blocks yt-dlp and oEmbed thumbnails from datacenter IPs, but its public embed page carries the video poster
// and caption. Share links (tiktok.com/t/XYZ, vm.tiktok.com/XYZ) are followed once to find the numeric video id.
export async function tiktokEmbedInfo(url: string): Promise<TikTokEmbed | null> {
  const idOf = (u: string) => u.match(/\/(?:video|photo|v)\/(\d+)/)?.[1];
  let id = idOf(url);
  if (!id) id = idOf(await resolveShortLink(url));
  if (!id) return null;
  try {
    const r = await fetch(`https://www.tiktok.com/embed/v2/${id}`, { headers: { "User-Agent": "someday/0.1 personal bookmark tool" }, redirect: "follow" });
    if (!r.ok) return { id };
    const html = await r.text();
    const image = html.match(/poster="([^"]+)"/)?.[1] ?? html.match(/"(?:cover|originCover|dynamicCover)":"([^"]+)"/)?.[1];
    const title = html.match(/"desc":"((?:[^"\\]|\\.)*)"/)?.[1];
    const author = html.match(/"uniqueId":"([^"]+)"/)?.[1];
    return { id, image: image ? decodeEntities(image) : undefined, title: title ? JSON.parse(`"${title}"`) : undefined, author: author ? `@${author}` : undefined };
  } catch { return { id }; }
}

// Instagram and Facebook report numeric account ids as uploader_id; prefer the readable handle/name.
export const ytCreator = (yt: YtMeta) => yt.uploader_id && !/^\d+$/.test(yt.uploader_id) ? `@${yt.uploader_id}` : yt.uploader ?? yt.channel ?? (yt.uploader_id ? `@${yt.uploader_id}` : undefined);

export type Preview = { image: string; title?: string; creator?: string; description?: string; via: "tiktok-embed" | "yt-dlp" | "og" };

// Cheapest route to a picture for a link, without downloading the video: TikTok embed poster, then yt-dlp's thumbnail
// field, then the page's og:image. Used to backfill items that were inserted already "done" (archive imports).
export async function fetchPreview(url: string): Promise<Preview | null> {
  if (detectSource(url, "link") === "tiktok") {
    const t = await tiktokEmbedInfo(url);
    if (t?.image) return { image: t.image, title: t.title, creator: t.author, via: "tiktok-embed" };
  }
  const yt = await ytMeta(url);
  if (yt?.thumbnail) return { image: yt.thumbnail, title: yt.title, creator: ytCreator(yt), description: yt.description, via: "yt-dlp" };
  const info = await pageInfo(url);
  if (info.image) return { image: info.image, title: info.title, creator: info.author, description: info.description, via: "og" };
  return null;
}
