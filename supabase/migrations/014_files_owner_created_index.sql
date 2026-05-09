-- Performance: composite index for the dashboard files listing.
--
-- listFiles(supabase, { limit, offset }) does:
--   select * from files where owner_id = $1
--   order by created_at desc
--   limit $2 offset $3
-- plus a count(*) on the same predicate. Without (owner_id, created_at desc),
-- Postgres falls back to scanning all owner rows then sorting them, which
-- gets noticeably slow once an owner has more than a few thousand uploads.
-- The index lets both the page slice and the count short-circuit to an
-- index range scan.

create index if not exists idx_files_owner_created
  on public.files(owner_id, created_at desc);
