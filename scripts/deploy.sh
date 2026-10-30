#!/usr/bin/env bash
# One-shot, re-runnable deploy to Fly.io: app + volume + Fly Postgres + secrets + deploy + health check.
#   scripts/deploy.sh                # uses APP from fly.toml, region sjc
#   APP=my-name REGION=ord scripts/deploy.sh
#   DB=someday-stash-pg scripts/deploy.sh   # force which Postgres app to attach
# Needs: `fly auth login` done. Reads ANTHROPIC_API_KEY (and optional OPENAI_API_KEY, VOYAGE_API_KEY, APP_PASSWORD)
# from .env.local so you never paste keys into a terminal.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${APP:-$(sed -n 's/^app = "\(.*\)"/\1/p' fly.toml)}"
REGION="${REGION:-$(sed -n 's/^primary_region = "\(.*\)"/\1/p' fly.toml)}"
envval() { sed -n "s/^$1=//p" .env.local 2>/dev/null | head -1 | tr -d '"'"'"; }

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

has_app() { fly apps list --json | grep -q "\"Name\": *\"$1\""; }

# Prefer the live PG17 app name used in production docs; fall back to $APP-db; create $APP-pg if neither exists.
pick_db() {
  if [ -n "${DB:-}" ]; then echo "$DB"; return; fi
  if has_app "$APP-pg"; then echo "$APP-pg"; return; fi
  if has_app "$APP-db"; then echo "$APP-db"; return; fi
  echo "$APP-pg"
}

step "checking fly login"
fly auth whoami >/dev/null || { echo "Run: fly auth login"; exit 1; }

step "app $APP"
has_app "$APP" || fly apps create "$APP" --org personal
# Portable in-place edit (macOS sed needs '', GNU sed rejects it).
sed -i.bak "s/^app = \".*\"/app = \"$APP\"/; s/^primary_region = \".*\"/primary_region = \"$REGION\"/" fly.toml && rm -f fly.toml.bak

step "volume 'data' in $REGION"
fly volumes list --app "$APP" --json | grep -q '"name": *"data"' || fly volumes create data --size 10 --region "$REGION" --app "$APP" --yes

DB="$(pick_db)"
step "postgres $DB"
if ! has_app "$DB"; then
  # PostgreSQL 17 image: it ships pgvector. The default (18) does not, and `create extension vector` fails on boot.
  fly postgres create --name "$DB" --region "$REGION" --org personal --vm-size shared-cpu-1x --volume-size 3 --initial-cluster-size 1 --image-ref flyio/postgres-flex:17.7 --password "$(openssl rand -hex 16)"
  # New machines default to the proxy's idle auto-stop; a database must stay up.
  for m in $(fly machines list --app "$DB" --json | python3 -c 'import sys,json; print(" ".join(x["id"] for x in json.load(sys.stdin)))'); do
    fly machine update "$m" --app "$DB" --autostop=off --autostart=true -y >/dev/null
  done
fi

SECRETS_LIST="$(fly secrets list --app "$APP" 2>/dev/null || true)"
if ! echo "$SECRETS_LIST" | grep -q 'DATABASE_URL'; then
  echo "No DATABASE_URL secret on $APP — attaching $DB…"
  if ! fly postgres attach "$DB" --app "$APP" --yes; then
    echo
    echo "ERROR: could not attach $DB (no active leader / tunnel blocked / dead leftover DB)."
    echo "Your live database is often ${APP}-pg, not ${APP}-db."
    echo "Fix with one of:"
    echo "  fly status --app ${APP}-pg"
    echo "  fly postgres attach ${APP}-pg --app $APP --yes"
    echo "  # or, if DATABASE_URL is already in .env.local:"
    echo "  fly secrets set --app $APP DATABASE_URL=\"\$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)\""
    echo "  # then redeploy without attach:"
    echo "  fly deploy --app $APP --ha=false"
    exit 1
  fi
else
  echo "DATABASE_URL already set — skipping postgres attach"
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

step "memory (2gb for multi-photo captures)"
# fly.toml asks for 2gb; scale is a reliable nudge on existing machines.
fly scale memory 2048 --app "$APP" >/dev/null 2>&1 || fly scale memory 2048 --app "$APP" || true

step "health"
URL="https://$APP.fly.dev"
for i in 1 2 3 4 5 6; do sleep 5; if curl -fsS "$URL/api/health"; then echo; break; fi; echo "waiting…"; done
echo
echo "Live at $URL"
fly status --app "$APP" || true
echo "Capture token (for the Shortcut):"; fly ssh console --app "$APP" -C 'printenv CAPTURE_TOKEN' 2>/dev/null || echo "  run: fly ssh console --app $APP -C 'printenv CAPTURE_TOKEN'"
