"use client";
import Link from "next/link";
import type { Item } from "@/lib/db";
import { shelfColor } from "@/lib/shelves";

// A card is: the picture, the title, one line, and the shelf it sits on. Tags are searchable but not shown here.
export function ItemCard({ item }: { item: Item }) {
  const thumb = item.media?.thumbnail ? `/api/media/${item.media.thumbnail}` : null;
  const shelf = item.shelves?.[0];
  const more = (item.shelves?.length ?? 0) - 1;
  const title = item.title ?? item.raw_text?.slice(0, 80) ?? item.url ?? "Saved item";
  return (
    <div className="relative break-inside-avoid">
    {item.url && (
      <a href={item.url} target="_blank" rel="noreferrer" title={`Open on ${item.source}`} className={`src-pill ${thumb ? "" : "low"}`} onClick={(e) => e.stopPropagation()}>
        {item.source} ↗
      </a>
    )}
    <Link href={`/item/${item.id}`} className="card block overflow-hidden">
      {thumb && (
        <div className="relative">
          <img src={thumb} alt="" className="w-full object-cover" loading="lazy" />
          {item.kind === "video" && <span className="absolute bottom-2 right-2 rounded-full px-1.5 py-0.5 text-[10px] text-white" style={{ background: "rgba(0,0,0,.55)" }}>▶ video</span>}
        </div>
      )}
      <div className="p-3 space-y-1" style={{ borderTop: thumb ? "2px solid var(--ink)" : undefined }}>
        <div className="font-medium leading-snug text-sm line-clamp-2">{title}</div>
        {item.summary && <p className="text-xs muted line-clamp-1">{item.summary}</p>}
        <div className={`flex items-center gap-1.5 text-[11px] muted pt-0.5 ${item.url && !thumb ? "pr-16" : ""}`}>
          {shelf ? <span className="tape truncate" style={{ "--c": shelfColor(shelf) } as React.CSSProperties}>{shelf}{more > 0 ? ` +${more}` : ""}</span> : item.shelves ? <span className="tape truncate" style={{ "--c": "var(--card)", borderStyle: "dashed" } as React.CSSProperties}>unsorted</span> : null}
          {item.status !== "done" && <span className="ml-auto shrink-0" style={{ color: item.status === "failed" ? "var(--accent)" : undefined }}>{item.status}…</span>}
          {item.starred && <span className="ml-auto shrink-0">★</span>}
        </div>
      </div>
    </Link>
    </div>
  );
}
