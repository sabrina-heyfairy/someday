import "./env";
import { sql } from "../src/lib/db";

/*
  Smoke-test /api/capture with many images (simulates the fixed Shortcut: one POST each,
  plus one batched multipart). Requires the web server already running.

    CAPTURE_TOKEN=… BASE=http://localhost:3000 npx tsx scripts/test-multi-capture.ts
*/

const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.CAPTURE_TOKEN ?? "";
if (!TOKEN || TOKEN === "change-me") {
  console.error("Set CAPTURE_TOKEN to the running server's token");
  process.exit(1);
}

/** Distinct tiny JPEG-ish buffers (unique sha256) so dedupe doesn't collapse the batch. */
function fakeJpeg(seed: number): Buffer {
  const buf = Buffer.alloc(256, 0);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff; buf[3] = 0xd9; // SOI…EOI-ish marker pair at ends
  buf.writeUInt32BE(seed >>> 0, 8);
  buf.write(`seed-${seed}-${Date.now()}`, 16);
  return buf;
}

async function postJson(body: unknown) {
  const r = await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function postMultipart(files: Buffer[]) {
  const fd = new FormData();
  files.forEach((buf, i) => fd.append("image", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), `shot-${i}.jpg`));
  fd.append("channel", "shortcut");
  const r = await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

async function health() {
  const r = await fetch(`${BASE}/api/health`);
  return r.json();
}

async function main() {
  const before = await health();
  if (!before.ok) throw new Error(`health not ok before test: ${JSON.stringify(before)}`);

  const ids: string[] = [];
  const stamp = Date.now();
  // Simulate fixed Shortcut: 10 sequential single-image POSTs
  for (let i = 0; i < 10; i++) {
    const { status, j } = await postJson({
      image_base64: fakeJpeg(stamp + i).toString("base64"),
      filename: `multi-${stamp}-${i}.jpg`,
      channel: "shortcut",
    });
    if (status !== 200 || !j.ok || !j.id) throw new Error(`single POST ${i} failed: ${status} ${JSON.stringify(j)}`);
    if (j.duplicate) throw new Error(`single POST ${i} unexpectedly duplicate`);
    ids.push(j.id);
  }

  // Also accept a multipart batch of 5 in one request (server splits them).
  const { status, j } = await postMultipart(Array.from({ length: 5 }, (_, i) => fakeJpeg(stamp + 100 + i)));
  if (status !== 200 || !j.ok || j.saved !== 5) throw new Error(`multipart batch failed: ${status} ${JSON.stringify(j)}`);
  ids.push(...(j.ids as string[]));

  // Oversize / truncated body should 413 (or be rejected), not crash the process.
  const huge = Buffer.alloc(13 * 1024 * 1024, 0xff);
  const over = await postJson({ image_base64: huge.toString("base64"), filename: "huge.jpg", channel: "shortcut" });
  if (over.status !== 413 && over.status !== 400) {
    throw new Error(`expected 413/400 for huge image, got ${over.status} ${JSON.stringify(over.j)}`);
  }
  // Multipath oversize via multipart (exact byte cap, no JSON truncation ambiguity).
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(huge)], { type: "image/jpeg" }), "huge.jpg");
  const overMp = await fetch(`${BASE}/api/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  if (overMp.status !== 413) throw new Error(`expected 413 for huge multipart, got ${overMp.status} ${await overMp.text()}`);

  const after = await health();
  if (!after.ok) throw new Error(`health not ok after test: ${JSON.stringify(after)}`);

  const unique = new Set(ids);
  if (unique.size !== ids.length) throw new Error(`expected ${ids.length} distinct ids, got ${unique.size}`);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from items where id in ${sql(ids)}`;
  if (n !== ids.length) throw new Error(`expected ${ids.length} rows in db, got ${n}`);
  console.log(`ok: saved ${ids.length} distinct captures, health ok`);
  await sql.end({ timeout: 1 });
}

main().catch(async (e) => {
  console.error(e);
  try { await sql.end({ timeout: 1 }); } catch { /* */ }
  process.exit(1);
});
