import "./env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: /supabase\.(co|com)/.test(process.env.DATABASE_URL ?? "") ? "require" : undefined });
const dir = join(process.cwd(), "supabase", "migrations");

async function main() {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`;
  const applied = new Set((await sql`select name from _migrations`).map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(f)) continue;
    process.stdout.write(`applying ${f}... `);
    await sql.unsafe(readFileSync(join(dir, f), "utf8"));
    await sql`insert into _migrations (name) values (${f})`;
    console.log("ok");
  }
  console.log("migrations up to date");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
