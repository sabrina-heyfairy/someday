// Shelves are the user's own buckets (rows in `collections` with is_shelf = true).
// The AI still classifies into `category`; this maps that guess onto a shelf name as a suggestion.

export const DEFAULT_SHELVES = ["Bags & pouches", "Garments", "Techniques", "Patterns", "Fabric", "Accessories", "Home decor", "Tools & supplies"] as const;

const BY_CATEGORY: Record<string, string> = {
  garment: "Garments", garments: "Garments", "bags-pouches": "Bags & pouches",
  technique: "Techniques", tutorial: "Techniques", "lace-embellishment": "Techniques",
  pattern: "Patterns", fabric: "Fabric", product: "Tools & supplies", "tools-resources": "Tools & supplies",
  accessories: "Accessories", "home-decor": "Home decor",
};

const BAG_WORDS = /\b(bag|pouch|tote|clutch|wallet|purse|backpack|zipper pouch)\b/i;

export function suggestShelf(input: { category?: string | null; archiveCategory?: string | null; garments?: string[]; title?: string | null; tags?: string[] }): string | null {
  const key = input.archiveCategory ?? input.category ?? null;
  const hay = [input.title ?? "", ...(input.garments ?? []), ...(input.tags ?? [])].join(" ");
  if (BAG_WORDS.test(hay)) return "Bags & pouches";
  if (key && BY_CATEGORY[key]) return BY_CATEGORY[key];
  if (key === "inspiration" && (input.garments?.length ?? 0) > 0) return "Garments";
  return null;
}
