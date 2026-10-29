import "./env";
import { join } from "node:path";
import { sql } from "../src/lib/db";
import { dhash, MEDIA_DIR } from "../src/lib/media";

// npm run rehash — compute perceptual hashes for items that predate near-duplicate detection.
async function main() {
  const rows = await sql<{ id: string; thumb: string }[]>`select id, media->>'thumbnail' thumb from items where phash is null and media->>'thumbnail' is not null`;
  let n = 0;
  for (const r of rows) { const h = await dhash(join(MEDIA_DIR, r.thumb)); if (h) { await sql`update items set phash = ${h}::bit(64) where id = ${r.id}`; n++; } }
  console.log(`${rows.length} candidates, ${n} hashed`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
