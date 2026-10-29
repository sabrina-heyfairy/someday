-- Near-duplicate detection + AI cost log.
alter table items add column if not exists phash bit(64);
alter table items add column if not exists duplicate_of uuid references items(id) on delete set null;
create index if not exists items_duplicate_of_idx on items (duplicate_of) where duplicate_of is not null;

create table if not exists ai_usage (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  item_id       uuid references items(id) on delete set null,
  purpose       text not null,            -- extract|transcribe|embed
  model         text not null,
  input_tokens  int  not null default 0,
  output_tokens int  not null default 0,
  cost_usd      numeric(10,6) not null default 0
);
create index if not exists ai_usage_created_idx on ai_usage (created_at desc);
