import { z } from "zod";
import { ACTIONS } from "./db";

// What the AI returns for any save. Sewing fields are filled only when the save is about sewing.
export const Extraction = z.object({
  title: z.string().max(120),
  summary: z.string().max(300),
  topic: z.string().max(40).default("other"),
  shelf: z.string().max(80).nullable().default(null),
  category: z.string().max(40).default("other"),
  action: z.enum(ACTIONS).catch("reference"),
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
  "topic": "one or two lowercase words for the area of life this belongs to, e.g. 'sewing', 'fashion', 'cooking', 'home', 'travel', 'kids', 'gifts', 'fitness', 'garden', 'beauty', 'books', 'other'",
  "shelf": "the single best match from the user's shelf list given in the message, copied exactly, or null if none fits",
  "category": "what kind of thing: 'product' (something for sale), 'inspiration' (a look, room, mood, idea), 'howto' (teaches something), 'pattern', 'recipe', 'place', 'article', 'other'",
  "action": "buy | make | learn | inspo | reference  (buy = a product to consider buying; make = a project to make or cook; learn = a how-to; inspo = a look or idea; reference = facts to keep)",
  "tags": ["4-10 lowercase tags. FIRST any of the standard tags that apply, copied exactly from the list in the message (occasion like 'christmas', purpose like 'gift idea', theme like 'color inspiration'). THEN specific searchable descriptors (e.g. 'wide-leg pants', 'green linen', 'one-pot', 'reading nook')"],
  "garments": ["ONLY if clothing is shown or discussed: garment types, lowercase, e.g. 'wrap dress', 'trench coat'"],
  "techniques": ["ONLY for sewing/craft how-tos: techniques shown or taught"],
  "fabrics": ["ONLY if fabric or material is named or clearly visible"],
  "colors": ["dominant colors, if visual"],
  "patterns": [{"name": "sewing pattern name", "brand": "company", "number": "pattern number if any"}],
  "products": [{"name": "item name as sold", "brand": "", "price": "with currency if shown", "url": "shop link if present"}],
  "steps": ["if it is a how-to or recipe: the steps, each one short sentence, in order"],
  "creator": "handle or name of the creator, or null",
  "ocr_text": "all legible on-screen / in-image text, or null"
}`;

// Tags the model is told to use verbatim whenever they apply, so filtering by them is consistent.
// Specific descriptive tags are added on top of these.
export const STANDARD_TAGS = [
  // occasions and seasons
  "christmas", "halloween", "thanksgiving", "easter", "valentines", "birthday", "wedding", "baby shower", "back to school", "summer", "fall", "winter", "spring",
  // purpose
  "gift idea", "for kids", "for baby", "for home", "for me", "for the dog", "party", "travel", "quick project", "beginner", "weekend project", "budget", "splurge",
  // theme
  "color inspiration", "outfit idea", "capsule wardrobe", "room idea", "table setting", "diy decor", "upcycle", "organization", "recipe", "meal prep", "cozy", "minimal", "vintage", "cottagecore",
] as const;
