import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "./db";
import { canonicalize, detectSource, dhash, itemDir, rel, resolveShortLink, sha256, toJpeg } from "./media";
import { syncItemDir } from "./storage";
import { join as pjoin } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync } from "node:fs";

// Hamming distance at or below this = same picture (0 identical, 10 clearly different).
export const NEAR_DUP_THRESHOLD = Number(process.env.NEAR_DUP_THRESHOLD ?? 8);

export type Capture = {
  url?: string | null;
  text?: string | null;
  image?: { buffer: Buffer; filename?: string } | null;
  channel: "shortcut" | "sms" | "folder" | "photos" | "import" | "api";
  meta?: Record<string, unknown>;
  createdAt?: Date | null;   // original capture time (e.g. Photos date) so the archive keeps its timeline
};

const URL_RE = /https?:\/\/[^\s<>"']+/i;

// Turn whatever arrived into one queued item (or return the existing duplicate).
export async function intake(c: Capture): Promise<{ id: string; duplicate: boolean; near?: boolean }> {
  let url = c.url?.trim() || null;
  let text = c.text?.trim() || null;
  if (!url && text) {
    const m = text.match(URL_RE);
    if (m) { url = m[0]; text = text.replace(m[0], "").trim() || null; }
  }
  if (url) url = await resolveShortLink(url);
  const kind = c.image ? "image" : url ? "link" : "text";
  const canonical = url ? safeCanonical(url) : null;
  const urlHash = canonical ? sha256(Buffer.from(canonical)) : null;
  const imageHash = c.image ? sha256(c.image.buffer) : null;
  const source = detectSource(url, kind);

  if (urlHash) {
    const [dup] = await sql<{ id: string; has_image: boolean }[]>`select id, (image_hash is not null or (media->>'original') is not null) has_image from items where url_hash = ${urlHash}`;
    if (dup) {
      // Keep any new note, but don't stack the same text twice.
      if (text) await sql`update items set raw_text = trim(coalesce(raw_text,'') || E'\n' || ${text}) where id = ${dup.id} and coalesce(raw_text,'') not like ${"%" + text + "%"}`;
      // Same link, but this time with a picture the saved item lacks (the Shortcut posts the link first, then the
      // image with the link attached): keep the picture and re-run processing instead of dropping it.
      if (c.image && !dup.has_image) {
        const ph = await hashImageBuffer(c.image.buffer, c.image.filename);
        await sql`update items set image_hash = ${imageHash}, phash = ${ph ? sql`${ph}::bit(64)` : null}, status = 'queued', error = null where id = ${dup.id}`;
        await saveOriginal(dup.id, c.image);
        return { id: dup.id, duplicate: false };
      }
      return { id: dup.id, duplicate: true };
    }
  }
  let phash: string | null = null;
  if (imageHash) {
    const [dup] = await sql`select id from items where image_hash = ${imageHash}`;
    if (dup) return { id: dup.id, duplicate: true };
    phash = await hashImageBuffer(c.image!.buffer, c.image!.filename);
    if (phash) {
      const [near] = await sql<{ id: string; d: number }[]>`
        select id, bit_count(phash # ${phash}::bit(64)) d from items
        where phash is not null and duplicate_of is null and bit_count(phash # ${phash}::bit(64)) <= ${NEAR_DUP_THRESHOLD}
        order by d limit 1`;
      if (near) {
        // Keep the bytes (it might be a better crop) but file it under the original and skip AI.
        const [row] = await sql`
          insert into items (source, kind, channel, url, image_hash, phash, raw_text, meta, status, duplicate_of, created_at)
          values (${source}, ${kind}, ${c.channel}, ${url}, ${imageHash}, ${phash}::bit(64), ${text}, ${sql.json((c.meta ?? {}) as never)}, 'done', ${near.id}, ${c.createdAt ?? new Date()})
          returning id`;
        await saveOriginal(row.id, c.image!);
        if (text) await sql`update items set raw_text = trim(coalesce(raw_text,'') || E'\n' || ${text}) where id = ${near.id} and coalesce(raw_text,'') not like ${"%" + text + "%"}`;
        return { id: near.id, duplicate: true, near: true };
      }
    }
  }

  // The Shortcut POSTs the links and the pictures of one share as separate requests. Pair them back together so a
  // TikTok/Instagram share with a poster image becomes ONE item that has both the picture and the "Open on" link.
  if (c.channel === "shortcut") {
    const paired = await pairShortcutHalves({ url, canonical, urlHash, text, image: c.image ?? null, imageHash, phash, source });
    if (paired) return { id: paired, duplicate: false };
  }

  try {
    const [row] = await sql`
      insert into items (source, kind, channel, url, canonical_url, url_hash, image_hash, phash, raw_text, meta, created_at)
      values (${source}, ${kind}, ${c.channel}, ${url}, ${canonical}, ${urlHash}, ${imageHash}, ${phash ? sql`${phash}::bit(64)` : null}, ${text}, ${sql.json((c.meta ?? {}) as never)}, ${c.createdAt ?? new Date()})
      returning id`;

    if (c.image) await saveOriginal(row.id, c.image);
    return { id: row.id, duplicate: false };
  } catch (e) {
    // Parallel Shortcut POSTs of the same bytes can race past the pre-insert SELECT and hit the unique index.
    const code = (e as { code?: string })?.code;
    if (code === "23505") {
      if (imageHash) {
        const [dup] = await sql<{ id: string }[]>`select id from items where image_hash = ${imageHash} limit 1`;
        if (dup) return { id: dup.id, duplicate: true };
      }
      if (urlHash) {
        const [dup] = await sql<{ id: string }[]>`select id from items where url_hash = ${urlHash} limit 1`;
        if (dup) return { id: dup.id, duplicate: true };
      }
    }
    throw e;
  }
}

async function pairShortcutHalves(h: { url: string | null; canonical: string | null; urlHash: string | null; text: string | null;
  image: { buffer: Buffer; filename?: string } | null; imageHash: string | null; phash: string | null; source: string }): Promise<string | null> {
  if (h.image && !h.url) {
    // A picture with no link: is there a link-only item from the Shortcut moments ago that has no picture yet?
    const [m] = await sql<{ id: string }[]>`select id from items where channel = 'shortcut' and url is not null and image_hash is null
      and (media->>'original') is null and duplicate_of is null and created_at > now() - interval '90 seconds' order by created_at desc limit 1`;
    if (!m) return null;
    await sql`update items set image_hash = ${h.imageHash}, phash = ${h.phash ? sql`${h.phash}::bit(64)` : null}, status = 'queued', error = null where id = ${m.id}`;
    await saveOriginal(m.id, h.image);
    return m.id;
  }
  if (h.url && !h.image) {
    // A link with no picture: is there a picture-only item from the Shortcut moments ago?
    const [m] = await sql<{ id: string }[]>`select id from items where channel = 'shortcut' and url is null and image_hash is not null
      and duplicate_of is null and created_at > now() - interval '90 seconds' order by created_at desc limit 1`;
    if (!m) return null;
    await sql`update items set url = ${h.url}, canonical_url = ${h.canonical}, url_hash = ${h.urlHash}, source = ${h.source},
      raw_text = case when ${h.text}::text is null then raw_text else trim(coalesce(raw_text,'') || E'\n' || ${h.text}) end,
      status = 'queued', error = null where id = ${m.id}`;
    return m.id;
  }
  return null;
}

async function saveOriginal(id: string, image: { buffer: Buffer; filename?: string }) {
  const ext = (image.filename?.split(".").pop() || "jpg").toLowerCase().replace("jpeg", "jpg");
  const p = join(itemDir(id), `original.${ext}`);
  writeFileSync(p, image.buffer);
  await sql`update items set media = media || ${sql.json({ original: rel(p) })} where id = ${id}`;
  // Persist the original right away so a crash before processing can't lose it; keep the local copy for the pipeline.
  await syncItemDir(id, { dropLocal: false }).catch((e) => console.error("storage sync failed", e));
}

async function hashImageBuffer(buf: Buffer, filename?: string): Promise<string | null> {
  const ext = (filename?.split(".").pop() || "jpg").toLowerCase();
  const tmp = pjoin(tmpdir(), `someday-${process.pid}-${Date.now()}.${ext}`);
  const jpg = tmp + ".jpg";
  try {
    writeFileSync(tmp, buf);
    await toJpeg(tmp, jpg, 256);
    return await dhash(jpg);
  } catch { return null; }
  finally { for (const f of [tmp, jpg, jpg.replace(/\.jpg$/, ".heic.jpg")]) { try { unlinkSync(f); } catch { /* */ } } }
}

function safeCanonical(u: string) { try { return canonicalize(u); } catch { return u; } }
