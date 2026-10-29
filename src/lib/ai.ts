import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { Extraction, EXTRACTION_JSON_SHAPE } from "./extraction";

import { sql } from "./db";

const MOCK = process.env.MOCK_AI === "1" || !process.env.ANTHROPIC_API_KEY;
// Tiering: live saves get the better model, bulk backfill gets the cheap one.
export type Tier = "live" | "bulk";
const MODELS: Record<Tier, string> = {
  live: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
  bulk: process.env.ANTHROPIC_MODEL_BULK || "claude-haiku-5-5",
};
// USD per 1M tokens [input, output]. Anthropic list prices as of 2026-10; override via AI_PRICES_JSON if they change.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
  "whisper-1": [0, 0], "voyage-3.5": [0.06, 0],
  ...(process.env.AI_PRICES_JSON ? JSON.parse(process.env.AI_PRICES_JSON) : {}),
};
export function costUsd(model: string, input: number, output: number) {
  const [i, o] = PRICES[model] ?? [0, 0];
  return (input * i + output * o) / 1_000_000;
}
async function logUsage(itemId: string | null, purpose: string, model: string, input: number, output: number, extraCost = 0) {
  const cost = costUsd(model, input, output) + extraCost;
  await sql`insert into ai_usage (item_id, purpose, model, input_tokens, output_tokens, cost_usd) values (${itemId}, ${purpose}, ${model}, ${input}, ${output}, ${cost})`;
}

export type ExtractInput = {
  itemId?: string | null;
  tier?: Tier;
  url?: string | null;
  source: string;
  rawText?: string | null;      // caption, sms body, shared text
  pageText?: string | null;     // og description, reddit body, html text
  transcript?: string | null;
  imagePaths: string[];         // keyframes / screenshot (jpeg)
  metaTitle?: string | null;
  metaCreator?: string | null;
};

const SYSTEM = `You catalog things a home sewist saves from social media and the web: clothes they like, sewing patterns, techniques, tutorials, fabric, products, and general inspiration. You are given whatever could be recovered: a link, caption, page text, a transcript of the video's audio, and still frames or a screenshot. Read on-screen text carefully (it often carries the pattern name, measurements, or product). Be specific and concrete. Never invent a pattern or brand that is not in the material; leave arrays empty when unsure. Respond with ONLY a JSON object in this exact shape:\n${EXTRACTION_JSON_SHAPE}`;

export async function extract(input: ExtractInput): Promise<Extraction> {
  if (MOCK) return mockExtract(input);
  // Pin to the public API: a work shell may export ANTHROPIC_BASE_URL (corporate gateway) and the SDK would pick it up.
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.SOMEDAY_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com" });
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  for (const p of input.imagePaths.slice(0, 10)) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(p).toString("base64") } });
  }
  const parts = [
    input.url && `Link: ${input.url}`,
    `Source platform: ${input.source}`,
    input.metaTitle && `Page/video title: ${input.metaTitle}`,
    input.metaCreator && `Creator: ${input.metaCreator}`,
    input.rawText && `Caption / shared text:\n${input.rawText}`,
    input.pageText && `Page text:\n${input.pageText.slice(0, 6000)}`,
    input.transcript && `Audio transcript:\n${input.transcript.slice(0, 8000)}`,
    `${input.imagePaths.length} image(s) attached (video keyframes in order, or the saved screenshot).`,
  ].filter(Boolean).join("\n\n");
  content.push({ type: "text", text: parts });

  const model = MODELS[input.tier ?? "live"];
  const res = await client.messages.create({
    model, max_tokens: 2000, system: SYSTEM,
    output_config: { effort: "low" },   // cataloging, not reasoning: keep thinking spend minimal
    messages: [{ role: "user", content }],
  });
  await logUsage(input.itemId ?? null, "extract", model, res.usage.input_tokens, res.usage.output_tokens);
  if (res.stop_reason === "refusal") {
    const details = (res as unknown as { stop_details?: { explanation?: string } }).stop_details;
    throw new Error(`model declined: ${details?.explanation ?? "refusal"}`);
  }
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return Extraction.parse(JSON.parse(json));
}

export async function embed(text: string, itemId: string | null = null): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || MOCK) return null;
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5", input: [text.slice(0, 16000)], input_type: "document", output_dimension: 1024 }),
  });
  if (!r.ok) throw new Error(`voyage ${r.status}: ${await r.text()}`);
  const j = await r.json();
  await logUsage(itemId, "embed", "voyage-3.5", j.usage?.total_tokens ?? 0, 0);
  return j.data[0].embedding as number[];
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || MOCK) return null;
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3.5", input: [text], input_type: "query", output_dimension: 1024 }),
  });
  if (!r.ok) return null;
  return (await r.json()).data[0].embedding as number[];
}

export async function transcribe(audioPath: string, itemId: string | null = null, durationSec = 0): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || MOCK) return null;
  const form = new FormData();
  form.append("file", new Blob([readFileSync(audioPath)]), "audio.mp3");
  form.append("model", "whisper-1");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!r.ok) throw new Error(`whisper ${r.status}: ${await r.text()}`);
  await logUsage(itemId, "transcribe", "whisper-1", 0, 0, (durationSec / 60) * 0.006); // $0.006 per minute
  return (await r.json()).text as string;
}

// Deterministic stand-in so the whole pipeline runs with no keys.
function mockExtract(input: ExtractInput): Extraction {
  const text = [input.metaTitle, input.rawText, input.pageText, input.transcript].filter(Boolean).join(" ").toLowerCase();
  const pick = (words: string[]) => words.filter((w) => text.includes(w));
  const garments = pick(["dress", "pants", "trousers", "skirt", "jumpsuit", "blouse", "shirt", "jacket", "coat", "top", "shorts"]);
  const techniques = pick(["bias", "french seam", "zipper", "buttonhole", "hem", "gather", "pleat", "dart", "smocking", "topstitch", "binding"]);
  const fabrics = pick(["linen", "cotton", "silk", "wool", "denim", "jersey", "gauze", "viscose", "rayon"]);
  const isHowTo = /how to|tutorial|step|tip/.test(text);
  const category = techniques.length && isHowTo ? "tutorial" : garments.length ? "garment" : fabrics.length ? "fabric" : input.imagePaths.length ? "inspiration" : "other";
  return Extraction.parse({
    title: (input.metaTitle || input.rawText || input.url || "Saved item").slice(0, 100),
    summary: `[mock] ${category} saved from ${input.source}${input.imagePaths.length ? ` with ${input.imagePaths.length} image(s)` : ""}.`,
    category,
    action: category === "tutorial" ? "learn" : category === "garment" ? "make" : "inspo",
    tags: Array.from(new Set([input.source, ...garments, ...techniques, ...fabrics])).slice(0, 8),
    garments, techniques, fabrics, colors: [], patterns: [], products: [],
    steps: isHowTo ? ["[mock] steps would be extracted here"] : [],
    creator: input.metaCreator ?? null,
    ocr_text: null,
  });
}
