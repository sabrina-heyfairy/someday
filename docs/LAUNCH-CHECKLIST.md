# Someday launch checklist

Do these in order. Steps 1 to 3 are one sitting (about 30 minutes). Steps 4 to 7 can happen any time after.
Tip: the office proxy blocks personal Anthropic keys from this laptop, so test real AI through the deployed app, not locally.

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

## 2. Deploy (Claude, or you)
- [ ] Make sure `ANTHROPIC_API_KEY` is in `~/Documents/someday/.env.local` (it is).
- [ ] Run:
  ```bash
  cd ~/Documents/someday && npm run deploy
  ```
  Creates the app, disk and database, sets secrets, builds and deploys (3 to 5 minutes the first time), then prints the URL, health status and your capture token. The web password is in `.deploy-password.txt`.

## 3. Prove it works
- [ ] Open `https://someday-stash.fly.dev/api/health` (your app name may differ). Expect `"ok":true` and `"mock_ai":false`.
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
- [ ] Count first, then import. This runs against whichever database `.env.local` points at. To send them to the live app, open a tunnel in another terminal with `fly proxy 15432:5432 --app someday-stash-db` and set `DATABASE_URL` in `.env.local` to the Postgres URL printed by `fly postgres attach` with the host swapped to `localhost:15432`:
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
- `/api/health` returning `"ok":false` means the database is unreachable; `fly postgres list` and `fly status --app someday-stash-db`.
- Login loop = `APP_PASSWORD` not set or cookie blocked; set it and redeploy.
