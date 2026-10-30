"use server";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isStage } from "@/lib/stages";

const ids = (fd: FormData): string[] => { try { const a = JSON.parse(String(fd.get("ids") ?? "[]")); return Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, 500) : []; } catch { return []; } };
const normTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
const refresh = () => { for (const p of ["/", "/make", "/collections", "/tags"]) revalidatePath(p); };

// One entry point, `op` picks the action. Keeps the client bar to a single form.
export async function bulk(fd: FormData) {
  await requireSession();
  const list = ids(fd);
  if (!list.length) return;
  const op = String(fd.get("op"));
  if (op === "tag") {
    const tags = String(fd.get("value") ?? "").split(",").map(normTag).filter(Boolean);
    if (tags.length) await sql`update items set tags = (select array_agg(distinct t) from unnest(tags || ${tags}::text[]) t) where id = any(${list}::uuid[])`;
  } else if (op === "collection") {
    let cid = String(fd.get("value") ?? "");
    const name = String(fd.get("new_name") ?? "").trim().slice(0, 80);
    if (name) { const [c] = await sql<{ id: string }[]>`insert into collections (name) values (${name}) on conflict (name) do update set name = excluded.name returning id`; cid = c.id; }
    if (cid) await sql`insert into collection_items (collection_id, item_id) select ${cid}::uuid, unnest(${list}::uuid[]) on conflict do nothing`;
  } else if (op === "archive") {
    await sql`update items set archived = true where id = any(${list}::uuid[])`;
  } else if (op === "stage") {
    const v = String(fd.get("value") ?? "");
    if (isStage(v)) await sql`update items set stage = ${v}, stage_changed_at = now() where id = any(${list}::uuid[])`;
  } else if (op === "star") {
    await sql`update items set starred = true where id = any(${list}::uuid[])`;
  }
  refresh();
}

// Item page: edit tags, category and action by hand.
export async function updateFacets(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  const tags = String(fd.get("tags") ?? "").split(",").map(normTag).filter(Boolean);
  const category = String(fd.get("category") ?? "") || null;
  const action = String(fd.get("action") ?? "") || null;
  await sql`update items set tags = ${tags}, category = ${category}, action = ${action} where id = ${id}`;
  revalidatePath(`/item/${id}`); refresh();
}

// Tags page: rename a tag everywhere (merges if the new name already exists) or delete it everywhere.
export async function renameTag(fd: FormData) {
  await requireSession();
  const from = normTag(String(fd.get("from") ?? "")), to = normTag(String(fd.get("to") ?? ""));
  if (!from) return;
  if (to && to !== from) {
    await sql`update items set tags = (select array_agg(distinct case when t = ${from} then ${to} else t end) from unnest(tags) t) where ${from} = any(tags)`;
  } else if (!to) {
    await sql`update items set tags = array_remove(tags, ${from}) where ${from} = any(tags)`;
  }
  refresh();
}
