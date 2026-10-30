import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, type Item } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { ItemCard } from "../../item-card";
import { deleteCollection, renameCollection } from "../actions";

export const dynamic = "force-dynamic";

export default async function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireSession(`/collections/${id}`);
  const [c] = await sql<{ id: string; name: string; description: string | null }[]>`select id, name, description from collections where id = ${id}`;
  if (!c) notFound();
  const items = await sql<Item[]>`select i.* from collection_items ci join items i on i.id = ci.item_id where ci.collection_id = ${id} and i.archived = false order by ci.added_at desc`;
  return (
    <div className="space-y-4">
      <div className="text-xs muted"><Link href="/collections" className="underline">Collections</Link> / {c.name}</div>
      <details className="card rounded-2xl p-4">
        <summary className="cursor-pointer"><span className="text-lg font-semibold">{c.name}</span> <span className="muted text-sm">· {items.length} items{c.description ? ` · ${c.description}` : ""} · edit</span></summary>
        <form action={renameCollection} className="mt-3 flex flex-col sm:flex-row gap-2">
          <input type="hidden" name="id" value={id} />
          <input name="name" defaultValue={c.name} className="card rounded-xl px-3 py-1.5 text-sm" required />
          <input name="description" defaultValue={c.description ?? ""} placeholder="Description (optional)" className="card rounded-xl px-3 py-1.5 text-sm flex-1" />
          <button className="chip on">Save</button>
        </form>
        <form action={deleteCollection} className="mt-2"><input type="hidden" name="id" value={id} /><button className="text-xs underline muted">Delete collection (items stay)</button></form>
      </details>
      {items.length === 0 ? <p className="card rounded-2xl p-10 text-center muted text-sm">Empty. Add items from their pages.</p> :
        <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [&>*]:mb-3">{items.map((it) => <ItemCard key={it.id} item={it} />)}</div>}
    </div>
  );
}
