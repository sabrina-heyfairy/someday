import Link from "next/link";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { createCollection, deleteCollection, updateShelf } from "./actions";
import { shelfColor } from "@/lib/shelves";

export const dynamic = "force-dynamic";

type Row = { id: string; name: string; description: string | null; position: number; is_shelf: boolean; n: number; thumbs: string[] };

// Shelves are your own buckets. The home page shows them as tabs; this page is where you add, rename and reorder them.
export default async function ShelvesPage() {
  await requireSession("/collections");
  const rows = await sql<Row[]>`
    select c.id, c.name, c.description, c.position, c.is_shelf, count(ci.item_id)::int n,
      coalesce((select array_agg(i.media->>'thumbnail' order by ci2.added_at desc) from (select * from collection_items where collection_id = c.id order by added_at desc limit 4) ci2 join items i on i.id = ci2.item_id where i.media->>'thumbnail' is not null), '{}') thumbs
    from collections c left join collection_items ci on ci.collection_id = c.id
    group by c.id order by c.is_shelf desc, c.position, c.name`;
  const shelves = rows.filter((r) => r.is_shelf), other = rows.filter((r) => !r.is_shelf);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold">Shelves</h1>
          <p className="text-xs muted">Your own buckets. A save can sit on more than one. New saves get a suggested shelf you can change on the item.</p>
        </div>
        <form action={createCollection} className="flex gap-2">
          <input name="name" placeholder="New shelf, e.g. Quilting" className="card rounded-xl px-3 py-1.5 text-sm" required />
          <button className="btn px-3 py-1.5 text-sm">Add shelf</button>
        </form>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shelves.map((c) => <ShelfCard key={c.id} c={c} />)}
      </div>
      {other.length > 0 && (
        <details>
          <summary className="text-xs uppercase tracking-wide muted cursor-pointer">Hidden collections · {other.length}</summary>
          <p className="text-xs muted mt-1 mb-2">Groupings that are not shown as shelves on the home page.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{other.map((c) => <ShelfCard key={c.id} c={c} />)}</div>
        </details>
      )}
    </div>
  );
}

function ShelfCard({ c }: { c: Row }) {
  return (
    <div className="card overflow-hidden">
      <Link href={`/?shelf=${c.id}`} className="block hover:opacity-90">
        <div className="grid grid-cols-2 aspect-[4/3] relative" style={{ background: c.thumbs.length ? "var(--line)" : c.is_shelf ? shelfColor(c.name) : "var(--line)", borderBottom: "2px solid var(--ink)" }}>
          {c.thumbs.length === 0 && <span className="absolute left-1/2 top-3 -translate-x-1/2 w-3 h-3 rounded-full border-2" style={{ background: "#e6b422", borderColor: "var(--ink)" }} />}
          {c.thumbs.slice(0, 4).map((t) => <img key={t} src={`/api/media/${t}`} alt="" className="w-full h-full object-cover" />)}
        </div>
        <div className="p-3 pb-1">
          <div className="display font-bold text-base flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ background: c.is_shelf ? shelfColor(c.name) : "var(--line)", borderColor: "var(--ink)" }} />{c.name}</div>
          <div className="text-xs muted">{c.n} {c.n === 1 ? "item" : "items"}{c.description ? ` · ${c.description}` : ""}</div>
        </div>
      </Link>
      <details className="px-3 pb-3">
        <summary className="text-[11px] muted cursor-pointer">edit</summary>
        <form action={updateShelf} className="mt-2 space-y-1.5 text-xs">
          <input type="hidden" name="id" value={c.id} />
          <input name="name" defaultValue={c.name} className="card w-full rounded-lg px-2 py-1" required />
          <input name="description" defaultValue={c.description ?? ""} placeholder="Description (optional)" className="card w-full rounded-lg px-2 py-1" />
          <div className="flex items-center gap-2">
            <label className="muted">order</label>
            <input name="position" type="number" defaultValue={c.position} className="card w-16 rounded-lg px-2 py-1" />
            <label className="flex items-center gap-1 muted"><input type="checkbox" name="is_shelf" defaultChecked={c.is_shelf} /> show as shelf</label>
            <button className="chip on ml-auto">Save</button>
          </div>
        </form>
        <form action={deleteCollection} className="mt-1"><input type="hidden" name="id" value={c.id} /><button className="text-[11px] underline muted">Delete shelf (items stay)</button></form>
      </details>
    </div>
  );
}
