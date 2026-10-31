import "./env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sql } from "../src/lib/db";

/*
  Import Sabrina's sewing tips archive into the items table + a collection.

    npm run import:tips              # upsert all tips from content/sewing-tips-archive.json
    npm run import:tips -- --dry-run # count only, no writes
*/

type ArchiveTip = {
  id: string;
  title: string;
  url: string | null;
  source: string;
  category: string;
  tags: string[];
  notes: string;
  how_to: string;
  status: "transcribed" | "linked" | "note-only" | string;
};

type Archive = {
  meta: { version: number; title: string; count: number; categories: string[]; sources: string[]; status_counts: Record<string, number> };
  tips: ArchiveTip[];
};

const COLLECTION_NAME = "Sewing tips archive";
const COLLECTION_DESC = "Sabrina's Sewist Studio tips — imported from the sewing tips archive.";

/** Map archive categories onto Someday's item.category vocabulary. Original kept in meta + tags. */
const CATEGORY_MAP: Record<string, string> = {
  garments: "garment",
  technique: "technique",
  "lace-embellishment": "technique",
  accessories: "product",
  "bags-pouches": "garment",
  "home-decor": "inspiration",
  "tools-resources": "product",
};

/** Archive "note" source → Someday "text". Everything else already matches. */
const SOURCE_MAP: Record<string, string> = { note: "text" };

function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function canonicalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|mibextid|igsh|si$)/i.test(k) || k === "feature") u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/** Split how_to into steps when numbered; otherwise one step for the whole tip. */
function stepsFromHowTo(howTo: string): string[] {
  const text = howTo.trim();
  if (!text) return [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^\d+\.\s+/.test(l) || /^\*\*\d+\./.test(l));
  if (numbered.length >= 2) {
    return lines.map((l) => l.replace(/^\d+\.\s+/, "").replace(/^\*\*/, "").replace(/\*\*$/, "").trim()).filter(Boolean);
  }
  return [text];
}

function actionFor(tip: ArchiveTip): string {
  if (tip.how_to.trim()) return /make|sew|stitch|hem|gather|cut /i.test(tip.how_to) ? "make" : "learn";
  if (tip.status === "linked") return "reference";
  return "learn";
}

