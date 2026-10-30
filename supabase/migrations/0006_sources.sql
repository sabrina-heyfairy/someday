-- Scheduled sources: things Someday pulls on its own (Pinterest boards, Reddit saved posts).
create table if not exists sources (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('pinterest_board','reddit_saved')),
  label        text not null,
  config       jsonb not null default '{}',   -- pinterest: {url}; reddit: {username, refresh_token}
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  last_run_at  timestamptz,
  last_status  text,                           -- ok | error
  last_message text,
  last_added   int not null default 0
);
