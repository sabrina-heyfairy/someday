import Link from "next/link";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";
import { renameTag } from "../bulk-actions";

export const dynamic = "force-dynamic";

export default async function TagsPage() {
  await requireSession("/tags");
  const tags = await sql<{ tag: string; n: number }[]>`select t tag, count(*)::int n from items, unnest(tags) t where archived = false and duplicate_of is null group by 1 order by 2 desc, 1`;
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold">Tags</h1>
        <p className="text-xs muted">Rename merges into an existing tag if the name already exists. Clear the name to delete the tag everywhere.</p>
      </div>
      <div className="card rounded-2xl divide-y" style={{ borderColor: "var(--line)" }}>
        {tags.map((t) => (
          <form key={t.tag} action={renameTag} className="flex items-center gap-2 p-2 text-sm">
            <input type="hidden" name="from" value={t.tag} />
            <Link href={`/?tag=${encodeURIComponent(t.tag)}`} className="muted w-10 text-right text-xs shrink-0">{t.n}</Link>
            <input name="to" defaultValue={t.tag} className="card rounded-full px-3 py-1 text-sm flex-1" />
            <button className="chip">Save</button>
          </form>
        ))}
        {tags.length === 0 && <p className="p-6 text-center muted text-sm">No tags yet.</p>}
      </div>
    </div>
  );
}
