import "./env";
import { runAllSources } from "../src/lib/sources";

// Standalone scheduler: pulls Pinterest boards and Reddit saved posts every SYNC_INTERVAL_HOURS.
// Started next to the web server in the Docker image; run `npm run scheduler` locally if you want it on your laptop.
const hours = Number(process.env.SYNC_INTERVAL_HOURS ?? 24);
if (process.env.SYNC_DISABLED === "1") { console.log("[sync] disabled"); process.exit(0); }
const tick = async () => {
  try { const r = await runAllSources(); console.log(`[sync] ${new Date().toISOString()} ${r.length ? JSON.stringify(r) : "no sources"}`); }
  catch (e) { console.error("[sync] failed", e); }
};
console.log(`[sync] scheduled every ${hours}h, first run in 2 minutes`);
setTimeout(tick, 2 * 60 * 1000);
setInterval(tick, hours * 60 * 60 * 1000);
