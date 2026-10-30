# Someday launch checklist

Do these in order. Steps 1 to 3 are one sitting (about 30 minutes). Steps 4 to 7 can happen any time after.
Tip: the office proxy blocks personal Anthropic keys from this laptop, so test real AI through the deployed app, not locally.

Legend: `[x]` done · `[ ]` still needs the owner (accounts, phone, secrets, exports) · code/config items that can ship in-repo are marked **(in repo)**.

## 0. Before you start
- [ ] Personal Anthropic key (you have it, it starts `sk-ant-api03`). Keep it out of chat and out of git.
- [ ] A credit card for Fly.io (a few dollars a month). Supabase free tier is enough.

## 1. Fly account (you, 5 minutes)
- [ ] fly.io/app/sign-up → create account → add a card (Settings → Billing). Usage is about $5 a month.
- [ ] In your terminal:
  ```bash
  brew install flyctl && fly auth login
  ```
  A browser window opens; approve it. Done when the terminal says "successfully logged in".

## 2. Deploy (done 2026-10-30)
Live at https://someday-stash.fly.dev. Web password is in `.deploy-password.txt`, capture token in `.deploy-token.txt` (both gitignored, on this Mac only). Database is the Fly Postgres app `someday-stash-pg` (PG 17). Two leftovers to delete when convenient: `someday-guhxxa` (an earlier `fly launch` in Amsterdam) and `someday-stash-db` (PG 18, no pgvector). `fly apps destroy <name>`.

**(in repo)** Deploy script is portable (macOS + Linux `sed`), copies `content/` into the image, and runs `npm run import:tips` on boot so the sewing tips archive is upserted after migrations. `fly.toml` keeps `auto_stop_machines = "off"`, `min_machines_running = 1`, **2gb RAM**, and `restart.policy = always` so a multi-photo share cannot leave the app with “no started VMs”.

### 2c. After the multi-photo crash fix (owner)
Run these from **your local someday checkout** (wherever the repo lives — not necessarily `~/Documents/someday`):
```bash
git pull
# Deploy needs ANTHROPIC_API_KEY in .env.local (same folder). Check:
grep '^ANTHROPIC_API_KEY=sk-' .env.local
npm run deploy
# If the machine is still on 1gb after deploy:
fly scale memory 2048 --app someday-stash
fly status --app someday-stash   # confirm memory 2048, 1 machine started
curl -fsS https://someday-stash.fly.dev/api/health
```
Then regenerate and reinstall the Shortcut (section 4) — the old one must not be used.

## 2b. Deploy from scratch (if ever needed)
- [ ] Make sure `ANTHROPIC_API_KEY` is in `~/Documents/someday/.env.local` (it is).
- [ ] Run:
  ```bash
  cd ~/Documents/someday && npm run deploy
  ```
  Creates the app, disk and database, sets secrets, builds and deploys (3 to 5 minutes the first time), then prints the URL, health status and your capture token. The web password is in `.deploy-password.txt`.

## 3. Prove it works (done 2026-10-30)
- [x] `/api/health` returns `"ok":true,"mock_ai":false`.
- [x] A YouTube tutorial saved through the live app came back with a real title, 8 tags and a summary naming the creator.

## 3b. Sewing tips archive **(in repo — done)**
- [x] Archive extracted to `content/sewing-tips-archive.json` (210 tips; count matches source meta).
- [x] Import script: `npm run import:tips` (also `--dry-run`). Upserts into `items` + collection **Sewing tips archive**.
- [x] UI: `/tips` with search, category / source / status / tag filters, linked from the header.
- [ ] **Owner — after next deploy:** open https://someday-stash.fly.dev/tips and confirm the footer/header shows **210 tips**. If the machine was deployed before this change, redeploy once (`npm run deploy` or `fly deploy`) so boot runs the import. Or one-shot:
  ```bash
  fly ssh console --app someday-stash -C 'npx tsx scripts/import-sewing-tips.ts'
  ```

## 4. Phone: Shortcut + home screen
- [ ] **Regenerate the Shortcut after the multi-photo capture fix** (older builds POST every selected photo in one body and crash the Fly VM). On a Mac signed into iCloud:
  ```bash
  cd ~/Documents/someday && git pull
  TOKEN=$(fly ssh console --app someday-stash -C 'printenv CAPTURE_TOKEN' 2>/dev/null | tail -1)
  npm run shortcut -- https://someday-stash.fly.dev "$TOKEN"
  ```
  Produces `Save to Someday.shortcut`. AirDrop it to your iPhone → delete the old "Save to Someday" if present → Add Shortcut.
  No iCloud Mac available? Build it by hand with the recipe in README → "Ways to save", but use a **Repeat with Each** over images (one POST per photo), not one Base64 of the whole album.
  Capture token fallback: read `.deploy-token.txt` on the Mac that deployed.
- [ ] On the iPhone: open `https://someday-stash.fly.dev` in Safari → log in → Share → **Add to Home Screen**.
- [ ] Test: open Instagram, find a Reel, Share → Save to Someday. Expect a "Saved ✨" notification. Open the Someday icon, it's there.
- [ ] Test multi-photo: in Photos, select ~5–10 shots → Share → Save to Someday. Expect "Saved ✨" and every photo on the home grid (may take a minute for AI to catch up). `/api/health` should stay `"ok":true`.

## 5. Your dead screenshots
- [ ] System Settings → Privacy & Security → Full Disk Access → turn on your terminal app (Terminal, iTerm or Claude).
- [ ] Count first, then import. This runs against whichever database `.env.local` points at. To send them to the live app, open a tunnel in another terminal with `fly proxy 15432:5432 --app someday-stash-pg` and set `DATABASE_URL` in `.env.local` to the Postgres URL printed by `fly postgres attach` with the host swapped to `localhost:15432`:
  ```bash
  cd ~/Documents/someday && npm run ingest:photos -- --count
  npm run ingest:photos
  ```
  Thousands of screenshots cost a dollar or two on the Haiku tier.
  Note: checklist previously said `someday-stash-db`; live DB app is `someday-stash-pg`.

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

## 8. Optional scheduled sources (Reddit / Pinterest)
- [ ] **Pinterest:** in the live app open `/sources` → paste a public board URL → save. Sync runs every `SYNC_INTERVAL_HOURS` (default 24).
- [ ] **Reddit saved posts:** create an app at https://www.reddit.com/prefs/apps (type *web app*, redirect URI `https://someday-stash.fly.dev/api/reddit/callback`). Then:
  ```bash
  fly secrets set --app someday-stash \
    APP_URL=https://someday-stash.fly.dev \
    REDDIT_CLIENT_ID=... \
    REDDIT_CLIENT_SECRET=...
  ```
  Redeploy if needed, open `/sources` → Connect Reddit.

## 9. Cleanup leftovers (optional)
- [ ] `fly apps destroy someday-guhxxa` (old Amsterdam launch).
- [ ] `fly apps destroy someday-stash-db` (PG 18 without pgvector), only if you confirmed nothing points at it.

## If something breaks
- `fly logs --app someday-stash` shows the server. Paste the error back to Claude.
- `/api/health` returning `"ok":false` means the database is unreachable; `fly postgres list` and `fly status --app someday-stash-pg`.
- Login loop = `APP_PASSWORD` not set or cookie blocked; set it and redeploy.
- Tips count wrong = run `fly ssh console --app someday-stash -C 'npx tsx scripts/import-sewing-tips.ts'` and confirm it prints `archive_items_in_db=210`.
