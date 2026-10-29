import "./env";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { intake } from "../src/lib/intake";
import { processQueued } from "../src/lib/pipeline";
import { sql } from "../src/lib/db";

async function main() {

// Backfill: npm run ingest:folder -- ~/Desktop/screenshots [--no-process]
// Export screenshots from Photos first (Photos > Media Types > Screenshots > select all > File > Export).
const dir = process.argv[2];
const noProcess = process.argv.includes("--no-process");
if (!dir) { console.error("usage: npm run ingest:folder -- <dir> [--no-process]"); process.exit(1); }
const exts = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);
const files = readdirSync(dir).filter((f) => exts.has(extname(f).toLowerCase())).sort();
let added = 0, dups = 0;
for (const f of files) {
  const p = join(dir, f);
  const r = await intake({ image: { buffer: readFileSync(p), filename: f }, channel: "folder", meta: { file: f, mtime: statSync(p).mtime.toISOString() } });
  r.duplicate ? dups++ : added++;
  process.stdout.write(`\r${added} added, ${dups} duplicates`);
}
console.log(`\n${files.length} files scanned.`);
if (!noProcess) {
  let total = 0;
  for (;;) { const d = await processQueued(5); if (!d.length) break; total += d.length; process.stdout.write(`\rprocessed ${total}`); }
  console.log("\ndone");
}
await sql.end();

}
main().catch((e) => { console.error(e); process.exit(1); });
