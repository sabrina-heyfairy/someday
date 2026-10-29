import "./env";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { intake } from "../src/lib/intake";
import { processQueued } from "../src/lib/pipeline";
import { sql } from "../src/lib/db";

// Backfill screenshots straight from the Photos library.
//   npm run ingest:photos                 export new screenshots, ingest them, run AI
//   npm run ingest:photos -- --count      just say how many screenshots Photos has
//   npm run ingest:photos -- --from 2025-01-01 --no-process
// Needs Full Disk Access for your terminal app (System Settings > Privacy & Security > Full Disk Access).
const OSX = resolve(process.env.OSXPHOTOS_BIN || ".tools/osxphotos/bin/osxphotos");
const EXPORT_DIR = resolve(process.env.PHOTOS_EXPORT_DIR || "./data/photos-export");
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

function run(cmd: string[], inherit = false) {
  const r = spawnSync(OSX, cmd, { encoding: "utf8", stdio: inherit ? "inherit" : "pipe", maxBuffer: 256 * 1024 * 1024 });
  // osxphotos writes fatal errors to a crash log in cwd rather than stderr.
  const crash = "osxphotos_crash.log";
  let err = `${r.stderr ?? ""}${r.stdout ?? ""}`;
  if (existsSync(crash)) { err += readFileSync(crash, "utf8"); rmSync(crash, { force: true }); }
  if (/Operation not permitted|PermissionError/.test(err)) {
    console.error("\nPhotos library is locked to this terminal. Grant Full Disk Access:\n  System Settings > Privacy & Security > Full Disk Access > add your terminal (Terminal, iTerm, or the Claude app), then re-run.\n");
    process.exit(2);
  }
  if (r.status !== 0) { console.error(err.slice(-2000)); process.exit(r.status ?? 1); }
  return r.stdout ?? "";
}

async function main() {
  if (!existsSync(OSX)) { console.error(`osxphotos not found at ${OSX}. Run: python3 -m venv .tools/osxphotos && .tools/osxphotos/bin/pip install osxphotos`); process.exit(1); }
  const from = opt("--from");
  const common = ["--screenshot", ...(from ? ["--from-date", from] : [])];

  if (flag("--count")) {
    const out = run(["query", ...common, "--count"]);
    console.log(`${out.trim()} screenshots in Photos${from ? ` since ${from}` : ""}`);
    await sql.end(); return;
  }

  console.log(`exporting screenshots to ${EXPORT_DIR} (only new ones)...`);
  run(["export", EXPORT_DIR, ...common, "--update", "--skip-edited", "--download-missing", "--sidecar", "json", "--filename", "{uuid}", "--touch-file", "--no-progress"], true);

  const known = new Set((await sql<{ u: string }[]>`select meta->>'photos_uuid' u from items where meta->>'photos_uuid' is not null`).map((r) => r.u));
  const files = readdirSync(EXPORT_DIR).filter((f) => /\.(jpe?g|png|heic|webp)$/i.test(f)).sort();
  let added = 0, dups = 0, skipped = 0;
  for (const f of files) {
    const uuid = f.replace(/\.[^.]+$/, "");
    if (known.has(uuid)) { skipped++; continue; }
    const p = join(EXPORT_DIR, f);
    let date: Date | null = null, original = f;
    try {
      const side = JSON.parse(readFileSync(p + ".json", "utf8"));
      const meta = Array.isArray(side) ? side[0] : side;
      date = meta?.date ? new Date(meta.date) : null; original = meta?.original_filename ?? f;
    } catch { date = statSync(p).mtime; }
    const r = await intake({ image: { buffer: readFileSync(p), filename: original }, channel: "photos", createdAt: date, meta: { photos_uuid: uuid, original_filename: original } });
    r.duplicate ? dups++ : added++;
    process.stdout.write(`\r${added} added, ${dups} duplicates, ${skipped} already imported`);
  }
  console.log(`\n${files.length} exported files scanned.`);
  if (!flag("--no-process")) {
    let total = 0;
    for (;;) { const d = await processQueued(5); if (!d.length) break; total += d.length; process.stdout.write(`\rprocessed ${total}`); }
    console.log("\ndone");
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
