"use server";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { fetchPinterestBoard, runSource, type Source } from "@/lib/sources";

export async function addPinterestBoard(fd: FormData) {
  await requireSession();
  const url = String(fd.get("url") ?? "").trim();
  if (!/pinterest\./.test(url)) return;
  let label = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  try { label = (await fetchPinterestBoard(url)).board; } catch { /* keep url as label; the run will surface the error */ }
  await sql`insert into sources (kind, label, config) values ('pinterest_board', ${label}, ${sql.json({ url })})`;
  revalidatePath("/sources");
}
export async function removeSource(fd: FormData) {
  await requireSession();
  await sql`delete from sources where id = ${String(fd.get("id"))}`;
  revalidatePath("/sources");
}
export async function toggleSource(fd: FormData) {
  await requireSession();
  await sql`update sources set enabled = not enabled where id = ${String(fd.get("id"))}`;
  revalidatePath("/sources");
}
export async function syncNow(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id") ?? "");
  const rows = id ? await sql<Source[]>`select * from sources where id = ${id}` : await sql<Source[]>`select * from sources where enabled`;
  for (const s of rows) { try { await runSource(s); } catch { /* recorded on the row */ } }
  revalidatePath("/sources"); revalidatePath("/");
}
