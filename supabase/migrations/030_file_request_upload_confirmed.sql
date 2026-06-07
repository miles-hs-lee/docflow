-- 030_file_request_upload_confirmed.sql
-- Two-phase commit for inbound file-request uploads. claim_file_request_upload
-- inserts the row (atomic max_uploads check + count bump) BEFORE the object is
-- stored; a process crash/timeout between the insert and the storage upload
-- would otherwise leave an ORPHAN row with no object that consumes a
-- max_uploads slot forever.
--
-- `confirmed_at` is set by the upload route ONLY after the object is durably
-- stored. The owner listing shows only confirmed rows, and the dispatch cron
-- sweeps unconfirmed rows older than 1h (their after-delete trigger restores
-- upload_count). The atomic claim still counts ALL rows (confirmed or not), so
-- in-flight uploads can't exceed the limit; orphans only over-count briefly
-- until the sweep removes them.

alter table public.file_request_uploads add column if not exists confirmed_at timestamptz;

-- Existing rows predate the two-phase flow and already have stored objects —
-- mark them confirmed so they keep showing and are never swept.
update public.file_request_uploads set confirmed_at = created_at where confirmed_at is null;

-- Sweep scan: unconfirmed rows by age.
create index if not exists idx_fru_unconfirmed
  on public.file_request_uploads (created_at)
  where confirmed_at is null;
