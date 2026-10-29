import "./env";
import { sql } from "../src/lib/db";
import { processItem } from "../src/lib/pipeline";

// npm run retry  — re-run the pipeline on every failed item (and anything stuck in 'processing').
async function main() {
  const rows = await sql<{ id: string }[]>`select id from items where status in ('failed','processing') order by created_at`;
  console.log(`${rows.length} to retry`);
  for (const { id } of rows) {
    try { await processItem(id); console.log("ok  ", id); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); await sql`update items set status='failed', error=${m.slice(0,2000)} where id=${id}`; console.log("fail", id, m); }
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
