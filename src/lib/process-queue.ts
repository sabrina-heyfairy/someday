import { processQueued } from "./pipeline";

// Serialize inline AI/ffmpeg work so a burst of captures (e.g. 10 Photos from the Shortcut)
// cannot run 10 pipelines at once and OOM the Fly machine.
let chain: Promise<void> = Promise.resolve();

/** Enqueue draining up to `n` queued items onto a single serial chain. */
export function scheduleProcess(n = 1): void {
  if (process.env.INLINE_PROCESS === "0") return;
  const limit = Math.max(1, n);
  chain = chain
    .then(async () => {
      let left = limit;
      while (left > 0) {
        const done = await processQueued(Math.min(left, 2));
        if (!done.length) break;
        left -= done.length;
      }
    })
    .catch((e) => {
      console.error("[process-queue]", e);
    });
}
