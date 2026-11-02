# Someday: Next.js app + media pipeline (ffmpeg, yt-dlp) in one image.
FROM node:22-bookworm-slim AS base
ENV NODE_ENV=production PNPM_HOME=/root/.local/share/pnpm NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM base AS run
# tsx stays so `npm run db:migrate` / `npm run worker` work inside the container.
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY src ./src
COPY scripts ./scripts
COPY supabase ./supabase
COPY content ./content
ENV MEDIA_DIR=/data/media PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p /data/media
EXPOSE 3000
# Serve FIRST: Fly's proxy gives up ~8s after waking a stopped machine, and the chores below took 15s before Next listened,
# so every Shortcut save that hit a sleeping machine failed. Migrations, the sewing-tips upsert, shelving, the source
# scheduler and (a minute later) one low-priority preview worker now run behind the server, starting 20s in so Next has
# the single CPU to itself while it boots. Migrations are idempotent and
# the schema only changes on a deploy, so the few seconds of overlap are safe.
CMD ["sh", "-c", "(sleep 20 && npx tsx scripts/migrate.ts && npx tsx scripts/import-sewing-tips.ts && npx tsx scripts/shelve.ts && (npx tsx scripts/scheduler.ts &) && sleep 40 && PREVIEW_CONCURRENCY=1 nice -n 15 npx tsx scripts/backfill-previews.ts) & exec node_modules/.bin/next start -p ${PORT}"]
