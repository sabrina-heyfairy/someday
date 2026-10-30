create table if not exists collections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);
create table if not exists collection_items (
  collection_id uuid not null references collections(id) on delete cascade,
  item_id       uuid not null references items(id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, item_id)
);
create index if not exists collection_items_item_idx on collection_items (item_id);
