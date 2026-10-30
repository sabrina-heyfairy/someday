import "./env";
import postgres from "postgres";
import { pickShelf } from "../src/lib/shelves";

/*
  Put every item that is not on a shelf yet onto its suggested shelf.
  Idempotent; runs at boot after the archive import so newly imported tips get placed too.
  Never moves an item that is already on a shelf, so hand placements stick.
*/
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: /supabase\.(co|com)/.test(process.env.DATABASE_URL ?? "") ? "require" : undefined });

type Row = { id: string; category: string | null; topic: string | null; action: string | null; archive_category: string | null; garments: string[]; title: string | null; tags: string[] };

async function main() {
  // The bulk-import collection marks provenance; it is not a shelf.
  await sql`update collections set is_shelf = false where name = 'Sewing tips archive' and is_shelf`;
  const shelves = new Map((await sql<{ id: string; name: string }[]>`select id, name from collections where is_shelf`).map((s) => [s.name, s.id]));
  const rows = await sql<Row[]>`
    select i.id, i.category, i.topic, i.action, i.meta->>'archive_category' archive_category, i.garments, i.title, i.tags from items i
    where i.archived = false and i.duplicate_of is null
      and not exists (select 1 from collection_items ci join collections c on c.id = ci.collection_id where ci.item_id = i.id and c.is_shelf)`;
  const tally: Record<string, number> = {};
  for (const r of rows) {
    const name = pickShelf({ topic: r.topic, category: r.category, action: r.action, archiveCategory: r.archive_category, garments: r.garments, title: r.title, tags: r.tags }, [...shelves.keys()]);
    const cid = name ? shelves.get(name) : undefined;
    if (!cid) { tally["(unsorted)"] = (tally["(unsorted)"] ?? 0) + 1; continue; }
    await sql`insert into collection_items (collection_id, item_id) values (${cid}, ${r.id}) on conflict do nothing`;
    tally[name!] = (tally[name!] ?? 0) + 1;
  }
  console.log(`shelve: ${rows.length} unplaced item(s)`, tally);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
