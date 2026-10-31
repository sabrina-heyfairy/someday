import { redirect } from "next/navigation";
import { after } from "next/server";
import { intake } from "@/lib/intake";
import { processQueued } from "@/lib/pipeline";

import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

async function add(fd: FormData) {
  "use server";
  const file = fd.get("image");
  const image = file instanceof File && file.size > 0 ? { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name } : null;
  const url = String(fd.get("url") ?? "").trim() || null;
  const text = String(fd.get("text") ?? "").trim() || null;
  if (!url && !text && !image) return;
  const { id } = await intake({ url, text, image, channel: "api" });
  after(() => processQueued(1).catch(console.error));
  redirect(`/item/${id}`);
}

export default async function AddPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireSession("/add");
  const sp = await searchParams;
  const shared = [sp.url, sp.text, sp.title].filter(Boolean).join(" ");
  const sharedUrl = shared.match(/https?:\/\/\S+/)?.[0] ?? "";
  const sharedText = shared.replace(sharedUrl, "").trim();
  return (
    <form action={add} className="card max-w-lg mx-auto p-5 space-y-3">
      <h1 className="font-semibold">Add something</h1>
      <p className="text-sm muted">Normally you'd share from your phone. This is the manual door for testing or desktop finds.</p>
      <input name="url" defaultValue={sharedUrl} placeholder="Paste a link (Instagram, TikTok, Reddit, YouTube, any page)" className="card w-full rounded-xl px-3 py-2 text-sm" />
      <textarea name="text" rows={2} defaultValue={sharedText} placeholder="…or text / a note" className="card w-full rounded-xl px-3 py-2 text-sm" />
      <input type="file" name="image" accept="image/*" className="text-sm" />
      <button className="btn px-4 py-2">Save</button>
    </form>
  );
}
