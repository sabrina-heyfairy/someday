// Runs once when the Next.js server starts. Schedules the source sync (Pinterest boards, Reddit saved) in-process.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SYNC_DISABLED === "1") return;
  const hours = Number(process.env.SYNC_INTERVAL_HOURS ?? 24);
  const { runAllSources } = await import("./lib/sources");
  const tick = async () => {
    try { const r = await runAllSources(); if (r.length) console.log("[sync]", JSON.stringify(r)); }
    catch (e) { console.error("[sync] failed", e); }
  };
  setTimeout(tick, 2 * 60 * 1000).unref();                       // first pass shortly after boot
  setInterval(tick, hours * 60 * 60 * 1000).unref();            // then on the schedule
  console.log(`[sync] scheduled every ${hours}h`);
}
