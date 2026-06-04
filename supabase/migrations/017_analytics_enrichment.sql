-- 017_analytics_enrichment.sql
-- Analytics review follow-ups #1, #2, #7, #8.
--
--   #1  share_links.open_count — total document opens (NOT session-deduped),
--       so the "조회수" tile stops being identical to "유니크".
--   #2  get_per_page_stats now also returns `viewers` (distinct sessions),
--       so the heatmap can show "N명" instead of "N회" (dwell-segment rows).
--   #7  get_link_daily_views — per-day engagement time-series.
--   #8  reach/completion is derived in the UI from the per-page `viewers`
--       column added here, so no extra object is needed for it.

-- ───────────────────────────────────────────────────────────
-- #1: total-opens counter
--
-- view_count stays session-deduped (claim_view inserts one 'view' per
-- session) and keeps driving max_views / one_time. open_count is a pure
-- display counter bumped once per viewer-page render, so "조회수" (opens)
-- and "유니크" (distinct sessions) are now genuinely different numbers.
alter table public.share_links
  add column if not exists open_count integer not null default 0;

-- Backfill existing links so the new counter isn't misleadingly 0 for
-- links that already have history. The deduped view_count is the best
-- proxy available for past opens.
update public.share_links
  set open_count = view_count
  where open_count = 0 and view_count > 0;

-- Atomic per-row increment for the opens counter. The viewer page calls
-- this once per render; doing it as a single UPDATE avoids a
-- read-modify-write race when concurrent opens land at the same instant.
create or replace function public.increment_link_open_count(p_link_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.share_links
    set open_count = open_count + 1
    where id = p_link_id;
$$;

revoke all on function public.increment_link_open_count(uuid) from public;
revoke all on function public.increment_link_open_count(uuid) from anon;
revoke all on function public.increment_link_open_count(uuid) from authenticated;
grant execute on function public.increment_link_open_count(uuid) to service_role;

-- ───────────────────────────────────────────────────────────
-- #1: metrics RPCs — "views" now means total opens (open_count).
--
-- Same return shape, so CREATE OR REPLACE is fine (grants preserved).

create or replace function public.get_owner_link_metrics(p_file_id uuid)
returns table (
  link_id uuid,
  views bigint,
  unique_viewers bigint,
  downloads bigint,
  denied bigint
)
language sql
security definer
set search_path = public
as $$
  select
    sl.id as link_id,
    sl.open_count::bigint as views,
    coalesce(uv.unique_viewers, 0) as unique_viewers,
    sl.download_count::bigint as downloads,
    sl.denied_count::bigint as denied
  from public.share_links sl
  left join lateral (
    select count(distinct le.session_id)::bigint as unique_viewers
    from public.link_events le
    where le.link_id = sl.id
      and le.event_type = 'view'
  ) uv on true
  where sl.owner_id = auth.uid()
    and sl.file_id = p_file_id;
$$;

create or replace function public.get_link_summary_for_owner(p_owner_id uuid, p_link_id uuid)
returns table (
  link_id uuid,
  views bigint,
  unique_viewers bigint,
  downloads bigint,
  denied bigint
)
language sql
security definer
set search_path = public
as $$
  select
    sl.id as link_id,
    sl.open_count::bigint as views,
    (
      select count(distinct le.session_id)::bigint
      from public.link_events le
      where le.owner_id = p_owner_id
        and le.link_id = p_link_id
        and le.event_type = 'view'
        and le.session_id is not null
    ) as unique_viewers,
    sl.download_count::bigint as downloads,
    sl.denied_count::bigint as denied
  from public.share_links sl
  where sl.owner_id = p_owner_id
    and sl.id = p_link_id;
$$;

-- ───────────────────────────────────────────────────────────
-- #2: per-page stats gains a distinct-session viewer count.
--
-- Adding a return column changes the signature, so DROP first (CREATE OR
-- REPLACE cannot alter the OUT columns). Re-grant afterwards.
drop function if exists public.get_per_page_stats(uuid, uuid, uuid);

create function public.get_per_page_stats(
  p_owner_id uuid,
  p_file_id uuid,
  p_link_id uuid default null
)
returns table (
  page_number integer,
  views bigint,
  viewers bigint,
  total_dwell_ms bigint
)
language sql
security definer
set search_path = public
as $$
  select
    page_number,
    count(*)::bigint as views,
    count(distinct session_id)::bigint as viewers,
    coalesce(sum(dwell_ms), 0)::bigint as total_dwell_ms
  from public.link_events
  where owner_id = p_owner_id
    and file_id = p_file_id
    and event_type = 'page_view'
    and page_number is not null
    and (p_link_id is null or link_id = p_link_id)
  group by page_number
  order by page_number;
$$;

revoke all on function public.get_per_page_stats(uuid, uuid, uuid) from public;
revoke all on function public.get_per_page_stats(uuid, uuid, uuid) from anon;
revoke all on function public.get_per_page_stats(uuid, uuid, uuid) from authenticated;
grant execute on function public.get_per_page_stats(uuid, uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────
-- #7: daily engagement time-series.
--
-- For each of the last p_days days: `sessions` = distinct sessions with any
-- view/page_view activity that day (repeat engagement shows up across
-- days), `new_viewers` = first-time 'view' events that day. Days are
-- bucketed in UTC; for a 30-day trend the boundary offset is immaterial.
-- The (link_id, created_at) index (013) serves the per-day range scans.
create or replace function public.get_link_daily_views(
  p_owner_id uuid,
  p_link_id uuid,
  p_days integer default 30
)
returns table (
  day date,
  sessions bigint,
  new_viewers bigint
)
language sql
security definer
set search_path = public
as $$
  select
    d::date as day,
    coalesce(a.sessions, 0)::bigint as sessions,
    coalesce(a.new_viewers, 0)::bigint as new_viewers
  from generate_series(
    (current_date - (greatest(p_days, 1) - 1)),
    current_date,
    interval '1 day'
  ) d
  left join lateral (
    select
      count(distinct session_id) filter (
        where event_type in ('view', 'page_view')
      ) as sessions,
      count(*) filter (where event_type = 'view') as new_viewers
    from public.link_events le
    where le.owner_id = p_owner_id
      and le.link_id = p_link_id
      and le.created_at >= d::date
      and le.created_at < (d::date + 1)
  ) a on true
  order by day;
$$;

revoke all on function public.get_link_daily_views(uuid, uuid, integer) from public;
revoke all on function public.get_link_daily_views(uuid, uuid, integer) from anon;
revoke all on function public.get_link_daily_views(uuid, uuid, integer) from authenticated;
grant execute on function public.get_link_daily_views(uuid, uuid, integer) to service_role;
