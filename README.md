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

**1. iPhone Share Sheet (the main one).** Easiest: generate and sign the shortcut, then AirDrop it to your phone. Step-by-step for a fresh Mac: [docs/SHORTCUT-REBUILD.md](docs/SHORTCUT-REBUILD.md). Signing needs a Mac signed into iCloud.

```bash
npm run shortcut -- https://YOUR-HOST YOUR_CAPTURE_TOKEN
```

That writes `Save to Someday.shortcut`, signed so iOS accepts it. Signing needs a Mac that is signed into iCloud (no developer account). It detects every URL and every image in the share, converts photos to JPEG, and **POSTs each one separately** to `/api/capture` (a single giant multi-photo body OOMs the server), then pops a "Saved ✨" notification. Open the file on the Mac or AirDrop it; iOS shows an Add Shortcut screen.

If you already installed an older Shortcut that batched images into one request, regenerate and re-AirDrop it after deploying the multi-capture fix.

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

**4. Everything you already saved inside each app.** Request your data export (Instagram: Settings → Your activity → Download your information, JSON format. TikTok: Settings → Account → Download your data, JSON. Reddit: reddit.com/settings/data-request. Facebook: Download your information, JSON). Unzip, then:

```bash
npm run import -- ~/Downloads/instagram-export --dry-run   # count first
npm run import -- ~/Downloads/instagram-export             # queue everything, keep original save dates
npm run import -- ~/Downloads/user_data_tiktok.json --include-likes
npm run import -- --board https://www.pinterest.com/you/summer-linen/   # any public Pinterest board
```

Instagram collections and Pinterest boards become Someday collections. Any other file full of links works too (the importer harvests Instagram, TikTok, Reddit, Pinterest, Facebook and YouTube links from anything). Imported items use the cheap Haiku tier. Add `--process` to run the AI right away, or let the worker pick them up.

**5. Desktop.** The `/add` page, or `npm run ingest:url -- <url>`. On Android and desktop Chrome the installed app also registers as a share target, so "Share → Someday" lands on `/add` prefilled.

## Sources that sync on their own

`/sources` lists what Someday pulls automatically, every `SYNC_INTERVAL_HOURS` (default 24) via a small scheduler process that runs beside the web server in the Docker image (`npm run scheduler` locally), plus a Sync now button. Two kinds:

- **Pinterest boards.** Paste any public board URL; each board becomes a collection and new pins arrive on the schedule.
- **Reddit saved posts and comments.** One-time setup: create an app at reddit.com/prefs/apps (type *web app*, redirect URI `https://YOUR-APP/api/reddit/callback`), set `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` and `APP_URL`, redeploy, then tap Connect Reddit. Someday keeps a refresh token and reads `/user/you/saved`.

Instagram, TikTok and Facebook have no API for saved posts, and scraping a logged-in session gets accounts flagged, so they are deliberately not here. Use the Shortcut for new saves and `npm run import` with their data exports for the backlog. `POST /api/sync?token=…` triggers a run from an external cron if you prefer that to the in-app timer.

## Fixing what the AI got wrong

Tap **Select** on the grid, tick cards, and the bar at the bottom tags, files into a collection, moves to the to-make board, stars, or archives them all at once. On an item page, open **Tags · edit** to retype its tags, category and action. `/tags` lists every tag with counts; rename one there and it changes everywhere (renaming onto an existing tag merges them; clearing the name deletes it).

## Sewing tips archive

Sabrina's Sewist Studio tips live in `content/sewing-tips-archive.json` (210 entries: title, source, category, tags, notes, how-to, status). Import them into Postgres (and the **Sewing tips archive** collection) with:

```bash
npm run import:tips -- --dry-run
npm run import:tips
```

Browse at `/tips` (search + category / source / status / tag filters). On Fly, boot runs the import after migrations so a fresh deploy stays in sync. Tips also show up in the main grid and full-text search like any other item.

## Collections

