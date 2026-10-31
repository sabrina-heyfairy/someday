"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { processItem } from "@/lib/pipeline";
import { requireSession } from "@/lib/require-session";
const normTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);

export async function toggleStar(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  await sql`update items set starred = not starred where id = ${id}`;
  revalidatePath(`/item/${id}`);
}
export async function saveNotes(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  await sql`update items set notes = ${String(fd.get("notes") ?? "")} where id = ${id}`;
  revalidatePath(`/item/${id}`);
}
export async function archive(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  await sql`update items set archived = true where id = ${id}`;
  redirect("/");
}
export async function reprocess(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  await sql`update items set status = 'processing', error = null where id = ${id}`;
  try { await processItem(id); } catch (e) { await sql`update items set status = 'failed', error = ${String(e instanceof Error ? e.message : e)} where id = ${id}`; }
  revalidatePath(`/item/${id}`);
}

// One tag at a time, from the chips on the item page.
export async function addTag(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  const tags: string[] = String(fd.get("tag") ?? "").split(",").map(normTag).filter(Boolean);
  if (tags.length) await sql`update items set tags = (select array_agg(distinct t) from unnest(tags || ${tags}::text[]) t) where id = ${id}`;
  revalidatePath(`/item/${id}`);
}
export async function removeTag(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  await sql`update items set tags = array_remove(tags, ${String(fd.get("tag") ?? "")}) where id = ${id}`;
  revalidatePath(`/item/${id}`);
}
