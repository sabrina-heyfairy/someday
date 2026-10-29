# Someday

*Someday is now searchable.*

Everything you save from Instagram, TikTok, Facebook, Reddit, YouTube and your screenshots, in one searchable place. Share it and forget it. Someday fetches the post, watches the video, reads the on-screen text, and files it so you can find it later with plain words ("wide leg linen pants", "how did they do that bias binding").

## How it works

```
Share Sheet / SMS / folder  →  POST /api/capture  →  items row (queued)
                                                       ↓
   yt-dlp + ffmpeg (video, 8 keyframes, audio) → Whisper (transcript)
   page scrape (Reddit JSON, og tags)           → Claude vision + extraction → tags, category,
   saved screenshot                                 garments, techniques, patterns, products, steps
                                                       ↓
                              Postgres (full text + pgvector)  →  web app: grid, filters, search, detail
```

One table, `items`, plus `ai_usage` for the cost log. Status goes `queued → processing → done | failed`. Duplicates are caught three ways: canonical URL (youtu.be vs youtube.com, reel vs /p/, old.reddit, tracking params), exact image hash, and a perceptual hash so the same reel screenshotted twice, with a different status bar or slightly scrolled, files under the first copy instead of becoming a new item. Near-duplicates keep their bytes (shown on the original's page as "Saved N times") and skip AI.

**Model tiering.** Live saves (share sheet, SMS, the Add page) use `ANTHROPIC_MODEL` (Sonnet 5.5). Bulk backfill from folders or Photos uses `ANTHROPIC_MODEL_BULK` (Haiku 5.5, about 20x cheaper). Every call is logged to `ai_usage` with tokens and estimated dollars, and the grid footer shows spend this month and all time.

## Run it locally

Requirements: Node 22+, Postgres 17 with pgvector, `ffmpeg`, `yt-dlp` (all via Homebrew).

```bash
brew install postgresql@17 pgvector ffmpeg yt-dlp
brew services start postgresql@17
createdb someday && psql -d someday -c 'create extension vector'
cp .env.example .env.local        # set CAPTURE_TOKEN to something long
npm install
npm run db:migrate
npm run dev                       # http://localhost:3000
```

`MOCK_AI=1` (the default in `.env.example`) runs the whole pipeline with stubbed AI so you can test capture without any keys. To get real understanding of your saves, set `MOCK_AI=0` and add:

| Key | Used for | Skip it? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Reading frames and screenshots, extracting tags, patterns, steps | No, this is the brain |
| `OPENAI_API_KEY` | Whisper transcription of video audio | Yes, you lose spoken content |
| `VOYAGE_API_KEY` | Embeddings for semantic search ("pants like these") | Yes, keyword search still works |

## Ways to save

**1. iPhone Share Sheet (the main one).** Easiest: generate and sign the shortcut, then AirDrop it to your phone.

```bash
npm run shortcut -- https://YOUR-HOST YOUR_CAPTURE_TOKEN
```

That writes `Save to Someday.shortcut`, signed so iOS accepts it. Signing needs a Mac that is signed into iCloud (no developer account). It pulls links and images out of whatever you share, sends them as JSON to `/api/capture`, and pops a "Saved ✨" notification. Open the file on the Mac or AirDrop it; iOS shows an Add Shortcut screen.

Or build it by hand in the Shortcuts app:

1. New Shortcut. Tap the (i) and turn on **Show in Share Sheet**. Accept: URLs, Images, Text, Safari web pages.
2. Add action **Get Contents of URL**
   - URL: `https://YOUR-HOST/api/capture`
   - Method: `POST`
   - Headers: `Authorization` = `Bearer YOUR_CAPTURE_TOKEN`
   - Request Body: **Form**
     - `url` → Shortcut Input (it's empty when you share an image, that's fine)
     - `image` → Shortcut Input (file)
3. Optional: add **Ask for Input** before it with the prompt "Note?" and pass that as `text`.
4. Name it "Save to Someday". It now appears when you tap Share in Instagram, TikTok, Reddit, Safari and Photos.

**Instagram and TikTok tip:** sharing a Reel gives Someday the link, and it will fetch the video when the post is public. Private or login-only posts cannot be fetched, so for those, screenshot then share the screenshot. Someday reads the screenshot.

**2. Text it.** Buy a Twilio number, set its Messaging webhook to `POST https://YOUR-HOST/api/capture`, and put `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` in env so MMS photos can be downloaded. Text a link or a photo, get "Saved ✨" back.

**3. Backfill your dead screenshots, straight from Photos.**

```bash
npm run ingest:photos -- --count        # how many screenshots are in the library
npm run ingest:photos                   # export new ones, ingest, run AI (Haiku tier)
npm run ingest:photos -- --from 2025-01-01 --no-process
```

This reads the Photos library with [osxphotos](https://github.com/RhetTbull/osxphotos) (installed into `.tools/osxphotos`), exports only screenshots it hasn't seen, pulls iCloud-only originals down, keeps each photo's original date as the item's saved date, and feeds them in. The first run asks for **Full Disk Access** for your terminal app (System Settings → Privacy & Security → Full Disk Access). Re-running only picks up new screenshots.

Manual alternative: export from Photos yourself (Media Types → Screenshots → select all → File → Export → Unmodified Original) and run `npm run ingest:folder -- <dir>`. HEIC is converted with `sips`.

Cost check: a thousand screenshots through Haiku 5.5 with one image each is roughly a dollar or two.

**4. Desktop.** The `/add` page, or `npm run ingest:url -- <url>`. On Android and desktop Chrome the installed app also registers as a share target, so "Share → Someday" lands on `/add` prefilled.

## The to-make board

`/make` is a four-column board: Want to make, Fabric bought, In progress, Done. Anything the AI tags with action "make" appears in the first column automatically; add anything else from its item page. Tap the arrows on a card to move it, × to take it off the board. Each card shows how long it has sat in its column. This is the "I saved it and never did anything" fix.

## On your phone

Open the site in Safari, tap Share → **Add to Home Screen**. It installs as a full-screen app with its own icon. Set `APP_PASSWORD` before exposing the site; you log in once and the cookie lasts a year. The Shortcut and the SMS webhook use the capture token, not the password, so they keep working.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Web app + inline processing |
| `npm run worker` | Separate queue worker (set `INLINE_PROCESS=0` on the web side) |
| `npm run ingest:photos` | Backfill screenshots from the Photos library |
| `npm run ingest:folder -- <dir>` | Backfill a folder of images |
| `npm run retry` | Re-run failed or stuck items |
| `npm run rehash` | Compute perceptual hashes for items that predate dedupe |
| `npm run hash:compare -- <dir>` | Print hash distances vs `orig.*` in a folder, for tuning `NEAR_DUP_THRESHOLD` |
| `npm run ingest:url -- <url> [note]` | Save one link from the terminal |
| `npm run shortcut -- <host> <token>` | Build and sign the Save to Someday iOS Shortcut |
| `POST /api/process?token=…&limit=5` | Cron-friendly processing endpoint |
| `GET /api/items?token=…&q=…` | JSON search, for a future native app or Shortcut |

## Deploying

Target: Fly.io for the app (it needs ffmpeg and yt-dlp, so a container host), Supabase for Postgres and media. Everything below is in the repo; you create the two accounts.

**1. Database (Supabase).** Create a project. In Project Settings → Database, copy the **Session pooler** connection string (port 5432) for migrations and the **Transaction pooler** string (port 6543) for the app; both work with this code. Then from your laptop:

```bash
DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres' npm run db:migrate
```

**2. Media bucket (Supabase).** Storage → New bucket → name `media`, **private**. Copy Project URL and the `service_role` key from Project Settings → API.

**3. App (Fly.io).**

```bash
brew install flyctl && fly auth login
fly apps create someday-stash            # or edit `app` in fly.toml to a name you like
fly volumes create data --size 10 --region sjc
fly secrets set \
  DATABASE_URL='postgresql://postgres.xxxx:PASSWORD@aws-0-us-east-1.pooler.supabase.com:6543/postgres' \
  CAPTURE_TOKEN="$(openssl rand -hex 24)" \
  APP_PASSWORD='pick-something-long' \
  MEDIA_BACKEND=supabase SUPABASE_URL='https://xxxx.supabase.co' SUPABASE_SERVICE_ROLE_KEY='eyJ...' \
  MOCK_AI=0 ANTHROPIC_API_KEY='sk-ant-...' OPENAI_API_KEY='sk-...' VOYAGE_API_KEY='pa-...'
fly deploy
fly open
```

Migrations run on every boot. `/api/health` reports queue depth and whether AI is in mock mode. The volume holds media (and a local cache when the bucket is on); with `MEDIA_LOCAL_CACHE=0` files are deleted locally after upload and the volume can be small.

**4. Point the phone at it.** `npm run shortcut -- https://someday-stash.fly.dev YOUR_CAPTURE_TOKEN` on an iCloud-signed Mac, AirDrop the file, and Add to Home Screen from Safari.

**Costs** at personal scale: Fly shared-cpu-1x with 1 GB is a few dollars a month, Supabase free tier covers the database and bucket, AI is cents per save.

**Twilio** (optional): point the number's messaging webhook at `https://your-app/api/capture` and add `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` to secrets.

**CI** runs typecheck, build, a lockfile check and a Docker build on every push.

## Known limits

- TikTok and Instagram fetching depends on `yt-dlp` and breaks every few months when they change things. `brew upgrade yt-dlp` fixes most of it. Some corporate networks are IP-blocked by TikTok.
- Facebook private groups and Instagram private accounts never fetch. Screenshot and share instead.
- Near-duplicate detection is a 64-bit difference hash: identical, re-scaled, brightened, slightly scrolled, or status-bar-different images match (distance 0 to 5). Crops of 10% or more do not (distance 15+). Tune with `NEAR_DUP_THRESHOLD`.

## Roadmap

1. Real AI keys and a week of actual use.
2. Run the Photos backfill.
3. "Ask" mode: natural-language questions answered across all saves.
4. Weekly digest ("you saved 4 bias-tape tutorials, here's the one you haven't watched").
5. Collections, weekly digest, native share extension if the Shortcut feels slow.
