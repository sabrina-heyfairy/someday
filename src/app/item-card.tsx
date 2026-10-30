import Link from "next/link";
import type { Item } from "@/lib/db";

const ICON: Record<string, string> = { instagram: "📸", tiktok: "🎵", facebook: "📘", reddit: "👽", youtube: "▶️", pinterest: "📌", web: "🌐", screenshot: "🖼️", photo: "🖼️", text: "📝", note: "📝" };

export function ItemCard({ item }: { item: Item }) {
  const thumb = item.media?.thumbnail ? `/api/media/${item.media.thumbnail}` : null;
  return (
    <Link href={`/item/${item.id}`} className="card block break-inside-avoid rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      {thumb && <img src={thumb} alt="" className="w-full object-cover" loading="lazy" />}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] muted">
          <span>{ICON[item.source] ?? "🪶"} {item.source}</span>
          {item.kind === "video" && <span>· video</span>}
          {item.status !== "done" && <span className="ml-auto" style={{ color: item.status === "failed" ? "var(--accent)" : undefined }}>{item.status}…</span>}
        </div>
        <div className="font-medium leading-snug text-sm line-clamp-2">{item.title ?? item.raw_text?.slice(0, 80) ?? item.url ?? "Saved item"}</div>
        {item.summary && <p className="text-xs muted line-clamp-2">{item.summary}</p>}
        {item.tags.length > 0 && <div className="flex flex-wrap gap-1 pt-0.5">{item.tags.slice(0, 4).map((t) => <span key={t} className="chip">{t}</span>)}</div>}
      </div>
    </Link>
  );
}
