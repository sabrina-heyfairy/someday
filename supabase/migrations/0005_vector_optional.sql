-- Semantic search needs pgvector. Add it where the server offers it; skip quietly where it doesn't.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    execute 'create extension if not exists vector';
    execute 'alter table items add column if not exists embedding vector(1024)';
    execute 'create index if not exists items_embedding_idx on items using hnsw (embedding vector_cosine_ops)';
  else
    raise notice 'pgvector not available: semantic search disabled, keyword search still works';
  end if;
end $$;
