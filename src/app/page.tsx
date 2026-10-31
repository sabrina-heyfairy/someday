import Link from "next/link";
import { facets, searchItems, spend } from "@/lib/search";
import { sql } from "@/lib/db";
import { HAS_AI_CREDS } from "@/lib/ai";
import { BulkGrid } from "./bulk-grid";
import { requireSession } from "@/lib/require-session";
import { createShelfFromTopic } from "./collections/actions";
import { shelfColor } from "@/lib/shelves";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

// Home = Saved. One search box, one row of shelves, everything else behind "Filter".
export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("/");
  const sp = await searchParams;
  const unshelved = sp.shelf === "none";
  const [items, f, ai, collections, topics] = await Promise.all([
    searchItems({ q: sp.q, shelf: unshelved ? undefined : sp.shelf, unshelved, source: sp.source, tag: sp.tag, status: sp.status, action: sp.action, starred: sp.starred === "1" }),
    facets({ shelf: unshelved ? undefined : sp.shelf, unshelved }),
    spend(),
    sql<{ id: string; name: string }[]>`select id, name from collections where is_shelf order by position, name`,
    unshelved ? sql<{ topic: string; n: number }[]>`select coalesce(topic, 'other') topic, count(*)::int n from items i where archived = false and duplicate_of is null
      and not exists (select 1 from collection_items ci join collections c on c.id = ci.collection_id where ci.item_id = i.id and c.is_shelf) group by 1 order by 2 desc` : Promise.resolve([] as { topic: string; n: number }[]),
  ]);
  const total = f.counts.reduce((a, c) => a + c.n, 0);
  const pending = f.counts.filter((c) => c.status !== "done").reduce((a, c) => a + c.n, 0);
  const link = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };
  const current = f.shelves.find((s) => s.id === sp.shelf);

  // Secondary filters that are active right now, shown as removable pills.
  const active: { label: string; clear: SP }[] = [];
  if (sp.source) active.push({ label: `from ${sp.source}`, clear: { source: undefined } });
  if (sp.tag) active.push({ label: `#${sp.tag}`, clear: { tag: undefined } });
  if (sp.status) active.push({ label: sp.status === "queued" ? "still processing" : sp.status, clear: { status: undefined } });
  if (sp.action) active.push({ label: `to ${sp.action}`, clear: { action: undefined } });
  if (sp.starred === "1") active.push({ label: "★ starred", clear: { starred: undefined } });

  return (
    <div className="space-y-4">
      {/* Search always spans every shelf and drawer; the shelf is dropped on submit. Tapping a drawer afterwards narrows the hits. */}
      <form className="flex gap-2" action="/">
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search everything you saved…" className="card flex-1 rounded-xl px-4 py-3 text-base" />
        <button className="btn px-4">Search</button>
      </form>

      {/* Shelves: the one primary filter, drawn as drawer fronts on a plank. */}
      <div>
        <div className="shelf-row">
          <Link href={link({ shelf: undefined })} className={`drawer ${!sp.shelf ? "on" : ""}`} style={{ "--c": "var(--card)" } as React.CSSProperties}><span className="knob" /><span className="label">Everything</span><span className="n">{total}</span></Link>
          {f.shelves.filter((s) => s.n > 0 || s.id === sp.shelf).map((s) => (
            <Link key={s.id} href={link({ shelf: sp.shelf === s.id ? undefined : s.id })} className={`drawer ${sp.shelf === s.id ? "on" : ""}`} style={{ "--c": shelfColor(s.name) } as React.CSSProperties}>
              <span className="knob" /><span className="label">{s.name}</span><span className="n">{s.n}</span>
            </Link>
          ))}
          {f.unshelved > 0 && <Link href={link({ shelf: unshelved ? undefined : "none" })} className={`drawer ghost ${unshelved ? "on" : ""}`}><span className="knob" /><span className="label">Unsorted</span><span className="n">{f.unshelved}</span></Link>}
          <Link href="/collections" className="drawer ghost" title="Add, rename or reorder shelves" style={{ minWidth: 56 }}><span className="knob" /><span className="label">+</span><span className="n muted">new</span></Link>
        </div>
        <div className="plank" />
      </div>

      {/* Everything else lives in the drawer. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <details className="inline-block">
          <summary className="pull">Filters{active.length ? ` · ${active.length}` : ""}</summary>
          <div className="tray space-y-3 w-[min(92vw,640px)]">
            <Row label="Source">
              {f.srcs.map((s) => <Link key={s.source} href={link({ source: sp.source === s.source ? undefined : s.source })} className={`chip ${sp.source === s.source ? "on" : ""}`}>{s.source} {s.n}</Link>)}
            </Row>
            <Row label="Status">
              <Link href={link({ starred: sp.starred === "1" ? undefined : "1" })} className={`chip ${sp.starred === "1" ? "on" : ""}`}>★ starred</Link>
              {pending > 0 && <Link href={link({ status: sp.status === "queued" ? undefined : "queued" })} className={`chip ${sp.status === "queued" ? "on" : ""}`}>still processing {pending}</Link>}
              {(["make", "buy", "learn"] as const).map((a) => <Link key={a} href={link({ action: sp.action === a ? undefined : a })} className={`chip ${sp.action === a ? "on" : ""}`}>to {a}</Link>)}
            </Row>
            {f.tags.length > 0 && (
              <Row label="Tags">
                {f.tags.map((t) => <Link key={t.tag} href={link({ tag: sp.tag === t.tag ? undefined : t.tag })} className={`chip ${sp.tag === t.tag ? "on" : ""}`}>#{t.tag}</Link>)}
                <Link href="/tags" className="chip muted">edit tags…</Link>
              </Row>
            )}
          </div>
        </details>
        {active.map((a) => <Link key={a.label} href={link(a.clear)} className="chip on">{a.label} ×</Link>)}
        {sp.q && <Link href={link({ q: undefined })} className="chip on">“{sp.q}” ×</Link>}
        <span className="muted ml-auto display text-sm italic">{items.length}{items.length === 60 ? "+" : ""} {current ? `on the ${current.name} shelf` : unshelved ? "unsorted" : sp.q ? "found everywhere" : "saved"}</span>
      </div>

      {unshelved && topics.length > 0 && (
        <div className="tray flex flex-wrap items-center gap-2 text-xs">
          <span className="muted">Nothing fits a shelf yet. Make one:</span>
          {topics.map((t) => (
            <form key={t.topic} action={createShelfFromTopic}><input type="hidden" name="topic" value={t.topic} /><button className="chip">{t.topic.charAt(0).toUpperCase() + t.topic.slice(1)} shelf · {t.n}</button></form>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card p-10 text-center muted">
          {total === 0 ? <>Nothing saved yet. Share a link or a screenshot from your phone with the Shortcut, or tap Add.</> : "No matches. Try fewer words or clear a filter."}
        </div>
      ) : (
        <BulkGrid items={items} collections={collections} />
      )}
      <p className="text-[11px] muted text-center pt-4">
        AI spend: ${ai.month.toFixed(2)} this month · ${ai.total.toFixed(2)} all time · {ai.calls} calls{process.env.MOCK_AI === "1" || !HAS_AI_CREDS ? " · mock mode" : ""}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-start">
      <span className="muted w-14 shrink-0 pt-0.5 uppercase tracking-wide text-[10px]">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
