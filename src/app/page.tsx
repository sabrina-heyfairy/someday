import Link from "next/link";
import { facets, searchItems, spend } from "@/lib/search";
import { HAS_AI_CREDS } from "@/lib/ai";
import { ItemCard } from "./item-card";

import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  await requireSession("/");
  const sp = await searchParams;
  const [items, f, ai] = await Promise.all([
    searchItems({ q: sp.q, category: sp.category, source: sp.source, tag: sp.tag, status: sp.status, action: sp.action }),
    facets(),
    spend(),
  ]);
  const total = f.counts.reduce((a, c) => a + c.n, 0);
  const pending = f.counts.filter((c) => c.status !== "done").reduce((a, c) => a + c.n, 0);
  const link = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/?${p}`;
  };

  return (
    <div className="space-y-4">
      <form className="flex gap-2" action="/">
        {sp.category && <input type="hidden" name="category" value={sp.category} />}
        {sp.source && <input type="hidden" name="source" value={sp.source} />}
        <input name="q" defaultValue={sp.q ?? ""} placeholder="Search everything you saved… (e.g. wide leg linen pants, bias binding)" className="card flex-1 rounded-xl px-4 py-3 text-base outline-none focus:ring-2" style={{ "--tw-ring-color": "var(--accent)" } as React.CSSProperties} />
        <button className="rounded-xl px-4 font-medium text-white" style={{ background: "var(--accent)" }}>Search</button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        <Link href={link({ category: undefined, source: undefined, tag: undefined, status: undefined })} className={`chip ${!sp.category && !sp.source && !sp.tag && !sp.status ? "on" : ""}`}>All {total}</Link>
        {f.cats.map((c) => <Link key={c.category} href={link({ category: sp.category === c.category ? undefined : c.category })} className={`chip ${sp.category === c.category ? "on" : ""}`}>{c.category} {c.n}</Link>)}
        <span className="muted px-1">·</span>
        {f.srcs.map((s) => <Link key={s.source} href={link({ source: sp.source === s.source ? undefined : s.source })} className={`chip ${sp.source === s.source ? "on" : ""}`}>{s.source} {s.n}</Link>)}
        {pending > 0 && <Link href={link({ status: "queued" })} className="chip" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>processing {pending}</Link>}
      </div>

      {f.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {f.tags.map((t) => <Link key={t.tag} href={link({ tag: sp.tag === t.tag ? undefined : t.tag })} className={`chip ${sp.tag === t.tag ? "on" : ""}`}>#{t.tag}</Link>)}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card rounded-2xl p-10 text-center muted">
          {total === 0 ? <>Nothing saved yet. Share a link to <code>/api/capture</code> or run <code>npm run ingest:folder ~/Desktop/screenshots</code>.</> : "No matches. Try fewer words."}
        </div>
      ) : (
        <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [&>*]:mb-3">
          {items.map((it) => <ItemCard key={it.id} item={it} />)}
        </div>
      )}
      <p className="text-[11px] muted text-center pt-4">
        AI spend: ${ai.month.toFixed(2)} this month · ${ai.total.toFixed(2)} all time · {ai.calls} calls{process.env.MOCK_AI === "1" || !HAS_AI_CREDS ? " · mock mode" : ""}
      </p>
    </div>
  );
}
