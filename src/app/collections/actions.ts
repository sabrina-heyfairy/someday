"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

const clean = (s: FormDataEntryValue | null) => String(s ?? "").trim().slice(0, 80);

// Create a collection (optionally adding one item to it straight away).
export async function createCollection(fd: FormData) {
  await requireSession();
  const name = clean(fd.get("name"));
  if (!name) return;
  const itemId = clean(fd.get("item_id")) || null;
  const [c] = await sql<{ id: string }[]>`insert into collections (name) values (${name}) on conflict (name) do update set name = excluded.name returning id`;
  if (itemId) await sql`insert into collection_items (collection_id, item_id) values (${c.id}, ${itemId}) on conflict do nothing`;
  revalidatePath("/collections");
  if (itemId) revalidatePath(`/item/${itemId}`); else redirect(`/?shelf=${c.id}`);
}

// Add or remove one item from one collection.
export async function toggleMembership(fd: FormData) {
  await requireSession();
  const collectionId = clean(fd.get("collection_id")), itemId = clean(fd.get("item_id"));
  const on = fd.get("on") === "1";
  if (on) await sql`insert into collection_items (collection_id, item_id) values (${collectionId}, ${itemId}) on conflict do nothing`;
  else await sql`delete from collection_items where collection_id = ${collectionId} and item_id = ${itemId}`;
  revalidatePath(`/item/${itemId}`); revalidatePath(`/collections/${collectionId}`); revalidatePath("/collections");
}

export async function renameCollection(fd: FormData) {
  await requireSession();
  const id = clean(fd.get("id")), name = clean(fd.get("name")), description = String(fd.get("description") ?? "").trim().slice(0, 300) || null;
  if (name) await sql`update collections set name = ${name}, description = ${description} where id = ${id}`;
  revalidatePath(`/collections/${id}`); revalidatePath("/collections");
}

export async function deleteCollection(fd: FormData) {
  await requireSession();
  await sql`delete from collections where id = ${clean(fd.get("id"))}`;
  revalidatePath("/collections"); revalidatePath("/");
  redirect("/collections");
}

// Shelves page: rename, describe, reorder, or hide a shelf from the home row.
export async function updateShelf(fd: FormData) {
  await requireSession();
  const id = clean(fd.get("id")), name = clean(fd.get("name"));
  const description = String(fd.get("description") ?? "").trim().slice(0, 300) || null;
  const position = Math.max(0, Math.min(9999, Number(fd.get("position")) || 100));
  const isShelf = fd.get("is_shelf") === "on";
  if (name) await sql`update collections set name = ${name}, description = ${description}, position = ${position}, is_shelf = ${isShelf} where id = ${id}`;
  revalidatePath("/collections"); revalidatePath("/");
}

// Unsorted view: "Make a Cooking shelf" creates the shelf and moves every unsorted item with that topic onto it.
export async function createShelfFromTopic(fd: FormData) {
  await requireSession();
  const topic = clean(fd.get("topic")).toLowerCase();
  if (!topic) return;
  const name = topic.charAt(0).toUpperCase() + topic.slice(1);
  const [c] = await sql<{ id: string }[]>`insert into collections (name) values (${name}) on conflict (name) do update set name = excluded.name, is_shelf = true returning id`;
  await sql`insert into collection_items (collection_id, item_id)
    select ${c.id}::uuid, i.id from items i
    where i.archived = false and i.duplicate_of is null and coalesce(i.topic, 'other') = ${topic}
      and not exists (select 1 from collection_items ci join collections c2 on c2.id = ci.collection_id where ci.item_id = i.id and c2.is_shelf)
    on conflict do nothing`;
  revalidatePath("/"); revalidatePath("/collections");
  redirect(`/?shelf=${c.id}`);
}