Named boards on top of the automatic tags: "summer linen", "gift ideas", "techniques to practise". Create one at `/collections` or straight from an item's page, where every collection shows as a chip you tap to add or remove. Deleting a collection never deletes items.

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
| `npm run previews` | Fetch a picture for link items that have none (archive imports); runs on every boot too |
| `npm run import -- <export>` | Import saved posts from Instagram, TikTok, Reddit, Facebook or Pinterest exports |
| `npm run ingest:folder -- <dir>` | Backfill a folder of images |
| `npm run retry` | Re-run failed or stuck items |
| `npm run rehash` | Compute perceptual hashes for items that predate dedupe |
| `npm run hash:compare -- <dir>` | Print hash distances vs `orig.*` in a folder, for tuning `NEAR_DUP_THRESHOLD` |
| `npm run ingest:url -- <url> [note]` | Save one link from the terminal |
| `npm run shortcut -- <host> <token>` | Build and sign the Save to Someday iOS Shortcut |
| `POST /api/process?token=…&limit=5` | Cron-friendly processing endpoint |
| `POST /api/sync?token=…` | Run all scheduled sources now |
| `GET /api/items?token=…&q=…` | JSON search, for a future native app or Shortcut |

## Deploying

One vendor: Fly.io hosts the app, its Postgres database, and the media disk. (Supabase Storage is still supported via `MEDIA_BACKEND=supabase` if you ever want media in a bucket, but it is not needed.)

```bash
brew install flyctl && fly auth login     # once, needs a Fly account with a card on file
npm run deploy                             # creates app, 10 GB volume, Fly Postgres, secrets, deploys, health-checks
```

Notes from the first deploy: Fly's unmanaged Postgres images (17 and 18) do not include pgvector, so the schema treats it as optional and semantic search is off on Fly unless you install `postgresql-17-pgvector` on the database machine or move the database to a host that has it. Fly Postgres machines are created with the proxy's idle auto-stop, which stops the database five minutes after each start; the deploy script turns that off. `fly postgres attach` and `fly ssh` need a WireGuard tunnel that some corporate networks block; `fly deploy` (Depot builder) and `fly machine exec` do not.

`npm run deploy` is safe to re-run; it only creates what is missing. It reads `ANTHROPIC_API_KEY` (and optional `OPENAI_API_KEY`, `VOYAGE_API_KEY`, `APP_PASSWORD`) from `.env.local`, generates a capture token and a web password if you did not set one (written to `.deploy-password.txt`, gitignored), and prints the live URL. Migrations run on every boot. `/api/health` reports queue depth and whether AI is in mock mode.

Then `npm run shortcut -- https://YOUR-APP.fly.dev YOUR_CAPTURE_TOKEN` on an iCloud-signed Mac, AirDrop the file, and Add to Home Screen from Safari.

**Costs** at personal scale: about $5 a month on Fly (app machine, small Postgres, 13 GB of disk), AI is cents per save.

**Twilio** (optional): point the number's messaging webhook at `https://your-app/api/capture` and `fly secrets set TWILIO_ACCOUNT_SID=... TWILIO_AUTH_TOKEN=...`.

**CI** runs typecheck, build, a lockfile check and a Docker build on every push.

## Known limits

- TikTok and Instagram fetching depends on `yt-dlp` and breaks every few months when they change things. `brew upgrade yt-dlp` fixes most of it. Some corporate networks are IP-blocked by TikTok.
- Posts that need a login (many Instagram reels, private accounts) fetch only with cookies. Set `YTDLP_COOKIES_FROM_BROWSER=chrome` (or `safari`, which needs Full Disk Access for the terminal) on the laptop, or export a `cookies.txt` with a browser extension and set `YTDLP_COOKIES_FILE` on the server. Facebook private groups still won't fetch; screenshot and share instead.
- Near-duplicate detection is a 64-bit difference hash: identical, re-scaled, brightened, slightly scrolled, or status-bar-different images match (distance 0 to 5). Crops of 10% or more do not (distance 15+). Tune with `NEAR_DUP_THRESHOLD`.

## Roadmap

1. Real AI keys and a week of actual use.
2. Run the Photos backfill.
3. "Ask" mode: natural-language questions answered across all saves.
4. Weekly digest ("you saved 4 bias-tape tutorials, here's the one you haven't watched").
5. Native share extension if the Shortcut feels slow.
