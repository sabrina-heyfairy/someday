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
ENV MEDIA_DIR=/data/media PORT=3000 HOSTNAME=0.0.0.0
RUN mkdir -p /data/media
EXPOSE 3000
# Apply migrations, then serve. `after()` processing runs in this same process.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx next start -p ${PORT}"]
