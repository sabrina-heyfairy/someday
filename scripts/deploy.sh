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
sed -i '' "s/^app = \".*\"/app = \"$APP\"/; s/^primary_region = \".*\"/primary_region = \"$REGION\"/" fly.toml

step "volume 'data' in $REGION"
fly volumes list --app "$APP" --json | grep -q '"name": *"data"' || fly volumes create data --size 10 --region "$REGION" --app "$APP" --yes

step "postgres $DB"
if ! fly apps list --json | grep -q "\"Name\": *\"$DB\""; then
  fly postgres create --name "$DB" --region "$REGION" --org personal --vm-size shared-cpu-1x --volume-size 3 --initial-cluster-size 1 --password "$(openssl rand -hex 16)"
fi
if ! fly secrets list --app "$APP" | grep -q '^DATABASE_URL'; then
  fly postgres attach "$DB" --app "$APP" --yes
fi

step "secrets"
ANTHROPIC_API_KEY="$(envval ANTHROPIC_API_KEY)"
[ -n "$ANTHROPIC_API_KEY" ] || { echo "ANTHROPIC_API_KEY missing from .env.local"; exit 1; }
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
