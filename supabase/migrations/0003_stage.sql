-- To-make board: a stage per item. Null = not on the board. Items the AI marks action='make' show in "want" until moved.
alter table items add column if not exists stage text check (stage in ('want','fabric','in_progress','done'));
alter table items add column if not exists stage_changed_at timestamptz;
create index if not exists items_stage_idx on items (stage) where stage is not null;
