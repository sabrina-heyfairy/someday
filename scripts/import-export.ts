import "./env";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { intake } from "../src/lib/intake";
import { processQueued } from "../src/lib/pipeline";
import { sql } from "../src/lib/db";
import { fetchPinterestBoard } from "../src/lib/sources";

/*
  Import everything you already saved inside each app.

    npm run import -- ~/Downloads/instagram-export        # folder or zip-extracted folder from any platform
    npm run import -- ~/Downloads/user_data_tiktok.json
    npm run import -- --board https://www.pinterest.com/you/summer-linen/   # a public Pinterest board
    npm run import -- <path> --dry-run                    # count only
    npm run import -- <path> --process                    # also run the AI afterwards
    npm run import -- <path> --include-likes              # TikTok: liked videos too, not just favorites

  Recognised: Instagram "Download your information" (JSON or HTML), TikTok data export (JSON or TXT),
  Reddit data export (saved_posts.csv, saved_comments.csv), Facebook export (saved_items JSON), Pinterest export,
  and as a fallback any file containing links to those platforms. Instagram collections and Pinterest boards
  become Someday collections. Original save dates are kept.
*/

type Found = { url: string; savedAt?: Date; collection?: string; platform: string; note?: string };
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--board");

const URL_RE = /https?:\/\/(?:www\.|m\.|old\.|vm\.|vt\.)?(?:instagram\.com\/(?:p|reel|reels|tv)\/[\w-]+|tiktok\.com\/[^\s"'<>]+|reddit\.com\/r\/[^\s"'<>]+\/comments\/[^\s"'<>]+|redd\.it\/\w+|pinterest\.[a-z.]+\/pin\/\d+|pin\.it\/\w+|facebook\.com\/[^\s"'<>]+|fb\.watch\/[^\s"'<>]+|youtube\.com\/(?:watch\?v=|shorts\/)[\w-]+|youtu\.be\/[\w-]+)/gi;

const toDate = (v: unknown): Date | undefined => {
  if (v == null) return undefined;
  if (typeof v === "number") return new Date(v < 1e12 ? v * 1000 : v);
  if (typeof v === "string") { const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; }
  return undefined;
};
const unescapeIg = (s: string) => { try { return decodeURIComponent(escape(s)); } catch { return s; } }; // IG exports mojibake UTF-8 as latin-1

function* walkFiles(p: string): Generator<string> {
  const st = statSync(p);
  if (st.isFile()) { yield p; return; }
  for (const f of readdirSync(p)) {
    if (f.startsWith(".") || f === "node_modules") continue;
    const full = join(p, f);
    if (statSync(full).isDirectory()) yield* walkFiles(full); else yield full;
  }
}

// ---------- Instagram ----------
// saved_posts.json: { saved_saved_media: [{ title: "<creator>", string_map_data: { "Saved on": { href, timestamp } } }] }
// saved_collections.json: { saved_saved_collections: [{ title: "<creator>", string_map_data: { Name: { value }, "Added to collection": { href, timestamp } } }] }
function parseInstagram(json: unknown): Found[] {
  const out: Found[] = [];
  const lists = [(json as Record<string, unknown>)?.saved_saved_media, (json as Record<string, unknown>)?.saved_saved_collections].filter(Array.isArray) as Record<string, unknown>[][];
  for (const list of lists) {
    let currentCollection: string | undefined;
    for (const entry of list) {
      const smd = (entry.string_map_data ?? {}) as Record<string, { href?: string; value?: string; timestamp?: number }>;
      if (smd.Name?.value) currentCollection = unescapeIg(smd.Name.value);
      const slot = smd["Saved on"] ?? smd["Added to collection"] ?? Object.values(smd).find((v) => v?.href);
      if (slot?.href) out.push({ url: slot.href, savedAt: toDate(slot.timestamp), collection: currentCollection, platform: "instagram", note: typeof entry.title === "string" && entry.title ? `saved from @${unescapeIg(entry.title)}` : undefined });
    }
  }
  return out;
}

// ---------- TikTok ----------
function parseTikTok(json: unknown, includeLikes: boolean): Found[] {
  const out: Found[] = [];
  const root = json as Record<string, Record<string, Record<string, unknown>>>;
  const act = root?.Activity ?? root;
  const favs = (act?.["Favorite Videos"]?.FavoriteVideoList ?? []) as { Date?: string; Link?: string; date?: string; link?: string }[];
  for (const f of favs) if (f.Link ?? f.link) out.push({ url: (f.Link ?? f.link)!, savedAt: toDate(f.Date ?? f.date), platform: "tiktok", collection: "TikTok favorites" });
  if (includeLikes) {
    const likes = (act?.["Like List"]?.ItemFavoriteList ?? []) as { date?: string; link?: string; Date?: string; Link?: string }[];
    for (const f of likes) if (f.link ?? f.Link) out.push({ url: (f.link ?? f.Link)!, savedAt: toDate(f.date ?? f.Date), platform: "tiktok", collection: "TikTok likes" });
  }
  return out;
}

// ---------- Reddit ----------
function parseRedditCsv(text: string, kind: "posts" | "comments"): Found[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift()?.split(",") ?? [];
  const pi = header.indexOf("permalink");
  if (pi < 0) return [];
  return lines.map((l) => l.split(",")[pi]?.trim()).filter((u): u is string => !!u && /reddit\.com|redd\.it/.test(u))
    .map((u) => ({ url: u.startsWith("http") ? u : `https://www.reddit.com${u}`, platform: "reddit", collection: kind === "comments" ? "Reddit saved comments" : undefined }));
}

// ---------- Facebook ----------
function parseFacebook(json: unknown): Found[] {
  const out: Found[] = [];
  const saves = ((json as Record<string, unknown>)?.saves_v2 ?? (json as Record<string, unknown>)?.saves ?? []) as Record<string, unknown>[];
  for (const s of saves) {
    const ts = toDate(s.timestamp);
    const title = typeof s.title === "string" ? unescapeIg(s.title) : undefined;
    const atts = (s.attachments ?? []) as { data?: { external_context?: { url?: string }; media?: { uri?: string } }[] }[];
    let got = false;
    for (const a of atts) for (const d of a.data ?? []) { const u = d.external_context?.url; if (u) { out.push({ url: u, savedAt: ts, platform: "facebook", note: title }); got = true; } }
    if (!got) { const m = JSON.stringify(s).match(URL_RE); if (m) out.push({ url: m[0], savedAt: ts, platform: "facebook", note: title }); }
  }
  return out;
}

// ---------- Pinterest board RSS (shared with the scheduled sync) ----------
async function parsePinterestBoard(boardUrl: string): Promise<Found[]> {
  const { items } = await fetchPinterestBoard(boardUrl);
  return items.map((i) => ({ url: i.url, savedAt: i.savedAt, note: i.note, collection: i.collection, platform: "pinterest" }));
}

// ---------- generic fallback: any link to a known platform in any text file ----------
function harvest(text: string): Found[] {
  const seen = new Set<string>(); const out: Found[] = [];
  for (const m of text.matchAll(URL_RE)) { const url = m[0].replace(/[),.;]+$/, ""); if (!seen.has(url)) { seen.add(url); out.push({ url, platform: "generic" }); } }
  return out;
}

async function collect(path: string): Promise<Found[]> {
  const found: Found[] = [];
  const includeLikes = flag("--include-likes");
  for (const f of walkFiles(path)) {
    const ext = extname(f).toLowerCase(), name = basename(f).toLowerCase();
    if (statSync(f).size > 200 * 1024 * 1024) continue;
    if (![".json", ".csv", ".txt", ".html", ".htm"].includes(ext)) continue;
    const text = readFileSync(f, "utf8");
    let parsed: Found[] = [];
    if (ext === ".json") {
      let json: unknown; try { json = JSON.parse(text); } catch { json = null; }
      if (json) {
        if (/saved_posts|saved_collections/.test(name) || (json as Record<string, unknown>).saved_saved_media || (json as Record<string, unknown>).saved_saved_collections) parsed = parseInstagram(json);
        else if (/tiktok/.test(name) || (json as Record<string, unknown>).Activity) parsed = parseTikTok(json, includeLikes);
        else if (/saved_items|saves/.test(name) || (json as Record<string, unknown>).saves_v2) parsed = parseFacebook(json);
      }
    } else if (ext === ".csv" && /saved_posts/.test(name)) parsed = parseRedditCsv(text, "posts");
    else if (ext === ".csv" && /saved_comments/.test(name)) parsed = parseRedditCsv(text, "comments");
    if (!parsed.length) parsed = harvest(text).map((x) => ({ ...x, note: `from ${basename(f)}` }));
    found.push(...parsed);
  }
  return found;
}

async function main() {
  const board = opt("--board");
  if (!target && !board) { console.error("usage: npm run import -- <export folder or file> [--dry-run] [--process] [--include-likes]  |  --board <pinterest board url>"); process.exit(1); }
  const found = board ? await parsePinterestBoard(board) : await collect(target!);
  if (target && !existsSync(target)) { console.error(`not found: ${target}`); process.exit(1); }

  // de-dupe within the export, keep the earliest save date and any collection
  const byUrl = new Map<string, Found>();
  for (const f of found) { const k = f.url.replace(/\/+$/, ""); const prev = byUrl.get(k); if (!prev) byUrl.set(k, f); else { if (f.savedAt && (!prev.savedAt || f.savedAt < prev.savedAt)) prev.savedAt = f.savedAt; prev.collection ??= f.collection; } }
  const list = [...byUrl.values()];
  const byPlatform = list.reduce<Record<string, number>>((a, f) => { a[f.platform] = (a[f.platform] ?? 0) + 1; return a; }, {});
  const collections = new Set(list.map((f) => f.collection).filter(Boolean));
  console.log(`found ${list.length} links: ${Object.entries(byPlatform).map(([k, v]) => `${k} ${v}`).join(", ")}${collections.size ? ` · ${collections.size} collections (${[...collections].slice(0, 5).join(", ")}${collections.size > 5 ? ", …" : ""})` : ""}`);
  if (flag("--dry-run") || !list.length) { await sql.end(); return; }

  const collIds = new Map<string, string>();
  for (const name of collections as Set<string>) {
    const [c] = await sql<{ id: string }[]>`insert into collections (name) values (${name}) on conflict (name) do update set name = excluded.name returning id`;
    collIds.set(name, c.id);
  }
  let added = 0, dups = 0;
  for (const f of list) {
    const r = await intake({ url: f.url, text: f.note ?? null, channel: "import", createdAt: f.savedAt ?? null, meta: { import_platform: f.platform, import_collection: f.collection ?? null } });
    r.duplicate ? dups++ : added++;
    if (f.collection) await sql`insert into collection_items (collection_id, item_id, added_at) values (${collIds.get(f.collection)!}, ${r.id}, ${f.savedAt ?? new Date()}) on conflict do nothing`;
    process.stdout.write(`\r${added} queued, ${dups} already saved`);
  }
  console.log();
  if (flag("--process")) {
    let total = 0;
    for (;;) { const d = await processQueued(5); if (!d.length) break; total += d.length; process.stdout.write(`\rprocessed ${total}`); }
    console.log("\ndone");
  } else console.log(`queued only. Run \`npm run worker\` or \`POST /api/process\` to process, or re-run with --process.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
