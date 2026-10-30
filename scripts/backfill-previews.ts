import "./env";
import { sql } from "../src/lib/db";
import { attachPreview } from "../src/lib/pipeline";

/*
  Fetch a picture for every link item that has none (archive imports, failed fetches).

    npm run previews                 # items never tried, or tried more than 7 days ago
    npm run previews -- --force      # retry everything without a thumbnail
    npm run previews -- --limit 20
*/

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limit = Number(args[args.indexOf("--limit") + 1]) || 500;
  const rows = await sql<{ id: string; source: string }[]>`
    select id, source from items
    where url is not null and duplicate_of is null and archived = false
      and coalesce(media->>'thumbnail', '') = ''
      and (${force} or coalesce((meta->>'preview_tried')::timestamptz, 'epoch') < now() - interval '7 days')
    order by created_at desc limit ${limit}`;
  console.log(`previews: ${rows.length} item(s) to try`);
  const tally: Record<string, number> = {};
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const row = rows[i++];
      const r = await attachPreview(row.id).catch((e) => { console.error(`[${row.id}] ${e instanceof Error ? e.message : e}`); return "error"; });
      tally[`${row.source}:${r}`] = (tally[`${row.source}:${r}`] ?? 0) + 1;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  console.table(tally);
  await sql.end();
}
main();
