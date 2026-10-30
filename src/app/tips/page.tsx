import Link from "next/link";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { ItemCard } from "../item-card";
import type { Item } from "@/lib/db";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

type ArchiveMeta = {
  version: number;
  title: string;
  count: number;
  categories: string[];
  sources: string[];
  status_counts: Record<string, number>;
};

function loadArchiveMeta(): ArchiveMeta | null {
  const p = join(process.cwd(), "content", "sewing-tips-archive.json");
  if (!existsSync(p)) return null;
  return (JSON.parse(readFileSync(p, "utf8")) as { meta: ArchiveMeta }).meta;
}

export default async function TipsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("/tips");
  const sp = await searchParams;
  const archiveMeta = loadArchiveMeta();

  const items = await sql<Item[]>`
    select * from items
    where archived = false and duplicate_of is null and meta ? 'archive_id'
      ${sp.q?.trim() ? sql`and (search @@ websearch_to_tsquery('english', ${sp.q.trim()}) or title ilike ${"%" + sp.q.trim() + "%"} or raw_text ilike ${"%" + sp.q.trim() + "%"})` : sql``}
      ${sp.category ? sql`and meta->>'archive_category' = ${sp.category}` : sql``}
      ${sp.source ? sql`and coalesce(meta->>'archive_source', source) = ${sp.source}` : sql``}
      ${sp.status ? sql`and meta->>'archive_status' = ${sp.status}` : sql``}
      ${sp.tag ? sql`and ${sp.tag} = any(tags)` : sql``}
    order by title asc`;

  const [cats, srcs, statuses, tags, totalRow] = await Promise.all([
    sql<{ category: string; n: number }[]>`
      select meta->>'archive_category' category, count(*)::int n from items
      where archived = false and duplicate_of is null and meta ? 'archive_id' and meta->>'archive_category' is not null
      group by 1 order by 2 desc`,
    sql<{ source: string; n: number }[]>`
      select coalesce(meta->>'archive_source', source) source, count(*)::int n from items
      where archived = false and duplicate_of is null and meta ? 'archive_id'
      group by 1 order by 2 desc`,
    sql<{ status: string; n: number }[]>`
      select meta->>'archive_status' status, count(*)::int n from items
      where archived = false and duplicate_of is null and meta ? 'archive_id' and meta->>'archive_status' is not null
      group by 1 order by 2 desc`,
    sql<{ tag: string; n: number }[]>`
      select t tag, count(*)::int n from items, unnest(tags) t
      where archived = false and duplicate_of is null and meta ? 'archive_id'
        and t not in ('sewing-tip', 'has-howto', 'link-only', 'note-only')
      group by 1 order by 2 desc limit 24`,
    sql<{ n: number }[]>`select count(*)::int n from items where archived = false and duplicate_of is null and meta ? 'archive_id'`,
  ]);
  const total = totalRow[0]?.n ?? 0;
  const expected = archiveMeta?.count ?? total;

  const link = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/tips?${p}`;
  };

  const statusLabel: Record<string, string> = {
    transcribed: "Has how-to",
    linked: "Link only",
    "note-only": "Note only",
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Sewing tips</h1>
        <p className="text-sm muted">
          {archiveMeta?.title ?? "Sewing tips archive"} — {total} tip{total === 1 ? "" : "s"} in Someday
          {expected !== total ? <span style={{ color: "var(--accent)" }}> · archive expects {expected}</span> : null}
        </p>
      </div>

      <form className="flex gap-2" action="/tips">
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        {sp.source && <input type="hidden" name="source" value={sp.source} />}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search tips, tags, techniques…"
          className="card flex-1 rounded-xl px-4 py-3 text-base outline-none focus:ring-2"
          style={{ "--tw-ring-color": "var(--accent)" } as React.CSSProperties}
        />
        <button className="rounded-xl px-4 font-medium text-white" style={{ background: "var(--accent)" }}>Search</button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        <Link href={link({ category: undefined, source: undefined, status: undefined, tag: undefined, q: sp.q })} className={`chip ${!sp.category && !sp.source && !sp.status && !sp.tag ? "on" : ""}`}>All {total}</Link>
        {cats.map((c) => (
          <Link key={c.category} href={link({ category: sp.category === c.category ? undefined : c.category })} className={`chip ${sp.category === c.category ? "on" : ""}`}>{c.category} {c.n}</Link>
        ))}
        <span className="muted px-1">·</span>
        {srcs.map((s) => (
          <Link key={s.source} href={link({ source: sp.source === s.source ? undefined : s.source })} className={`chip ${sp.source === s.source ? "on" : ""}`}>{s.source} {s.n}</Link>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {statuses.map((s) => (
          <Link key={s.status} href={link({ status: sp.status === s.status ? undefined : s.status })} className={`chip ${sp.status === s.status ? "on" : ""}`}>
            {statusLabel[s.status] ?? s.status} {s.n}
          </Link>
        ))}
        {(sp.category || sp.source || sp.status || sp.tag || sp.q) && (
          <Link href="/tips" className="chip" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>Clear</Link>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {tags.map((t) => (
            <Link key={t.tag} href={link({ tag: sp.tag === t.tag ? undefined : t.tag })} className={`chip ${sp.tag === t.tag ? "on" : ""}`}>#{t.tag}</Link>
          ))}
        </div>
      )}

      <p className="text-xs muted">{items.length} shown{sp.q || sp.category || sp.source || sp.status || sp.tag ? " (filtered)" : ""}</p>

      {total === 0 ? (
        <div className="card rounded-2xl p-10 text-center muted text-sm space-y-2">
          <p>No sewing tips imported yet.</p>
          <p>Run <code>npm run import:tips</code> after migrations to load the archive ({expected} tips).</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card rounded-2xl p-10 text-center muted">No matches. Try fewer words or clear filters.</div>
      ) : (
        <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 space-y-3">
          {items.map((item) => <ItemCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}
