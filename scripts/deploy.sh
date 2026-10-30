#!/usr/bin/env bash
# One-shot, re-runnable deploy to Fly.io: app + volume + Fly Postgres + secrets + deploy + health check.
#   scripts/deploy.sh                # uses APP from fly.toml, region sjc
#   APP=my-name REGION=ord scripts/deploy.sh
# Needs: `fly auth login` done. Reads ANTHROPIC_API_KEY (and optional OPENAI_API_KEY, VOYAGE_API_KEY, APP_PASSWORD)
# from .env.local so you never paste keys into a terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${APP:-$(sed -n 's/^app = "\(.*\)"/\1/p' fly.toml)}"
REGION="${REGION:-$(sed -n 's/^primary_region = "\(.*\)"/\1/p' fly.toml)}"
DB="${DB:-$APP-db}"
envval() { sed -n "s/^$1=//p" .env.local 2>/dev/null | head -1 | tr -d '"'"'"; }

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "checking fly login"
fly auth whoami >/dev/null || { echo "Run: fly auth login"; exit 1; }

step "app $APP"
fly apps list --json | grep -q "\"Name\": *\"$APP\"" || fly apps create "$APP" --org personal
# Portable in-place edit (macOS sed needs '', GNU sed rejects it).
sed -i.bak "s/^app = \".*\"/app = \"$APP\"/; s/^primary_region = \".*\"/primary_region = \"$REGION\"/" fly.toml && rm -f fly.toml.bak

step "volume 'data' in $REGION"
fly volumes list --app "$APP" --json | grep -q '"name": *"data"' || fly volumes create data --size 10 --region "$REGION" --app "$APP" --yes

step "postgres $DB"
if ! fly apps list --json | grep -q "\"Name\": *\"$DB\""; then
  # PostgreSQL 17 image: it ships pgvector. The default (18) does not, and `create extension vector` fails on boot.
  fly postgres create --name "$DB" --region "$REGION" --org personal --vm-size shared-cpu-1x --volume-size 3 --initial-cluster-size 1 --image-ref flyio/postgres-flex:17.7 --password "$(openssl rand -hex 16)"
  # New machines default to the proxy's idle auto-stop; a database must stay up.
  for m in $(fly machines list --app "$DB" --json | python3 -c 'import sys,json; print(" ".join(x["id"] for x in json.load(sys.stdin)))'); do
    fly machine update "$m" --app "$DB" --autostop=off --autostart=true -y >/dev/null
  done
fi
if ! fly secrets list --app "$APP" | grep -q 'DATABASE_URL'; then
  # attach needs a WireGuard tunnel; some corporate networks block it (websocket 403). Then set DATABASE_URL by hand:
  #   fly secrets set --app $APP DATABASE_URL='postgres://postgres:PASSWORD@'$DB'.flycast:5432/postgres?sslmode=disable'
  fly postgres attach "$DB" --app "$APP" --yes || { echo "attach failed (tunnel blocked?). Set DATABASE_URL manually, see comment above, then re-run."; exit 1; }
fi

step "secrets"
ANTHROPIC_API_KEY="$(envval ANTHROPIC_API_KEY)"
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "ERROR: ANTHROPIC_API_KEY missing from .env.local in $(pwd)"
  echo "Add a line like:  ANTHROPIC_API_KEY=sk-ant-api03-..."
  echo "Then re-run:  npm run deploy"
  exit 1
fi
EXISTING="$(fly secrets list --app "$APP")"
have() { echo "$EXISTING" | grep -q "^$1 "; }
SET=(MOCK_AI=0 "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" MEDIA_BACKEND=local)
have CAPTURE_TOKEN || SET+=("CAPTURE_TOKEN=$(openssl rand -hex 24)")
APP_PASSWORD="$(envval APP_PASSWORD)"; if ! have APP_PASSWORD; then [ -n "$APP_PASSWORD" ] && [ "$APP_PASSWORD" != "someday-dev" ] || APP_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"; SET+=("APP_PASSWORD=$APP_PASSWORD"); echo "APP_PASSWORD=$APP_PASSWORD" > .deploy-password.txt; echo "(web password written to .deploy-password.txt, gitignored)"; fi
for k in OPENAI_API_KEY VOYAGE_API_KEY; do v="$(envval $k)"; [ -n "$v" ] && SET+=("$k=$v"); done
fly secrets set --app "$APP" --stage "${SET[@]}" >/dev/null
echo "secrets staged: ${SET[*]%%=*}" | sed 's/=[^ ]*//g'

step "deploy"
fly deploy --app "$APP" --ha=false

step "health"
URL="https://$APP.fly.dev"
for i in 1 2 3 4 5 6; do sleep 5; if curl -fsS "$URL/api/health"; then echo; break; fi; echo "waiting…"; done
echo
echo "Live at $URL"
echo "Capture token (for the Shortcut):"; fly ssh console --app "$APP" -C 'printenv CAPTURE_TOKEN' 2>/dev/null || echo "  run: fly ssh console --app $APP -C 'printenv CAPTURE_TOKEN'"