function techniquesFrom(tip: ArchiveTip): string[] {
  const techTags = ["smocking", "understitching", "hand-sewing", "ruffle", "bias", "gathering", "zipper", "hem", "lining", "facing", "embroidery", "quilting", "pleat", "dart"];
  return tip.tags.filter((t) => techTags.some((k) => t.includes(k)) || tip.category === "technique" || tip.category === "lace-embellishment");
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const path = join(process.cwd(), "content", "sewing-tips-archive.json");
  const archive = JSON.parse(readFileSync(path, "utf8")) as Archive;
  if (archive.tips.length !== archive.meta.count) {
    throw new Error(`Archive meta.count ${archive.meta.count} != tips.length ${archive.tips.length}`);
  }
  console.log(`Archive: ${archive.meta.title} — ${archive.tips.length} tips`);
  if (dry) {
    console.log("dry-run: would upsert", archive.tips.length, "tips into collection", JSON.stringify(COLLECTION_NAME));
    await sql.end();
    return;
  }

  const [collection] = await sql<{ id: string }[]>`
    insert into collections (name, description) values (${COLLECTION_NAME}, ${COLLECTION_DESC})
    on conflict (name) do update set description = excluded.description
    returning id`;

  let inserted = 0, updated = 0, linked = 0;

  for (const tip of archive.tips) {
    const source = SOURCE_MAP[tip.source] ?? tip.source;
    const category = CATEGORY_MAP[tip.category] ?? "other";
    const kind = tip.url ? "link" : "text";
    const canonical = tip.url ? canonicalize(tip.url) : null;
    const urlHash = canonical ? sha256(canonical) : null;
    const steps = stepsFromHowTo(tip.how_to);
    const summary = tip.how_to.trim()
      ? tip.how_to.trim().slice(0, 280) + (tip.how_to.trim().length > 280 ? "…" : "")
      : tip.notes.trim()
        ? tip.notes.trim().slice(0, 280)
        : null;
    const tags = Array.from(new Set([
      ...tip.tags,
      tip.category,
      "sewing-tip",
      tip.status === "transcribed" ? "has-howto" : tip.status === "note-only" ? "note-only" : "link-only",
    ].filter(Boolean)));
    const meta = {
      archive_id: tip.id,
      archive_status: tip.status,
      archive_category: tip.category,
      archive_source: tip.source,
      archive_title: archive.meta.title,
    };
    const techniques = techniquesFrom(tip);
    const action = actionFor(tip);
    const notes = tip.notes.trim() || null;

    const [existing] = await sql<{ id: string; retagged: boolean }[]>`
      select id, (meta ? 'retagged_at') as retagged from items where meta->>'archive_id' = ${tip.id} limit 1`;

    let itemId: string;
    if (existing?.retagged) {
      // Re-tagged by the AI (scripts/retag.ts): keep its tags/topic/category and the user's title; refresh only the structural bits.
      await sql`
        update items set
          source = ${source}, kind = ${kind}, channel = 'archive',
          url = ${tip.url}, canonical_url = ${canonical}, url_hash = ${urlHash},
          status = 'done', error = null, steps = ${steps}, notes = ${notes},
          meta = meta || ${sql.json(meta as never)},
          raw_text = ${tip.how_to.trim() || tip.notes.trim() || null}
        where id = ${existing.id}`;
      itemId = existing.id;
      updated++;
    } else if (existing) {
      await sql`
        update items set
          source = ${source}, kind = ${kind}, channel = 'archive',
          url = ${tip.url}, canonical_url = ${canonical}, url_hash = ${urlHash},
          status = 'done', error = null, processed_at = coalesce(processed_at, now()),
          title = ${tip.title}, summary = ${summary}, category = ${category}, action = ${action},
          tags = ${tags}, techniques = ${techniques}, steps = ${steps},
          notes = ${notes}, meta = meta || ${sql.json(meta as never)},
          raw_text = ${tip.how_to.trim() || tip.notes.trim() || null}
        where id = ${existing.id}`;
      itemId = existing.id;
      updated++;
    } else {
      // Prefer matching an already-saved URL so the archive enriches rather than duplicates.
      let byUrl: { id: string } | undefined;
      if (urlHash) {
        [byUrl] = await sql<{ id: string }[]>`select id from items where url_hash = ${urlHash} and duplicate_of is null limit 1`;
      }
      if (byUrl) {
        await sql`
          update items set
            title = coalesce(nullif(title, ''), ${tip.title}),
            summary = coalesce(nullif(summary, ''), ${summary}),
            category = coalesce(category, ${category}),
            action = coalesce(action, ${action}),
            tags = (select array_agg(distinct t) from unnest(tags || ${tags}) t),
            techniques = (select array_agg(distinct t) from unnest(techniques || ${techniques}) t),
            steps = case when cardinality(steps) = 0 then ${steps} else steps end,
            notes = case when coalesce(notes, '') = '' then ${notes} else notes end,
            status = 'done',
            meta = meta || ${sql.json(meta as never)},
            channel = case when channel = 'api' then 'archive' else channel end
          where id = ${byUrl.id}`;
        itemId = byUrl.id;
        updated++;
      } else {
        const [row] = await sql<{ id: string }[]>`
          insert into items (
            source, kind, channel, url, canonical_url, url_hash, raw_text,
            status, processed_at, title, summary, category, action,
            tags, techniques, steps, notes, meta
          ) values (
            ${source}, ${kind}, 'archive', ${tip.url}, ${canonical}, ${urlHash},
            ${tip.how_to.trim() || tip.notes.trim() || null},
            'done', now(), ${tip.title}, ${summary}, ${category}, ${action},
            ${tags}, ${techniques}, ${steps}, ${notes}, ${sql.json(meta as never)}
          ) returning id`;
        itemId = row.id;
        inserted++;
      }
    }

    await sql`
      insert into collection_items (collection_id, item_id) values (${collection.id}, ${itemId})
      on conflict do nothing`;
    linked++;
  }

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int n from items where meta ? 'archive_id' and duplicate_of is null`;
  console.log(`Done. inserted=${inserted} updated=${updated} collection_links=${linked} archive_items_in_db=${n}`);
  if (n !== archive.tips.length) {
    console.warn(`WARNING: expected ${archive.tips.length} archive items, found ${n}`);
    process.exitCode = 1;
  }
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
