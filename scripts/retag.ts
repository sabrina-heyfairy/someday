import "./env";
import { existsSync } from "node:fs";
import { extract } from "../src/lib/ai";
import { sql, type Item } from "../src/lib/db";
import { STANDARD_TAGS } from "../src/lib/extraction";
import { pickShelf } from "../src/lib/shelves";
import { ensureLocal } from "../src/lib/storage";

/*
  Re-run the AI over items that were inserted "done" without it (the sewing tips archive), so they get
  the current tag vocabulary, a topic, and the other extracted fields. Uses the cheap bulk tier and
  whatever is already on disk (no media is fetched). Hand placements and her own titles are kept.

    npm run retag                   # every archive item not yet re-tagged
    npm run retag -- --limit 5      # a few, to check the output
    npm run retag -- --dry-run      # list what would run
    npm run retag -- --force        # include items already re-tagged
    npm run retag -- --concurrency 3

  Marks each item with meta.retagged_at; the archive importer leaves AI fields alone once that is set.
*/

const KEEP = new Set(["sewing-tip", "has-howto", "note-only", "link-only"]); // housekeeping tags the Tips page relies on
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");
const LIMIT = Number(arg("--limit") ?? 0) || null;
const CONCURRENCY = Math.max(1, Number(arg("--concurrency") ?? 3) || 3);

async function retag(item: Item, shelfNames: string[]) {
  const images: string[] = [];
  if (item.media?.thumbnail) {
    const abs = await ensureLocal(item.media.thumbnail).catch(() => null);
    if (abs && existsSync(abs)) images.push(abs);
  }
  const page = (item.meta?.page ?? null) as { title?: string; description?: string; author?: string } | null;
  const ex = await extract({
    itemId: item.id, tier: "bulk", url: item.url, source: item.source,
    rawText: item.raw_text, pageText: page?.description ?? null,
    imagePaths: images, metaTitle: item.title, metaCreator: item.creator ?? page?.author ?? null, shelves: shelfNames,
  });
  const tags = Array.from(new Set([...ex.tags, ...item.tags.filter((t) => KEEP.has(t))]));
  const union = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));
  const meta = { retagged_at: new Date().toISOString(), archive_tags: item.meta?.archive_tags ?? item.tags };
  await sql`update items set
    topic = ${ex.topic}, category = ${ex.category}, action = ${ex.action}, tags = ${tags},
    garments = ${union(item.garments, ex.garments)}, techniques = ${union(item.techniques, ex.techniques)},
    fabrics = ${union(item.fabrics, ex.fabrics)}, colors = ${union(item.colors, ex.colors)},
    patterns = ${sql.json(ex.patterns as never)}, products = ${sql.json(ex.products as never)},
    summary = coalesce(summary, ${ex.summary}), creator = coalesce(creator, ${ex.creator}),
    ocr_text = coalesce(ocr_text, ${ex.ocr_text}),
    meta = meta || ${sql.json(meta as never)}
    where id = ${item.id}`;
  // Shelf only when the item is on none, same rule as the live pipeline.
  const shelf = pickShelf({ shelf: ex.shelf, topic: ex.topic, category: ex.category, action: ex.action, garments: ex.garments, title: ex.title, tags: ex.tags }, shelfNames);
  if (shelf) await sql`insert into collection_items (collection_id, item_id) select c.id, ${item.id}::uuid from collections c where c.name = ${shelf} and c.is_shelf
    and not exists (select 1 from collection_items ci join collections c2 on c2.id = ci.collection_id where ci.item_id = ${item.id} and c2.is_shelf) on conflict do nothing`;
  return tags;
}

async function main() {
  const items = await sql<Item[]>`
    select * from items
    where meta ? 'archive_id' and archived = false and duplicate_of is null
      ${FORCE ? sql`` : sql`and meta->>'retagged_at' is null`}
    order by created_at
    ${LIMIT ? sql`limit ${LIMIT}` : sql``}`;
  const shelfNames = (await sql<{ name: string }[]>`select name from collections where is_shelf order by position, name`).map((r) => r.name);
  console.log(`retag: ${items.length} item(s)${DRY ? " (dry run)" : ""}, concurrency ${CONCURRENCY}`);
  if (DRY) { for (const it of items) console.log(` - ${it.title}`); await sql.end(); return; }

  let done = 0, failed = 0;
  const standard = new Map<string, number>();
  const queue = [...items];
  const worker = async () => {
    for (let it = queue.shift(); it; it = queue.shift()) {
      try {
        const tags = await retag(it, shelfNames);
        for (const t of tags) if ((STANDARD_TAGS as readonly string[]).includes(t)) standard.set(t, (standard.get(t) ?? 0) + 1);
        done++;
        console.log(`[${done + failed}/${items.length}] ${it.title} -> ${tags.join(", ")}`);
      } catch (e) {
        failed++;
        console.error(`[${done + failed}/${items.length}] FAILED ${it.title}: ${e instanceof Error ? e.message : e}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const [cost] = await sql<{ usd: string }[]>`select coalesce(sum(cost_usd), 0)::numeric(10,4) usd from ai_usage where purpose = 'extract' and created_at > now() - interval '2 hours'`;
  console.log(`\nretag done: ${done} ok, ${failed} failed. extract spend last 2h: $${cost.usd}`);
  console.log("standard tags applied:", Object.fromEntries([...standard.entries()].sort((a, b) => b[1] - a[1])));
  await sql.end();
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
