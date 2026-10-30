-- The app is for anything saved, not only sewing. `topic` is the AI's one-word area of life; shelves stay the user's.
alter table items add column if not exists topic text;
insert into collections (name, position) values ('Wardrobe', 90), ('Inspiration', 95) on conflict (name) do nothing;
update items set topic = 'sewing' where topic is null and (meta ? 'archive_id' or cardinality(techniques) > 0 or cardinality(fabrics) > 0 or category in ('pattern','technique','tutorial','fabric'));
