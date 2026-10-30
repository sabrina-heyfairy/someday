import Link from "next/link";
import type { Item } from "@/lib/db";

// A card is: the picture, the title, one line, and the shelf it sits on. Tags are searchable but not shown here.
export function ItemCard({ item }: { item: Item }) {
  const thumb = item.media?.thumbnail ? `/api/media/${item.media.thumbnail}` : null;
  const shelf = item.shelves?.[0];
  const more = (item.shelves?.length ?? 0) - 1;
  const title = item.title ?? item.raw_text?.slice(0, 80) ?? item.url ?? "Saved item";
  return (
    <Link href={`/item/${item.id}`} className="card block break-inside-avoid rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      {thumb && (
        <div className="relative">
          <img src={thumb} alt="" className="w-full object-cover" loading="lazy" />
          {item.kind === "video" && <span className="absolute bottom-2 right-2 rounded-full px-1.5 py-0.5 text-[10px] text-white" style={{ background: "rgba(0,0,0,.55)" }}>▶ video</span>}
        </div>
      )}
      <div className="p-3 space-y-1">
        <div className="font-medium leading-snug text-sm line-clamp-2">{title}</div>
        {item.summary && <p className="text-xs muted line-clamp-1">{item.summary}</p>}
        <div className="flex items-center gap-1.5 text-[11px] muted pt-0.5">
          {shelf ? <span className="truncate">{shelf}{more > 0 ? ` +${more}` : ""}</span> : item.shelves ? <span className="truncate" style={{ opacity: 0.7 }}>unsorted</span> : null}
          {item.status !== "done" && <span className="ml-auto shrink-0" style={{ color: item.status === "failed" ? "var(--accent)" : undefined }}>{item.status}…</span>}
          {item.starred && <span className="ml-auto shrink-0">★</span>}
        </div>
      </div>
    </Link>
  );
}
