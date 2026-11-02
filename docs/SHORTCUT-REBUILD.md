# Rebuild the "Save to Someday" Shortcut (personal Mac)

The Shortcut file has to be **signed**, and Apple's `shortcuts sign` only works on a Mac that is signed into iCloud.
The work Mac is not, so do this on the personal Mac. Takes about five minutes.

Why rebuild: the current Shortcut on the phone posts a share's links and pictures as separate requests, and for some
TikTok shares no link is sent at all. The new build sends the links **with** each picture, plus the share text, so the
server can always attach the "Open on tiktok" link to the saved card.

## Faster: edit the Shortcut on the phone instead (no Mac needed)

Only one action changes. Shortcuts app → long-press **Save to Someday** → **Edit**.

1. Scroll to the **second** "Repeat with Each" block, the one that contains **Convert Image** and **Base64 Encode**.
2. Inside it, tap the **Get Contents of URL** action to expand it, then tap **Request Body** to show its fields.
3. Tap **Add new field** → **Text**. Key: `url`. Value: tap the value box, pick the **URLs** variable (the one set by
   "Set Variable URLs" near the top; it may appear under the variables bar as **URLs**).
4. Tap **Add new field** → **Text** again. Key: `text`. Value: pick **Shortcut Input**.
5. Tap **Done**. Share a TikTok video to test; the card should get the `tiktok ↗` pill.

The server already merges the separate link request the first Repeat still sends, so nothing else needs to move.

## 0. One-time setup on the personal Mac

Skip anything already in place.

```bash
# Node 22 (any way you like; nvm shown)
nvm install 22 && nvm use 22

# Fly CLI, logged in to the PERSONAL Fly account (dowlingsabrina@gmail.com), the one that owns someday-stash
brew install flyctl
fly auth login

# The repo
git clone https://github.com/sabrina-heyfairy/someday.git ~/Documents/someday
```

Make sure the Mac is signed into iCloud: System Settings → Apple Account. Python 3 ships with macOS.

## 1. Pull the latest code

```bash
cd ~/Documents/someday && git pull origin main && npm ci
```

## 2. Check you can read the capture token

The Shortcut carries the live `CAPTURE_TOKEN`. Do **not** use `.deploy-token.txt` from the work Mac; it is stale.

```bash
fly ssh console --app someday-stash -C 'printenv CAPTURE_TOKEN'
```

You should see one long hex string. If it prints nothing, the machine is asleep: open https://someday-stash.fly.dev
in a browser once, wait ten seconds, run it again.

## 3. Build and sign

```bash
cd ~/Documents/someday && npm run shortcut -- https://someday-stash.fly.dev "$(fly ssh console --app someday-stash -C 'printenv CAPTURE_TOKEN' 2>/dev/null | tail -1 | tr -d '[:space:]')" && open -R "Save to Someday.shortcut"
```

Success looks like `wrote Save to Someday.shortcut (host https://someday-stash.fly.dev)` and Finder opens with the
file selected. If you see `Signing needs a Mac signed into iCloud`, finish the iCloud sign-in and rerun.

The file contains the token. Do not commit it or paste it anywhere; it is already in `.gitignore`.

## 4. Put it on the phone

1. Finder → AirDrop (or `open /System/Library/CoreServices/Finder.app/Contents/Applications/AirDrop.app`).
2. Drag **Save to Someday.shortcut** onto your iPhone.
3. On the phone, open the Shortcuts app and delete the old **Save to Someday** first.
4. Accept the AirDrop → **Add Shortcut**.

## 5. Test

- TikTok: open a video → Share → **Save to Someday**. Expect "Saved ✨". The card should show a `tiktok ↗` pill and
  the item page an **Open on tiktok** button.
- Photos: select a few screenshots → Share → Save to Someday. Every one should land on the grid.

If a card ever arrives without a link, open it and use **Paste the original link…** under the picture.

## If the token ever needs rotating

```bash
fly secrets set --app someday-stash CAPTURE_TOKEN="$(openssl rand -hex 24)"
```

The app restarts and the old Shortcut stops working. Rebuild (step 3) and reinstall (step 4) right after.
