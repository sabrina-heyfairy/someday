# Someday launch checklist

Do these in order. Steps 1 to 3 are one sitting (about 30 minutes). Steps 4 to 7 can happen any time after.
Tip: do steps 1 to 3 from home or a phone hotspot, not the office network. The office proxy blocks personal
Anthropic keys and can interfere with command-line tools.

## 0. Before you start
- [ ] Personal Anthropic key (you have it, it starts `sk-ant-api03`). Keep it out of chat and out of git.
- [ ] A credit card for Fly.io (a few dollars a month). Supabase free tier is enough.

## 1. Supabase (database + media bucket)
- [ ] supabase.com → New project. Name `someday`, pick a strong database password and SAVE IT, region closest to you.
- [ ] Wait for it to provision (1 to 2 minutes).
- [ ] Project Settings → Database → Connection string → **Session pooler**. Copy it (port 5432). This is `DB_MIGRATE_URL`.
- [ ] Same page → **Transaction pooler** (port 6543). Copy it. This is `DB_APP_URL`.
- [ ] Storage → New bucket → name `media` → **Private** → Save.
- [ ] Project Settings → API → copy **Project URL** (`SUPABASE_URL`) and the **service_role** key (`SUPABASE_SERVICE_ROLE_KEY`).
- [ ] From your laptop, create the tables (replace the URL, keep the quotes):
  ```bash
  cd ~/Documents/someday && DATABASE_URL='DB_MIGRATE_URL' npm run db:migrate
  ```
  Expect four lines ending in `ok` and then `migrations up to date`.

## 2. Fly.io (the app)
- [ ] Install and log in:
  ```bash
  brew install flyctl && fly auth login
  ```
- [ ] Create the app and its disk. If `someday-stash` is taken, pick another name and change `app = ...` in fly.toml to match.
  ```bash
  cd ~/Documents/someday && fly apps create someday-stash && fly volumes create data --size 10 --region sjc --app someday-stash --yes
  ```
- [ ] Set secrets (one command; replace every ALL-CAPS placeholder):
  ```bash
  fly secrets set --app someday-stash \
    DATABASE_URL='DB_APP_URL' \
    CAPTURE_TOKEN="$(openssl rand -hex 24)" \
    APP_PASSWORD='PICK_A_LONG_PASSWORD' \
    MEDIA_BACKEND=supabase SUPABASE_URL='SUPABASE_URL' SUPABASE_SERVICE_ROLE_KEY='SERVICE_ROLE_KEY' \
    MOCK_AI=0 ANTHROPIC_API_KEY='sk-ant-api03-...'
  ```
  Optional extras in the same command: `OPENAI_API_KEY` (transcripts), `VOYAGE_API_KEY` (semantic search).
- [ ] Deploy:
  ```bash
  fly deploy --app someday-stash
  ```
  First build takes 3 to 5 minutes. Then:
  ```bash
  fly open --app someday-stash
  ```
- [ ] You should see the login page. Enter `APP_PASSWORD`. Empty grid is correct.
- [ ] Save your capture token somewhere you can find it (1Password note). Show it with:
  ```bash
  fly secrets list --app someday-stash   # shows names only
  ```
  If you lost the value, set a new one: `fly secrets set CAPTURE_TOKEN="$(openssl rand -hex 24)"` and reuse it in step 4.

## 3. Prove it works
- [ ] Open `https://someday-stash.fly.dev/api/health`. Expect `"ok":true` and `"mock_ai":false`.
- [ ] In the app, tap **Add**, paste a YouTube sewing video link, Save. Within a minute the item page shows a real title, tags and summary (not `[mock]`).
- [ ] Grid footer shows AI spend > $0.00.

## 4. Phone: Shortcut + home screen
- [ ] On a Mac signed into iCloud (personal Mac, or sign this one in):
  ```bash
  cd ~/Documents/someday && npm run shortcut -- https://someday-stash.fly.dev YOUR_CAPTURE_TOKEN
  ```
  Produces `Save to Someday.shortcut`. AirDrop it to your iPhone → Add Shortcut.
  No iCloud Mac available? Build it by hand with the recipe in README → "Ways to save".
- [ ] On the iPhone: open `https://someday-stash.fly.dev` in Safari → log in → Share → **Add to Home Screen**.
- [ ] Test: open Instagram, find a Reel, Share → Save to Someday. Expect a "Saved ✨" notification. Open the Someday icon, it's there.

## 5. Your dead screenshots
- [ ] System Settings → Privacy & Security → Full Disk Access → turn on your terminal app (Terminal, iTerm or Claude).
- [ ] Count first, then import (this runs against whichever database `.env.local` points at; set `DATABASE_URL` to `DB_APP_URL` there to send them to the live app):
  ```bash
  cd ~/Documents/someday && npm run ingest:photos -- --count
  npm run ingest:photos
  ```
  Thousands of screenshots cost a dollar or two on the Haiku tier.

## 6. Everything saved inside the apps
- [ ] Request exports now, they take a while to arrive:
  - Instagram: Settings → Your activity → Download your information → **JSON**, saved posts / collections.
  - TikTok: Settings → Account → Download your data → **JSON**.
  - Reddit: reddit.com/settings/data-request.
  - Facebook: Settings → Download your information → **JSON**.
- [ ] When each arrives, unzip and:
  ```bash
  npm run import -- ~/Downloads/THE_EXPORT_FOLDER --dry-run
  npm run import -- ~/Downloads/THE_EXPORT_FOLDER --process
  ```
- [ ] Pinterest boards: `npm run import -- --board https://www.pinterest.com/YOU/BOARD/ --process`

## 7. Optional: text it
- [ ] Twilio account → buy a number → Messaging → webhook `https://someday-stash.fly.dev/api/capture` (POST).
- [ ] `fly secrets set TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=...`
- [ ] Text the number a link. Expect "Saved ✨".

## If something breaks
- `fly logs --app someday-stash` shows the server. Paste the error back to Claude.
- `/api/health` returning `"ok":false` means the database URL or password is wrong.
- Login loop = `APP_PASSWORD` not set or cookie blocked; set it and redeploy.
