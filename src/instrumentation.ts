// Runs once when the Node server boots. Soft-catch a known undici/Next stream race that otherwise
// becomes an uncaughtException and kills the Fly machine mid-capture (ReadableStream already closed).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
    const msg = err?.message ?? String(err);
    if (err?.code === "ERR_INVALID_STATE" || /ReadableStream is already closed/i.test(msg)) {
      console.error("[soft] ignoring known stream-closed race:", msg);
      return;
    }
    console.error("uncaughtException", err);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (/ReadableStream is already closed/i.test(msg) || (reason as NodeJS.ErrnoException)?.code === "ERR_INVALID_STATE") {
      console.error("[soft] ignoring known stream-closed rejection:", msg);
      return;
    }
    console.error("unhandledRejection", reason);
  });
}
