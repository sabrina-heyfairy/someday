import { z } from "zod";
import { ACTIONS, CATEGORIES } from "./db";

export const Extraction = z.object({
  title: z.string().max(120),
  summary: z.string().max(300),
  category: z.enum(CATEGORIES),
  action: z.enum(ACTIONS),
  tags: z.array(z.string()).max(10).default([]),
  garments: z.array(z.string()).default([]),
  techniques: z.array(z.string()).default([]),
  fabrics: z.array(z.string()).default([]),
  colors: z.array(z.string()).default([]),
  patterns: z.array(z.object({ name: z.string(), brand: z.string().optional(), number: z.string().optional() })).default([]),
  products: z.array(z.object({ name: z.string(), brand: z.string().optional(), price: z.string().optional(), url: z.string().optional() })).default([]),
  steps: z.array(z.string()).default([]),
  creator: z.string().nullable().default(null),
  ocr_text: z.string().nullable().default(null),
});
export type Extraction = z.infer<typeof Extraction>;

export const EXTRACTION_JSON_SHAPE = `{
  "title": "short human title, max 12 words",
  "summary": "one sentence: what this is and why someone would save it",
  "category": "garment | pattern | technique | tutorial | fabric | product | inspiration | other",
  "action": "make | buy | learn | inspo | reference",
  "tags": ["3-8 lowercase tags, specific (e.g. 'bias binding', 'wide-leg pants', 'linen')"],
  "garments": ["garment types shown, lowercase, e.g. 'jumpsuit', 'wrap dress'"],
  "techniques": ["sewing techniques shown or taught, e.g. 'french seam', 'invisible zipper'"],
  "fabrics": ["fabrics named or clearly visible, e.g. 'linen', 'double gauze'"],
  "colors": ["dominant colors"],
  "patterns": [{"name": "pattern name", "brand": "company", "number": "pattern number if any"}],
  "products": [{"name": "", "brand": "", "price": "", "url": ""}],
  "steps": ["if it is a how-to: the steps, each one short sentence, in order"],
  "creator": "handle or name of the creator, or null",
  "ocr_text": "all legible on-screen / in-image text, or null"
}`;
