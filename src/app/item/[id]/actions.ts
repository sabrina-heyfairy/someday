"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { processItem } from "@/lib/pipeline";
import { requireSession } from "@/lib/require-session";

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
