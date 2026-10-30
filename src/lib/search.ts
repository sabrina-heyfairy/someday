import { embedQuery } from "./ai";
import { sql, type Item } from "./db";

export type Filters = { q?: string; category?: string; source?: string; action?: string; tag?: string; status?: string; starred?: boolean; limit?: number };

let vectorReady: boolean | null = null;
async function hasVector() {
  if (vectorReady === null) { const [r] = await sql<{ ok: boolean }[]>`select exists(select 1 from information_schema.columns where table_name='items' and column_name='embedding') ok`; vectorReady = r.ok; }
  return vectorReady;
}

export async function searchItems(f: Filters): Promise<Item[]> {
  const limit = f.limit ?? 60;
  const q = f.q?.trim();
  const vec = q && (await hasVector()) ? await embedQuery(q) : null;
  return sql<Item[]>`
    select * from items
    where archived = false and duplicate_of is null
      ${f.category ? sql`and category = ${f.category}` : sql``}
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

export async function facets() {
  const [cats, srcs, tags, counts] = await Promise.all([
    sql<{ category: string; n: number }[]>`select category, count(*)::int n from items where archived = false and duplicate_of is null and category is not null group by 1 order by 2 desc`,
    sql<{ source: string; n: number }[]>`select source, count(*)::int n from items where archived = false and duplicate_of is null group by 1 order by 2 desc`,
    sql<{ tag: string; n: number }[]>`select t tag, count(*)::int n from items, unnest(tags) t where archived = false and duplicate_of is null group by 1 order by 2 desc limit 30`,
    sql<{ status: string; n: number }[]>`select status, count(*)::int n from items where archived = false and duplicate_of is null group by 1`,
  ]);
  return { cats, srcs, tags, counts };
}
