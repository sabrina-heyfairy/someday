import { NextResponse, after } from "next/server";
import { authorized } from "@/lib/auth";
import { intake, type Capture } from "@/lib/intake";
import { scheduleProcess } from "@/lib/process-queue";
import { download } from "@/lib/media";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, unlinkSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Soft cap per image. Phone JPEGs after Shortcut conversion are usually <3 MB; reject giants before OOM. */
const MAX_IMAGE_BYTES = Number(process.env.MAX_CAPTURE_IMAGE_BYTES ?? 12 * 1024 * 1024);
/** Hard cap on images accepted in one HTTP request (multipart batch or images_base64[]). */
const MAX_IMAGES_PER_REQUEST = Number(process.env.MAX_CAPTURE_IMAGES ?? 20);

// One endpoint, three callers:
//   Shortcut:  JSON {url?, text?, image_base64?, images_base64?, filename?}  — one item per request preferred
//              or multipart (fields url/text, file(s) "image"/"file")
//   Twilio:    application/x-www-form-urlencoded webhook (From, Body, NumMedia, MediaUrl0...)
//   Scripts:   same JSON shape
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  const isTwilio = ct.includes("x-www-form-urlencoded") && req.headers.get("x-twilio-signature") !== null;
  if (!isTwilio && !authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let captures: Capture[];
  try {
    if (isTwilio) captures = [await parseTwilio(req)];
    else if (ct.includes("multipart/form-data")) captures = await parseMultipart(req);
    else captures = await parseJson(req);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Truncated bodies (Next/proxy limit) often surface as "Unterminated string in JSON".
    const status = /too large|413|Unterminated string|Unexpected end of JSON|body.*limit/i.test(msg) ? 413 : 400;
    console.error("[capture] parse failed:", msg);
    return NextResponse.json({ error: msg.slice(0, 500) }, { status });
  }

  if (!captures.length) return NextResponse.json({ error: "nothing to save" }, { status: 400 });

  const results: { id: string; duplicate: boolean }[] = [];
  for (const c of captures) {
    try {
      const r = await intake(c);
      results.push({ id: r.id, duplicate: r.duplicate });
    } catch (e) {
      console.error("[capture] intake failed:", e);
      return NextResponse.json({
        error: e instanceof Error ? e.message : String(e),
        saved: results.map((r) => r.id),
      }, { status: 500 });
    }
  }

  const fresh = results.filter((r) => !r.duplicate).length;
  if (fresh > 0) after(() => { scheduleProcess(fresh); });

  if (isTwilio) {
    const dup = results.every((r) => r.duplicate);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${dup ? "Already saved 👌" : "Saved ✨ I'll sort it."}</Message></Response>`;
    return new Response(xml, { headers: { "Content-Type": "text/xml" } });
  }

  if (results.length === 1) {
    return NextResponse.json({ ok: true, id: results[0].id, duplicate: results[0].duplicate, saved: 1 });
  }
  return NextResponse.json({
    ok: true,
    ids: results.map((r) => r.id),
    saved: results.length,
    duplicates: results.filter((r) => r.duplicate).length,
    id: results[0].id,
    duplicate: results.every((r) => r.duplicate),
  });
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);

function decodeBase64Image(b64raw: string, filename: string): { buffer: Buffer; filename: string } {
  const b64 = b64raw.replace(/^data:[^,]+,/, "").trim();
  if (b64.length < 100) throw new Error("empty image");
  const approx = Math.floor((b64.length * 3) / 4);
  if (approx > MAX_IMAGE_BYTES) {
    throw new Error(`image too large (${Math.round(approx / 1e6)}MB > ${Math.round(MAX_IMAGE_BYTES / 1e6)}MB cap)`);
  }
  const buffer = Buffer.from(b64, "base64");
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`image too large (${Math.round(buffer.length / 1e6)}MB)`);
  }
  return { buffer, filename };
}

async function fileToImage(file: File): Promise<{ buffer: Buffer; filename: string }> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`image too large (${Math.round(file.size / 1e6)}MB > ${Math.round(MAX_IMAGE_BYTES / 1e6)}MB cap)`);
  }
  return { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name || "shared.jpg" };
}

/** Build one Capture per image and per URL. Text rides on the first item only. */
function buildCaptures(opts: {
  urls: string[];
  text: string | null;
  images: { buffer: Buffer; filename: string }[];
  channel: Capture["channel"];
  meta?: Record<string, unknown>;
}): Capture[] {
  const { urls, images, channel, meta } = opts;
  let text = opts.text;
  if (text && urls[0] && text === urls[0]) text = null;
  // When the Shortcut coerces an image share to text it yields the file name; that is not a note.
  if (text && images[0] && /^[^\s/]+\.(jpe?g|png|heic|heif|gif|webp|mov|mp4)$/i.test(text)) text = null;

  const out: Capture[] = [];
  if (images.length) {
    for (let i = 0; i < images.length; i++) {
      out.push({
        url: i === 0 ? urls[0] ?? null : null,
        text: i === 0 ? text : null,
        image: images[i],
        channel,
        meta,
      });
    }
    for (let i = 1; i < urls.length; i++) out.push({ url: urls[i], channel, meta });
  } else if (urls.length) {
    for (let i = 0; i < urls.length; i++) {
      out.push({ url: urls[i], text: i === 0 ? text : null, channel, meta });
    }
  } else if (text) {
    out.push({ text, channel, meta });
  }
  return out;
}

async function parseTwilio(req: Request): Promise<Capture> {
  const form = await req.formData();
  if (!twilioSignatureValid(req, form)) throw new Error("bad twilio signature");
  const from = String(form.get("From") ?? "");
  const body = String(form.get("Body") ?? "");
  const n = Number(form.get("NumMedia") ?? 0);
  let image: Capture["image"] = null;
  if (n > 0) {
    const url = String(form.get("MediaUrl0"));
    const type = String(form.get("MediaContentType0") ?? "image/jpeg");
    const tmp = join(tmpdir(), `someday-${process.pid}-${Date.now()}`);
    const auth = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? { user: process.env.TWILIO_ACCOUNT_SID, pass: process.env.TWILIO_AUTH_TOKEN }
      : undefined;
    try {
      await download(url, tmp, auth);
      const buffer = readFileSync(tmp);
      if (buffer.length > MAX_IMAGE_BYTES) throw new Error("MMS image too large");
      image = { buffer, filename: `mms.${type.split("/")[1] ?? "jpg"}` };
    } finally {
      try { unlinkSync(tmp); } catch { /* */ }
    }
  }
  return { text: body, image, channel: "sms", meta: { from } };
}

async function parseMultipart(req: Request): Promise<Capture[]> {
  const form = await req.formData();
  const files = [...form.getAll("image"), ...form.getAll("file"), ...form.getAll("images")]
    .filter((f): f is File => typeof File !== "undefined" && f instanceof File && f.size > 0);
  if (files.length > MAX_IMAGES_PER_REQUEST) {
    throw new Error(`too many images (${files.length} > ${MAX_IMAGES_PER_REQUEST}); send them one at a time`);
  }
  const urlField = str(form.get("url"));
  const urls = urlField ? urlField.split(/\s+/).map((u) => u.trim()).filter(Boolean) : [];
  const text = str(form.get("text"));
  const channel = (str(form.get("channel")) as Capture["channel"]) || "shortcut";

  const images: { buffer: Buffer; filename: string }[] = [];
  for (const f of files) images.push(await fileToImage(f));

  const out = buildCaptures({ urls, text, images, channel });
  if (!out.length) throw new Error("nothing to save");
  return out;
}

async function parseJson(req: Request): Promise<Capture[]> {
  let j: Record<string, unknown>;
  try {
    j = await req.json();
  } catch (e) {
    throw new Error(`invalid JSON body (${e instanceof Error ? e.message : "parse error"})`);
  }

  const channel = (typeof j.channel === "string" && j.channel ? j.channel : "shortcut") as Capture["channel"];
  const filename = typeof j.filename === "string" && j.filename ? j.filename : "shared.jpg";
  const urlRaw = typeof j.url === "string" && j.url.trim() ? j.url.trim() : null;
  const urls = urlRaw ? urlRaw.split(/\s+/).filter(Boolean) : [];
  const text = typeof j.text === "string" && j.text.trim() ? j.text.trim() : null;
  const meta = typeof j.meta === "object" && j.meta ? j.meta as Record<string, unknown> : undefined;

  const images: { buffer: Buffer; filename: string }[] = [];
  if (typeof j.image_base64 === "string" && j.image_base64.trim()) {
    images.push(decodeBase64Image(j.image_base64, filename));
  }
  if (Array.isArray(j.images_base64)) {
    if (j.images_base64.length + images.length > MAX_IMAGES_PER_REQUEST) {
      throw new Error(`too many images (${j.images_base64.length} > ${MAX_IMAGES_PER_REQUEST})`);
    }
    for (let i = 0; i < j.images_base64.length; i++) {
      const raw = j.images_base64[i];
      if (typeof raw !== "string" || !raw.trim()) continue;
      images.push(decodeBase64Image(raw, `shared-${i + 1}.jpg`));
    }
  }

  const out = buildCaptures({ urls, text, images, channel, meta });
  if (!out.length) throw new Error("nothing to save");
  return out;
}

function twilioSignatureValid(req: Request, form: FormData): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return process.env.TWILIO_ALLOW_UNSIGNED === "1";
  const sig = req.headers.get("x-twilio-signature") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const url = `${proto}://${host}${new URL(req.url).pathname}${new URL(req.url).search}`;
  const params = [...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const payload = url + params.map(([k, v]) => k + v).join("");
  const expected = createHmac("sha1", token).update(payload).digest("base64");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
