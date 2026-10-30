import "./env";
import { runAllSources } from "../src/lib/sources";
import { processQueued } from "../src/lib/pipeline";

// Standalone scheduler: pulls Pinterest boards and Reddit saved posts every SYNC_INTERVAL_HOURS,
// and also drains any leftover queued items (e.g. if the web process restarted mid-after()).
// Started next to the web server in the Docker image; run `npm run scheduler` locally if you want it on your laptop.
const hours = Number(process.env.SYNC_INTERVAL_HOURS ?? 24);
if (process.env.SYNC_DISABLED === "1") { console.log("[sync] disabled"); process.exit(0); }

const drainQueue = async () => {
  try {
    let n = 0;
    for (;;) {
      const done = await processQueued(3);
      if (!done.length) break;
      n += done.length;
    }
    if (n) console.log(`[queue] drained ${n} item(s)`);
  } catch (e) { console.error("[queue] drain failed", e); }
};

const tick = async () => {
  try { const r = await runAllSources(); console.log(`[sync] ${new Date().toISOString()} ${r.length ? JSON.stringify(r) : "no sources"}`); }
  catch (e) { console.error("[sync] failed", e); }
  await drainQueue();
};
console.log(`[sync] scheduled every ${hours}h, first run in 2 minutes; queue drain every 5 minutes`);
setTimeout(tick, 2 * 60 * 1000);
setInterval(tick, hours * 60 * 60 * 1000);
setInterval(drainQueue, 5 * 60 * 1000);
setTimeout(drainQueue, 30_000);
