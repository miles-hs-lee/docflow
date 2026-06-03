-- Performance: indexes for file search/sort + owner event feed.
--
-- The dashboard file browser (lib/data.ts listFiles) supports:
--   - search:  original_name ILIKE '%term%'   (leading wildcard)
--   - sort:    created_at | original_name | size_bytes
-- Migration 014 added (owner_id, created_at desc) which covers the
-- default sort + unsearched count. The remaining gaps:
--
-- 1. Leading-wildcard ILIKE cannot use a btree index → sequential scan
--    of the owner's rows on every search keystroke. pg_trgm GIN fixes it.
-- 2. Sorting by original_name / size_bytes has no supporting index → a
--    full sort of the owner's rows (no LIMIT short-circuit).
-- 3. The owner event feed + MCP analytics.events page by (owner_id, id);
--    only (owner_id, created_at desc) exists. id pagination on the
--    highest-volume table (link_events) had no covering index.

-- ────────────────────────────────────────────────────────
-- 1. Trigram index for ILIKE file search
create extension if not exists pg_trgm;

create index if not exists idx_files_name_trgm
  on public.files using gin (original_name gin_trgm_ops);

-- ────────────────────────────────────────────────────────
-- 2. Sort indexes matching the non-default sort keys
create index if not exists idx_files_owner_name
  on public.files(owner_id, original_name);

create index if not exists idx_files_owner_size
  on public.files(owner_id, size_bytes desc);

-- ────────────────────────────────────────────────────────
-- 3. Owner event-feed pagination (ORDER BY id within an owner)
create index if not exists idx_link_events_owner_id
  on public.link_events(owner_id, id desc);
