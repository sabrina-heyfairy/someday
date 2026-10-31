// Shelves are the user's own buckets (rows in `collections` with is_shelf = true).
// The AI is asked to pick one by name; these rules are the fallback when it does not, or names one that does not exist.

export type ShelfHint = {
  shelf?: string | null;          // the AI's pick, copied from the list it was shown
  topic?: string | null;          // 'sewing', 'fashion', 'cooking', ...
  category?: string | null;       // 'product', 'inspiration', 'howto', 'pattern', ... (older rows: 'garment', 'technique', ...)
  action?: string | null;         // buy | make | learn | inspo | reference
  archiveCategory?: string | null;
  garments?: string[];
  title?: string | null;
  tags?: string[];
};

const ARCHIVE: Record<string, string> = {
  "bags-pouches": "Bags & pouches", garments: "Garments", technique: "Techniques", "lace-embellishment": "Techniques",
  accessories: "Accessories", "home-decor": "Home decor", "tools-resources": "Tools & supplies",
};
const SEWING: Record<string, string> = {
  garment: "Garments", pattern: "Patterns", technique: "Techniques", tutorial: "Techniques", howto: "Techniques",
  fabric: "Fabric", product: "Tools & supplies",
};
const BAG_WORDS = /\b(bag|pouch|tote|clutch|wallet|purse|backpack)\b/i;

// Returns a shelf name, or null for unsorted. When `shelfNames` is given, only names in that list are returned.
export function pickShelf(h: ShelfHint, shelfNames?: string[]): string | null {
  const ok = (name: string | null | undefined) => {
    if (!name) return null;
    if (!shelfNames) return name;
    return shelfNames.find((s) => s.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;
  };
  const hay = [h.title ?? "", ...(h.garments ?? []), ...(h.tags ?? [])].join(" ");
  const topic = (h.topic ?? "").toLowerCase();
  const sewing = topic === "sewing" || topic === "" || !!h.archiveCategory;

  return ok(h.shelf)
    ?? (h.archiveCategory ? ok(ARCHIVE[h.archiveCategory]) : null)
    ?? (sewing && BAG_WORDS.test(hay) ? ok("Bags & pouches") : null)
    ?? (sewing && h.category ? ok(SEWING[h.category]) : null)
    ?? (h.action === "buy" && ((h.garments?.length ?? 0) > 0 || topic === "fashion") ? ok("Wardrobe") : null)
    ?? (topic === "fashion" && (h.category === "inspiration" || h.action === "inspo") ? ok("Inspiration") : null)
    ?? (topic === "fashion" ? ok("Wardrobe") : null)
    ?? (sewing && h.category === "inspiration" && (h.garments?.length ?? 0) > 0 ? ok("Garments") : null)
    ?? (h.category === "inspiration" || h.action === "inspo" ? ok("Inspiration") : null)
    ?? null;
}

// Each shelf gets a drawer color, chosen from the name so a card and the shelf row always agree.
export const SHELF_COLORS = ["#f2c14e", "#7fc8c3", "#f29b8a", "#c9b0e6", "#f5b1c8", "#a9cfa1", "#f6b57a", "#9dc3e6"] as const;
export function shelfColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SHELF_COLORS[h % SHELF_COLORS.length];
}
