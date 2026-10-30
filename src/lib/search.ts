import { embedQuery } from "./ai";
import { sql, type Item } from "./db";

export type Filters = { q?: string; shelf?: string; unshelved?: boolean; source?: string; action?: string; tag?: string; status?: string; starred?: boolean; limit?: number };

let vectorReady: boolean | null = null;
async function hasVector() {
  if (vectorReady === null) { const [r] = await sql<{ ok: boolean }[]>`select exists(select 1 from information_schema.columns where table_name='items' and column_name='embedding') ok`; vectorReady = r.ok; }
  return vectorReady;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every item comes back with `shelves`: the names of the shelves it sits on, in shelf order.
export async function searchItems(f: Filters): Promise<Item[]> {
  const limit = f.limit ?? 60;
  const q = f.q?.trim();
  const vec = q && (await hasVector()) ? await embedQuery(q) : null;
  const shelf = f.shelf && UUID.test(f.shelf) ? f.shelf : undefined;
  return sql<Item[]>`
    select items.*,
      coalesce((select array_agg(c.name order by c.position, c.name) from collection_items ci join collections c on c.id = ci.collection_id where ci.item_id = items.id and c.is_shelf), '{}') as shelves
    from items
    where archived = false and duplicate_of is null
      ${shelf ? sql`and exists (select 1 from collection_items ci where ci.item_id = items.id and ci.collection_id = ${shelf})` : sql``}
      ${f.unshelved ? sql`and not exists (select 1 from collection_items ci join collections c on c.id = ci.collection_id where ci.item_id = items.id and c.is_shelf)` : sql``}
      ${f.source ? sql`and source = ${f.source}` : sql``}
      ${f.action ? sql`and action = ${f.action}` : sql``}
      ${f.tag ? sql`and ${f.tag} = any(tags)` : sql``}
      ${f.status ? sql`and status = ${f.status}` : sql``}
      ${f.starred ? sql`and starred` : sql``}
      ${q && !vec ? sql`and (search @@ websearch_to_tsquery('english', ${q}) or title ilike ${"%" + q + "%"} or raw_text ilike ${"%" + q + "%"})` : sql``}
      ${q && vec ? sql`and (search @@ websearch_to_tsquery('english', ${q}) or embedding is not null)` : sql``}
    order by
      ${q && vec ? sql`(coalesce(ts_rank(search, websearch_to_tsquery('english', ${q})), 0) * 2 + coalesce(1 - (embedding <=> ${JSON.stringify(vec)}::vector), 0)) desc,` : sql``}
      ${q && !vec ? sql`ts_rank(search, websearch_to_tsquery('english', ${q})) desc,` : sql``}
      created_at desc
    limit ${limit}`;
}

export async function spend() {
  const [row] = await sql<{ total: string; calls: number; this_month: string }[]>`
    select coalesce(sum(cost_usd),0)::text total, count(*)::int calls,
           coalesce(sum(cost_usd) filter (where created_at > date_trunc('month', now())),0)::text this_month
    from ai_usage`;
  return { total: Number(row.total), month: Number(row.this_month), calls: row.calls };
}

export type Shelf = { id: string; name: string; position: number; n: number };

export async function facets() {
  const live = sql`archived = false and duplicate_of is null`;
  const [shelves, unshelved, srcs, tags, counts] = await Promise.all([
    sql<Shelf[]>`select c.id, c.name, c.position, (select count(*)::int from collection_items ci join items i on i.id = ci.item_id where ci.collection_id = c.id and i.archived = false and i.duplicate_of is null) n
                 from collections c where c.is_shelf order by c.position, c.name`,
    sql<{ n: number }[]>`select count(*)::int n from items where ${live} and not exists (select 1 from collection_items ci join collections c on c.id = ci.collection_id where ci.item_id = items.id and c.is_shelf)`,
    sql<{ source: string; n: number }[]>`select source, count(*)::int n from items where ${live} group by 1 order by 2 desc`,
    sql<{ tag: string; n: number }[]>`select t tag, count(*)::int n from items, unnest(tags) t where ${live} and t not in ('sewing-tip','has-howto','link-only','note-only') group by 1 order by 2 desc limit 24`,
    sql<{ status: string; n: number }[]>`select status, count(*)::int n from items where ${live} group by 1`,
  ]);
  return { shelves, unshelved: unshelved[0]?.n ?? 0, srcs, tags, counts };
}
