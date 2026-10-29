"use server";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { isStage } from "@/lib/stages";

// Move an item to a stage, or off the board (stage = "").
export async function setStage(fd: FormData) {
  await requireSession();
  const id = String(fd.get("id"));
  const raw = String(fd.get("stage") ?? "");
  const stage = isStage(raw) ? raw : null;
  await sql`update items set stage = ${stage}, stage_changed_at = now() where id = ${id}`;
  revalidatePath("/make");
  revalidatePath(`/item/${id}`);
}
