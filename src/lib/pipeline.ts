import { existsSync } from "node:fs";
import { join } from "node:path";
import { embed, extract, transcribe } from "./ai";
import { sql, type Item } from "./db";
import { dhash, download, extractAudio, itemDir, keyframes, MEDIA_DIR, pageInfo, rel, toJpeg, ytDownload, ytMeta } from "./media";

// Claim up to `limit` queued items and process them one at a time.
export async function processQueued(limit = 3): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    update items set status = 'processing'
    where id in (select id from items where status = 'queued' and duplicate_of is null order by created_at limit ${limit} for update skip locked)
    returning id`;
  const done: string[] = [];
  for (const { id } of rows) {
    try { await processItem(id); done.push(id); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`update items set status = 'failed', error = ${msg.slice(0, 2000)} where id = ${id}`;
      console.error(`[${id}] failed:`, msg);
    }
  }
  return done;
}

export async function processItem(id: string) {
  const [item] = await sql<Item[]>`select * from items where id = ${id}`;
  if (!item) throw new Error("item not found");
  const dir = itemDir(id);
  const media: Item["media"] = { ...item.media };
  const meta: Record<string, unknown> = { ...item.meta };
  const images: string[] = [];
  let transcript: string | null = null;
  let pageText: string | null = null;
  let metaTitle: string | null = null;
  let metaCreator: string | null = null;
  let kind = item.kind;

  // 1. Saved screenshot / photo
  if (media.original) {
    const abs = join(MEDIA_DIR, media.original);
    if (existsSync(abs)) {
      const jpg = await toJpeg(abs, join(dir, "image.jpg"));
      images.push(jpg);
      media.thumbnail = rel(jpg);
    }
  }

  // 2. Link: try yt-dlp (video), fall back to page scrape
  if (item.url) {
    const yt = await ytMeta(item.url);
    if (yt && (yt.duration || yt.formats?.length)) {
      meta.yt = { title: yt.title, description: yt.description, uploader: yt.uploader, uploader_id: yt.uploader_id, channel: yt.channel, duration: yt.duration, extractor: yt.extractor_key };
      metaTitle = yt.title ?? null;
      metaCreator = yt.uploader_id ? `@${yt.uploader_id}` : yt.uploader ?? yt.channel ?? null;
      pageText = yt.description ?? null;
      const video = await ytDownload(item.url, dir);
      if (video) {
        kind = "video";
        media.video = rel(video);
        const frames = await keyframes(video, dir, yt.duration);
        images.push(...frames);
        media.frames = frames.map(rel);
        if (frames[0]) media.thumbnail = rel(frames[0]);
        const audio = await extractAudio(video, dir);
        if (audio) { media.audio = rel(audio); transcript = await transcribe(audio, id, yt.duration ?? 0); }
      } else if (yt.thumbnail) {
        await pullImage(yt.thumbnail, dir, images, media);
      }
    } else {
      const info = await pageInfo(item.url);
      if (info.error && !info.title) throw new Error(`could not read page: ${info.error}`);
      meta.page = { title: info.title, description: info.description, author: info.author };
      metaTitle = info.title ?? null;
      metaCreator = info.author ?? null;
      pageText = [info.description, info.text].filter(Boolean).join("\n\n") || null;
      if (info.image && !media.thumbnail) await pullImage(info.image, dir, images, media);
    }
  }

  // 2b. Fingerprint the picture we'll show, so a later screenshot of the same thing is caught as a near-duplicate.
  if (media.thumbnail && !item.phash) {
    const h = await dhash(join(MEDIA_DIR, media.thumbnail));
    if (h) await sql`update items set phash = ${h}::bit(64) where id = ${id}`;
  }

  // 3. Understand it
  const tier = item.channel === "folder" || item.channel === "photos" ? "bulk" : "live";
  const ex = await extract({ itemId: id, tier, url: item.url, source: item.source, rawText: item.raw_text, pageText, transcript, imagePaths: images, metaTitle, metaCreator });
  const embedText = [ex.title, ex.summary, ex.tags.join(" "), ex.garments.join(" "), ex.techniques.join(" "), ex.fabrics.join(" "), ex.ocr_text, item.raw_text, transcript?.slice(0, 4000)].filter(Boolean).join("\n");
  const vec = await embed(embedText, id);

  await sql`update items set
    status = 'done', error = null, processed_at = now(), kind = ${kind},
    title = ${ex.title}, creator = ${ex.creator ?? metaCreator}, summary = ${ex.summary},
    category = ${ex.category}, action = ${ex.action}, tags = ${ex.tags}, garments = ${ex.garments},
    techniques = ${ex.techniques}, fabrics = ${ex.fabrics}, colors = ${ex.colors},
    patterns = ${sql.json(ex.patterns as never)}, products = ${sql.json(ex.products as never)}, steps = ${ex.steps},
    transcript = ${transcript}, ocr_text = ${ex.ocr_text},
    media = ${sql.json(media as never)}, meta = ${sql.json(meta as never)},
    embedding = ${vec ? JSON.stringify(vec) : null}
    where id = ${id}`;
}

async function pullImage(url: string, dir: string, images: string[], media: Item["media"]) {
  try {
    const raw = join(dir, "thumb_src");
    await download(url, raw);
    const jpg = await toJpeg(raw, join(dir, "thumb.jpg"), 768);
    images.push(jpg);
    media.thumbnail = rel(jpg);
  } catch { /* no thumbnail, fine */ }
}
