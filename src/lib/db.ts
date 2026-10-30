import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __somedaySql: ReturnType<typeof postgres> | undefined;
}

export const sql =
  globalThis.__somedaySql ??
  postgres(process.env.DATABASE_URL ?? "postgres://localhost:5432/someday", {
    max: 5,
    idle_timeout: 20,
    transform: { undefined: null },
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: !/:6543\//.test(process.env.DATABASE_URL ?? ""),
    ssl: /supabase\.(co|com)/.test(process.env.DATABASE_URL ?? "") ? "require" : undefined,
  });

if (process.env.NODE_ENV !== "production") globalThis.__somedaySql = sql;

export type Item = {
  id: string;
  created_at: string;
  updated_at: string;
  source: string;
  kind: string;
  channel: string;
  url: string | null;
  canonical_url: string | null;
  raw_text: string | null;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  title: string | null;
  creator: string | null;
  summary: string | null;
  category: string | null;
  action: string | null;
  tags: string[];
  garments: string[];
  techniques: string[];
  fabrics: string[];
  colors: string[];
  patterns: { name: string; brand?: string; number?: string }[];
  products: { name: string; brand?: string; price?: string; url?: string }[];
  steps: string[];
  transcript: string | null;
  ocr_text: string | null;
  media: { thumbnail?: string; video?: string; frames?: string[]; audio?: string; original?: string };
  meta: Record<string, unknown>;
  notes: string | null;
  starred: boolean;
  archived: boolean;
  phash: string | null;
  duplicate_of: string | null;
  stage: "want" | "fabric" | "in_progress" | "done" | null;
  stage_changed_at: string | null;
  shelves?: string[];
};

export const CATEGORIES = ["garment", "pattern", "technique", "tutorial", "fabric", "product", "inspiration", "other"] as const;
export const ACTIONS = ["make", "buy", "learn", "inspo", "reference"] as const;
export const SOURCES = ["instagram", "tiktok", "facebook", "reddit", "youtube", "pinterest", "web", "screenshot", "photo", "text", "note"] as const;
