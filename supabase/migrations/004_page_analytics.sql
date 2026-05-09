-- Page-level analytics: extend link_events with page tracking and dynamic watermark feed.
--
-- New event_type 'page_view' captures dwell time per page in the PDF viewer.
-- page_number is 1-indexed; dwell_ms is the time the page was visible in viewport.
--
-- Existing event types (view / denied / email_submitted / password_failed / download)
-- continue to leave page_number / dwell_ms NULL.

-- 1. Drop the existing event_type CHECK and re-add with 'page_view' included.
alter table public.link_events drop constraint if exists link_events_event_type_check;
alter table public.link_events
  add constraint link_events_event_type_check
  check (event_type in ('view', 'denied', 'email_submitted', 'password_failed', 'download', 'page_view'));

-- 2. New columns. NULL for legacy event types.
alter table public.link_events
  add column if not exists page_number integer
    check (page_number is null or page_number > 0);

alter table public.link_events
  add column if not exists dwell_ms integer
    check (dwell_ms is null or dwell_ms >= 0);

-- 3. Index for per-file/per-link page heatmap queries.
create index if not exists idx_link_events_file_page
  on public.link_events(file_id, page_number)
  where event_type = 'page_view';

-- 4. bump_link_counters() should *not* increment view_count for page_view events;
--    page_view is a high-volume signal distinct from "the document was opened once".
--    Verify the existing function only matches 'view' (singular) — it does, so no
--    change required. (See migration 001 lines 91–105.)
