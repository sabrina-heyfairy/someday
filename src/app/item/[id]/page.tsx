import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, type Item } from "@/lib/db";
import { ItemCard } from "../../item-card";
import { reprocess, saveNotes, toggleStar, archive } from "./actions";
import { setStage } from "../../make/actions";
import { STAGES } from "@/lib/stages";
import { createCollection, toggleMembership } from "../../collections/actions";
import { updateFacets } from "../../bulk-actions";
import { ACTIONS, CATEGORIES } from "@/lib/db";

import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession(`/item/${id}`);
  const [item] = await sql<Item[]>`select * from items where id = ${id}`;
  if (!item) notFound();
  const similar = await sql<Item[]>`
    select * from items where id <> ${id} and archived = false and status = 'done'
      and (tags && ${item.tags} or garments && ${item.garments} or techniques && ${item.techniques})
    order by (select count(*) from unnest(tags) t where t = any(${item.tags})) desc, created_at desc limit 8`;
  const dups = await sql<Item[]>`select * from items where duplicate_of = ${id} order by created_at`;
  const collections = await sql<{ id: string; name: string; member: boolean }[]>`
    select c.id, c.name, exists(select 1 from collection_items ci where ci.collection_id = c.id and ci.item_id = ${id}) member
    from collections c where c.is_shelf or exists(select 1 from collection_items ci where ci.collection_id = c.id and ci.item_id = ${id}) order by member desc, c.position, c.name`;
  const m = (p?: string) => (p ? `/api/media/${p}` : null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        {item.media.video ? <video src={m(item.media.video)!} poster={m(item.media.thumbnail) ?? undefined} controls className="w-full rounded-2xl card" /> :
          m(item.media.thumbnail) ? <img src={m(item.media.thumbnail)!} alt="" className="w-full rounded-2xl card" /> : null}
        {item.media.frames && item.media.frames.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto">{item.media.frames.map((f) => <img key={f} src={m(f)!} alt="" className="h-16 rounded-md" />)}</div>
        )}
        {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="block text-sm underline break-all" style={{ color: "var(--accent)" }}>Open original on {item.source} ↗</a>}
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="text-xs muted">
              {String(item.meta?.archive_source ?? item.source)} · {String(item.topic ?? item.meta?.archive_category ?? item.category ?? "")} · {item.action ?? ""}
              {item.creator && <>· by {item.creator}</>}
              {typeof item.meta?.archive_status === "string" && <> · archive: {item.meta.archive_status}</>}
            </div>
            <h1 className="text-xl font-semibold leading-tight mt-1">{item.title ?? "Untitled"}</h1>
            {typeof item.meta?.archive_id === "string" && (
              <p className="text-xs muted mt-1">From <Link href="/tips" className="underline" style={{ color: "var(--accent)" }}>Sewing tips archive</Link></p>
            )}
          </div>
          <form action={toggleStar}><input type="hidden" name="id" value={id} /><button className="text-xl" title="Star">{item.starred ? "★" : "☆"}</button></form>
        </div>
        {item.summary && <p className="text-[15px]">{item.summary}</p>}
        {item.status !== "done" && (
          <div className="card rounded-xl p-3 text-sm">
            Status: <b>{item.status}</b>{item.error && <div className="mt-1 text-xs break-all" style={{ color: "var(--accent)" }}>{item.error}</div>}
            <form action={reprocess} className="mt-2"><input type="hidden" name="id" value={id} /><button className="chip">Retry now</button></form>
          </div>
        )}

        <Block label="Projects">
          <div className="flex flex-wrap gap-1">
            {STAGES.map((s) => (
              <form key={s.key} action={setStage}>
                <input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value={s.key} />
                <button className={`chip ${(item.stage ?? (item.action === "make" ? "want" : null)) === s.key ? "on" : ""}`}>{s.label}</button>
              </form>
            ))}
            {item.stage && <form action={setStage}><input type="hidden" name="id" value={id} /><input type="hidden" name="stage" value="" /><button className="chip muted">remove</button></form>}
          </div>
        </Block>

        <Block label="Shelves">
          <div className="flex flex-wrap gap-1 items-center">
            {collections.map((c) => (
              <form key={c.id} action={toggleMembership}>
                <input type="hidden" name="collection_id" value={c.id} /><input type="hidden" name="item_id" value={id} /><input type="hidden" name="on" value={c.member ? "0" : "1"} />
                <button className={`chip ${c.member ? "on" : ""}`}>{c.member ? "✓ " : "+ "}{c.name}</button>
              </form>
            ))}
            <form action={createCollection} className="flex gap-1">
              <input type="hidden" name="item_id" value={id} />
              <input name="name" placeholder="New shelf…" className="card rounded-full px-3 py-0.5 text-xs w-36" />
              <button className="chip">Add</button>
            </form>
          </div>
        </Block>

        <details>
          <summary className="text-xs uppercase tracking-wide muted cursor-pointer">Tags <span className="normal-case">· {item.tags.length ? item.tags.join(", ") : "none"} · edit</span></summary>
          <form action={updateFacets} className="mt-2 space-y-2">
            <input type="hidden" name="id" value={id} />
            <input name="tags" defaultValue={item.tags.join(", ")} placeholder="comma, separated, tags" className="card w-full rounded-xl px-3 py-1.5 text-sm" />
            <div className="flex flex-wrap gap-2 text-sm">
              <select name="category" defaultValue={item.category ?? ""} className="card rounded-xl px-2 py-1"><option value="">category…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              <select name="action" defaultValue={item.action ?? ""} className="card rounded-xl px-2 py-1"><option value="">action…</option>{ACTIONS.map((a) => <option key={a}>{a}</option>)}</select>
              <button className="chip on">Save</button>
            </div>
          </form>
          <div className="flex flex-wrap gap-1 mt-2">{item.tags.map((t) => <Link key={t} href={`/?tag=${encodeURIComponent(t)}`} className="chip">{t}</Link>)}</div>
        </details>
        <Facts label="Garments" items={item.garments} />
        <Facts label="Techniques" items={item.techniques} />
        <Facts label="Fabrics" items={item.fabrics} />
        <Facts label="Colors" items={item.colors} />
        {item.patterns.length > 0 && <Block label="Patterns"><ul className="text-sm list-disc pl-5">{item.patterns.map((p, i) => <li key={i}>{[p.brand, p.name, p.number].filter(Boolean).join(" ")}</li>)}</ul></Block>}
        {item.products.length > 0 && <Block label="Products"><ul className="text-sm list-disc pl-5">{item.products.map((p, i) => <li key={i}>{[p.brand, p.name, p.price].filter(Boolean).join(" · ")} {p.url && <a href={p.url} className="underline" target="_blank" rel="noreferrer">link</a>}</li>)}</ul></Block>}
        {item.steps.length > 0 && <Block label="Steps"><ol className="text-sm list-decimal pl-5 space-y-1">{item.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></Block>}

        <form action={saveNotes} className="space-y-1">
          <input type="hidden" name="id" value={id} />
          <label className="text-xs uppercase tracking-wide muted">My notes</label>
          <textarea name="notes" defaultValue={item.notes ?? ""} rows={2} className="card w-full rounded-xl p-2 text-sm" placeholder="Why did I save this? Size, fabric I have, etc." />
          <button className="chip">Save notes</button>
        </form>

        {item.raw_text && <Block label="Shared text / caption"><p className="text-sm whitespace-pre-wrap muted">{item.raw_text}</p></Block>}
        {item.ocr_text && <Block label="On-screen text"><p className="text-sm whitespace-pre-wrap muted">{item.ocr_text}</p></Block>}
        {item.transcript && <details><summary className="text-xs uppercase tracking-wide muted cursor-pointer">Transcript</summary><p className="text-sm whitespace-pre-wrap mt-2 muted">{item.transcript}</p></details>}

        {dups.length > 0 && (
          <Block label={`Saved ${dups.length + 1} times`}>
            <div className="flex gap-1.5 overflow-x-auto">{dups.map((d) => d.media.original && <img key={d.id} src={m(d.media.original)!} alt="" className="h-16 rounded-md" title={`${d.channel} · ${new Date(d.created_at).toLocaleDateString()}`} />)}</div>
          </Block>
        )}

        <div className="flex gap-3 text-xs muted pt-2">
          <span>saved {new Date(item.created_at).toLocaleString()}</span>
          <form action={reprocess}><input type="hidden" name="id" value={id} /><button className="underline">re-run AI</button></form>
          <form action={archive}><input type="hidden" name="id" value={id} /><button className="underline">archive</button></form>
          <Link href="/" className="ml-auto underline">← back</Link>
        </div>
      </div>

      {similar.length > 0 && (
        <div className="lg:col-span-2 pt-4">
          <h2 className="text-sm uppercase tracking-wide muted mb-2">Similar saves</h2>
          <div className="columns-2 sm:columns-4 gap-3 [&>*]:mb-3">{similar.map((s) => <ItemCard key={s.id} item={s} />)}</div>
        </div>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs uppercase tracking-wide muted mb-1">{label}</div>{children}</div>;
}
function Facts({ label, items, q }: { label: string; items: string[]; q?: string }) {
  if (!items?.length) return null;
  return <Block label={label}><div className="flex flex-wrap gap-1">{items.map((t) => q ? <Link key={t} href={`/?${q}=${encodeURIComponent(t)}`} className="chip">{t}</Link> : <span key={t} className="chip">{t}</span>)}</div></Block>;
}
