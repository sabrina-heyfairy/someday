import { sql } from "./db";
import { intake } from "./intake";
import { processQueued } from "./pipeline";

export type Source = { id: string; kind: "pinterest_board" | "reddit_saved"; label: string; config: Record<string, string>; enabled: boolean; created_at: string; last_run_at: string | null; last_status: string | null; last_message: string | null; last_added: number };
type Found = { url: string; savedAt?: Date; note?: string; collection?: string };

const UA = "someday/0.1 (personal bookmark tool; +https://github.com/sabrina-heyfairy/someday)";
const toDate = (v: unknown) => { if (v == null) return undefined; const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v)); return isNaN(d.getTime()) ? undefined : d; };

// ---------- Pinterest: any public board has an RSS feed ----------
export async function fetchPinterestBoard(boardUrl: string): Promise<{ board: string; items: Found[] }> {
  const u = new URL(boardUrl); u.search = ""; u.pathname = u.pathname.replace(/\/$/, "") + ".rss";
  const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/124 Safari/537.36" } });
  if (!r.ok) throw new Error(`Pinterest returned ${r.status} for ${u.pathname}. Is the board public?`);
  const xml = await r.text();
  const board = xml.match(/<channel>[\s\S]*?<title>([^<]*)<\/title>/)?.[1]?.trim() || "Pinterest";
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]).map((it) => ({
    url: it.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? "",
    savedAt: toDate(it.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]),
    note: it.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || undefined,
  })).filter((f) => f.url);
  return { board, items: items.map((i) => ({ ...i, collection: `Pinterest: ${board}` })) };
}

// ---------- Reddit: OAuth app, scopes identity + history ----------
export const redditConfigured = () => Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
const redditBasic = () => "Basic " + Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64");

export function redditAuthorizeUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({ client_id: process.env.REDDIT_CLIENT_ID!, response_type: "code", state, redirect_uri: redirectUri, duration: "permanent", scope: "identity history" });
  return `https://www.reddit.com/api/v1/authorize?${p}`;
}
export async function redditExchangeCode(code: string, redirectUri: string): Promise<{ refresh_token: string; access_token: string }> {
  const r = await fetch("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { Authorization: redditBasic(), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }) });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw new Error(`reddit token exchange failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
async function redditAccessToken(refreshToken: string): Promise<string> {
  const r = await fetch("https://www.reddit.com/api/v1/access_token", { method: "POST", headers: { Authorization: redditBasic(), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }) });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`reddit refresh failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token as string;
}
export async function redditMe(accessToken: string): Promise<string> {
  const r = await fetch("https://oauth.reddit.com/api/v1/me", { headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA } });
  const j = await r.json();
  if (!j.name) throw new Error("reddit: could not read username");
  return j.name as string;
}
export async function fetchRedditSaved(refreshToken: string, username: string, max = 1000): Promise<Found[]> {
  const token = await redditAccessToken(refreshToken);
  const out: Found[] = []; let after: string | null = null;
  while (out.length < max) {
    const p = new URLSearchParams({ limit: "100", raw_json: "1" }); if (after) p.set("after", after);
    const r = await fetch(`https://oauth.reddit.com/user/${encodeURIComponent(username)}/saved?${p}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } });
    if (!r.ok) throw new Error(`reddit saved ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const children = (j?.data?.children ?? []) as { kind: string; data: { permalink?: string; created_utc?: number; title?: string; link_title?: string; subreddit?: string } }[];
    for (const c of children) {
      if (!c.data.permalink) continue;
      out.push({ url: `https://www.reddit.com${c.data.permalink}`, savedAt: toDate(c.data.created_utc), note: c.kind === "t1" ? `saved comment on: ${c.data.link_title ?? ""}` : undefined, collection: "Reddit saved" });
    }
    after = j?.data?.after ?? null;
    if (!after || !children.length) break;
  }
  return out;
}

// ---------- runner ----------
export async function runSource(source: Source, { process = true } = {}): Promise<{ added: number; seen: number }> {
  let items: Found[] = [];
  try {
    if (source.kind === "pinterest_board") items = (await fetchPinterestBoard(source.config.url)).items;
    else if (source.kind === "reddit_saved") items = await fetchRedditSaved(source.config.refresh_token, source.config.username);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`update sources set last_run_at = now(), last_status = 'error', last_message = ${msg.slice(0, 500)}, last_added = 0 where id = ${source.id}`;
    throw e;
  }
  let added = 0;
  const collIds = new Map<string, string>();
  for (const it of items) {
    const r = await intake({ url: it.url, text: it.note ?? null, channel: "import", createdAt: it.savedAt ?? null, meta: { source_id: source.id, source_kind: source.kind } });
    if (!r.duplicate) added++;
    if (it.collection) {
      let cid = collIds.get(it.collection);
      if (!cid) { const [c] = await sql<{ id: string }[]>`insert into collections (name) values (${it.collection}) on conflict (name) do update set name = excluded.name returning id`; cid = c.id; collIds.set(it.collection, cid); }
      await sql`insert into collection_items (collection_id, item_id, added_at) values (${cid}, ${r.id}, ${it.savedAt ?? new Date()}) on conflict do nothing`;
    }
  }
  await sql`update sources set last_run_at = now(), last_status = 'ok', last_message = ${`${items.length} found, ${added} new`}, last_added = ${added} where id = ${source.id}`;
  if (process && added) { for (;;) { const d = await processQueued(5); if (!d.length) break; } }
  return { added, seen: items.length };
}

export async function runAllSources(): Promise<{ id: string; label: string; added?: number; error?: string }[]> {
  const sources = await sql<Source[]>`select * from sources where enabled order by created_at`;
  const results = [];
  for (const s of sources) {
    try { const r = await runSource(s, { process: false }); results.push({ id: s.id, label: s.label, added: r.added }); }
    catch (e) { results.push({ id: s.id, label: s.label, error: e instanceof Error ? e.message : String(e) }); }
  }
  for (;;) { const d = await processQueued(5); if (!d.length) break; }
  return results;
}
