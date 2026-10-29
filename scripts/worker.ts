import "./env";
import { processQueued } from "../src/lib/pipeline";

// Long-running worker: drains the queue, then polls. Run with INLINE_PROCESS=0 on the web side.
const every = Number(process.env.WORKER_INTERVAL_MS ?? 5000);
async function loop() {
  for (;;) {
    const done = await processQueued(3).catch((e) => { console.error(e); return []; });
    if (done.length) console.log(`processed ${done.length}: ${done.join(", ")}`);
    else await new Promise((r) => setTimeout(r, every));
  }
}
loop();
