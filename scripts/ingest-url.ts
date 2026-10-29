import "./env";
import { intake } from "../src/lib/intake";
import { processQueued } from "../src/lib/pipeline";
import { sql } from "../src/lib/db";

async function main() {

// npm run ingest:url -- <url> [text...]
const [url, ...rest] = process.argv.slice(2);
if (!url) { console.error("usage: npm run ingest:url -- <url> [caption]"); process.exit(1); }
const r = await intake({ url, text: rest.join(" ") || null, channel: "api" });
console.log(r.duplicate ? "already saved" : "queued", r.id);
if (!r.duplicate) await processQueued(1);
const [row] = await sql`select status, error, title, category, tags from items where id = ${r.id}`;
console.log(row);
await sql.end();

}
main().catch((e) => { console.error(e); process.exit(1); });
