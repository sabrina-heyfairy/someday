-- Shelves: collections become the primary way to browse. A shelf is a collection the home page shows as a tab.
-- Items can sit on several shelves. The AI's `category` column stays as a hint but is no longer a filter.
-- Placing existing items onto shelves happens in scripts/shelve.ts (idempotent, runs at boot after the archive import).
alter table collections add column if not exists position int not null default 100;
alter table collections add column if not exists is_shelf boolean not null default true;

insert into collections (name, position) values
  ('Bags & pouches', 10), ('Garments', 20), ('Techniques', 30), ('Patterns', 40),
  ('Fabric', 50), ('Accessories', 60), ('Home decor', 70), ('Tools & supplies', 80)
on conflict (name) do update set position = excluded.position;
