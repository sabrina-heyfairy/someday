import { NextResponse, after } from "next/server";
import { authorized } from "@/lib/auth";
import { intake, type Capture } from "@/lib/intake";
import { processQueued } from "@/lib/pipeline";
import { download } from "@/lib/media";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";

export const runtime = "nodejs";
export const maxDuration = 300;

// One endpoint, three callers:
//   Shortcut:  JSON {url?, text?, image_base64?, filename?}  or multipart (fields url/text, file "image")
//   Twilio:    application/x-www-form-urlencoded webhook (From, Body, NumMedia, MediaUrl0...)
//   Scripts:   same JSON shape
export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  const isTwilio = ct.includes("x-www-form-urlencoded") && req.headers.get("x-twilio-signature") !== null;
  if (!isTwilio && !authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let c: Capture;
  if (isTwilio) {
    const form = await req.formData();
    const from = String(form.get("From") ?? "");
    const body = String(form.get("Body") ?? "");
    const n = Number(form.get("NumMedia") ?? 0);
    let image: Capture["image"] = null;
    if (n > 0) {
      const url = String(form.get("MediaUrl0"));
      const type = String(form.get("MediaContentType0") ?? "image/jpeg");
      const tmp = join(tmpdir(), `someday-${Date.now()}`);
      const auth = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? { user: process.env.TWILIO_ACCOUNT_SID, pass: process.env.TWILIO_AUTH_TOKEN } : undefined;
      await download(url, tmp, auth);
      image = { buffer: readFileSync(tmp), filename: `mms.${type.split("/")[1] ?? "jpg"}` };
    }
    c = { text: body, image, channel: "sms", meta: { from } };
  } else if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const files = [...form.getAll("image"), ...form.getAll("file")].filter((f): f is File => f instanceof File && f.size > 0);
    const extra = files.slice(1);
    const file = files[0];
    const image = file ? { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name } : null;
    // Shortcuts' "Get URLs from Input" may hand back several links, one per line; the first is the one being shared.
    const urlField = str(form.get("url"));
    const url = urlField ? urlField.split(/\s+/)[0] : null;
    let text = str(form.get("text"));
    if (text && url && text.trim() === url) text = null;           // Shortcut Input rendered as text is just the URL again
    if (text && image && /^IMG_\d+\.(jpe?g|png|heic)$/i.test(text)) text = null; // ...or the image filename
    c = { url, text, image, channel: (str(form.get("channel")) as Capture["channel"]) || "shortcut" };
    // Several images shared at once: queue the rest too.
    for (const f of extra) intake({ image: { buffer: Buffer.from(await f.arrayBuffer()), filename: f.name }, channel: c.channel }).catch(() => {});
  } else {
    const j = await req.json().catch(() => ({}));
    const image = j.image_base64 ? { buffer: Buffer.from(String(j.image_base64).replace(/^data:[^,]+,/, ""), "base64"), filename: j.filename } : null;
    c = { url: j.url, text: j.text, image, channel: j.channel || "shortcut", meta: j.meta };
  }

  if (!c.url && !c.text && !c.image) return NextResponse.json({ error: "nothing to save" }, { status: 400 });
  const { id, duplicate } = await intake(c);

  // Process inline unless a worker is running; keeps the single-user path simple.
  // Process after the response is sent (survives on serverless hosts). Set INLINE_PROCESS=0 when running `npm run worker`.
  if (!duplicate && process.env.INLINE_PROCESS !== "0") after(() => processQueued(1).catch((e) => console.error(e)));

  if (isTwilio) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${duplicate ? "Already saved 👌" : "Saved ✨ I'll sort it."}</Message></Response>`;
    return new Response(xml, { headers: { "Content-Type": "text/xml" } });
  }
  return NextResponse.json({ ok: true, id, duplicate });
}

const str = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);
