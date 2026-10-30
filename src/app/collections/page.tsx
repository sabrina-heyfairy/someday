import Link from "next/link";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { createCollection } from "./actions";

export const dynamic = "force-dynamic";

type Row = { id: string; name: string; description: string | null; n: number; thumbs: string[] };

export default async function CollectionsPage() {
  await requireSession("/collections");
  const rows = await sql<Row[]>`
    select c.id, c.name, c.description, count(ci.item_id)::int n,
      coalesce((select array_agg(i.media->>'thumbnail' order by ci2.added_at desc) from (select * from collection_items where collection_id = c.id order by added_at desc limit 4) ci2 join items i on i.id = ci2.item_id where i.media->>'thumbnail' is not null), '{}') thumbs
    from collections c left join collection_items ci on ci.collection_id = c.id
    group by c.id order by c.created_at desc`;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold">Collections</h1>
        <form action={createCollection} className="flex gap-2">
          <input name="name" placeholder="New collection, e.g. summer linen" className="card rounded-xl px-3 py-1.5 text-sm" required />
          <button className="chip on">Create</button>
        </form>
      </div>
      {rows.length === 0 && <p className="card rounded-2xl p-10 text-center muted text-sm">No collections yet. Make one here, or from any item’s page.</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map((c) => (
          <Link key={c.id} href={`/collections/${c.id}`} className="card rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
            <div className="grid grid-cols-2 aspect-[4/3]" style={{ background: "var(--line)" }}>
              {c.thumbs.slice(0, 4).map((t) => <img key={t} src={`/api/media/${t}`} alt="" className="w-full h-full object-cover" />)}
            </div>
            <div className="p-3">
              <div className="font-medium text-sm">{c.name}</div>
              <div className="text-xs muted">{c.n} {c.n === 1 ? "item" : "items"}{c.description ? ` · ${c.description}` : ""}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
