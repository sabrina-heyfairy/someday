-- Someday: one table of saved things. Written to run on local Postgres 17 and Supabase.
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists items (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- where it came from
  source        text not null default 'web',      -- instagram|tiktok|facebook|reddit|youtube|pinterest|web|screenshot|photo|text
  kind          text not null default 'link',     -- link|image|video|text
  channel       text not null default 'api',      -- shortcut|sms|folder|api
  url           text,
  canonical_url text,
  url_hash      text,
  image_hash    text,
  raw_text      text,                             -- caption / sms body / shared text
  -- pipeline
  status        text not null default 'queued',   -- queued|processing|done|failed
  error         text,
  processed_at  timestamptz,
  -- extracted
  title         text,
  creator       text,
  summary       text,
  category      text,                             -- garment|pattern|technique|tutorial|fabric|product|inspiration|other
  action        text,                             -- make|buy|learn|inspo|reference
  tags          text[] not null default '{}',
  garments      text[] not null default '{}',
  techniques    text[] not null default '{}',
  fabrics       text[] not null default '{}',
  colors        text[] not null default '{}',
  patterns      jsonb  not null default '[]',     -- [{name, brand, number}]
  products      jsonb  not null default '[]',     -- [{name, brand, price, url}]
  steps         text[] not null default '{}',
  transcript    text,
  ocr_text      text,
  media         jsonb  not null default '{}',     -- {thumbnail, video, frames[], audio, original}
  meta          jsonb  not null default '{}',     -- yt-dlp / og metadata, twilio from, etc
  -- user
  notes         text,
  starred       boolean not null default false,
  archived      boolean not null default false,
  -- search
  embedding     vector(1024),
  search        tsvector
);

create unique index if not exists items_url_hash_idx   on items (url_hash)   where url_hash   is not null;
create unique index if not exists items_image_hash_idx on items (image_hash) where image_hash is not null;
create index if not exists items_search_idx     on items using gin (search);
create index if not exists items_tags_idx       on items using gin (tags);
create index if not exists items_status_idx     on items (status) where status <> 'done';
create index if not exists items_created_idx    on items (created_at desc);
create index if not exists items_embedding_idx  on items using hnsw (embedding vector_cosine_ops);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists items_updated_at on items;
create trigger items_updated_at before update on items for each row execute function set_updated_at();

create or replace function items_search_update() returns trigger language plpgsql as $$
begin
  new.search :=
    setweight(to_tsvector('english', coalesce(new.title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.summary,'')), 'A') ||
    setweight(to_tsvector('english', array_to_string(new.tags,' ')), 'A') ||
    setweight(to_tsvector('english', array_to_string(new.garments,' ') || ' ' || array_to_string(new.techniques,' ') || ' ' || array_to_string(new.fabrics,' ') || ' ' || array_to_string(new.colors,' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.creator,'') || ' ' || coalesce(new.raw_text,'') || ' ' || coalesce(new.notes,'') || ' ' || coalesce(new.patterns::text,'') || ' ' || coalesce(new.products::text,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.ocr_text,'') || ' ' || array_to_string(new.steps,' ')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.transcript,'')), 'D');
  return new;
end $$;
drop trigger if exists items_search on items;
create trigger items_search before insert or update on items for each row execute function items_search_update();
