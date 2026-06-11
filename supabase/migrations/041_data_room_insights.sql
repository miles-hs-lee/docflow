-- 041_data_room_insights.sql
-- Data-room review follow-ups: room-level engagement built from existing
-- link_events (+ page_view_rollups) — the "who saw what" artifacts a
-- commercial data room is judged by. No new collection, no new infra.
--
--   #1  get_collection_file_engagement — per FILE across ALL of the room's
--       links: distinct viewers, dwell, downloads, last activity. Answers
--       "which documents in this room are hot".
--   #2  get_collection_visitor_matrix — per (visitor, file) cell: dwell,
--       pages read, last seen. The UI pivots this into the classic
--       visitor × document grid. Visitor identity follows get_link_visitors
--       (email when collected, else session).
--
-- Both follow the 040 union pattern (raw page_view rows ∪ session-grain
-- rollups) so compaction never changes the numbers, and both are
-- SECURITY DEFINER + service_role-only like every analytics RPC.

-- ───────────────────────────────────────────────────────────
-- #1: per-file engagement across the room's links (trash included only for
-- history? No — match the room rollup: trashed links' events stay attributed
-- to their file but the LINK filter is "all links of this collection",
-- including trashed ones, since their history already counted when live).

create or replace function public.get_collection_file_engagement(
  p_owner_id uuid,
  p_collection_id uuid
)
returns table (
  file_id uuid,
  viewers bigint,
  total_dwell_ms bigint,
  downloads bigint,
  last_activity timestamptz
)
language sql
security definer
set search_path = public
as $$
  with room_links as (
    select id from public.share_links
    where owner_id = p_owner_id and collection_id = p_collection_id
  ),
  sig as (
    select le.file_id, le.session_id,
           coalesce(le.dwell_ms, 0)::bigint as dwell,
           (le.event_type = 'download')::int as is_download,
           le.created_at as seen_at
    from public.link_events le
    where le.link_id in (select id from room_links)
      and le.event_type in ('view', 'page_view', 'download')
      and le.file_id is not null
    union all
    select r.file_id, r.session_id, r.total_dwell_ms, 0, r.last_seen
    from public.page_view_rollups r
    where r.link_id in (select id from room_links)
  )
  select
    sig.file_id,
    count(distinct sig.session_id)::bigint as viewers,
    sum(sig.dwell)::bigint as total_dwell_ms,
    sum(sig.is_download)::bigint as downloads,
    max(sig.seen_at) as last_activity
  from sig
  group by sig.file_id;
$$;

revoke all on function public.get_collection_file_engagement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_collection_file_engagement(uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────
-- #2: visitor × file matrix. One row per (visitor, file) with engagement;
-- the dashboard pivots rows into a grid. Capped by p_limit VISITORS (most
-- recently active first) so a busy room stays a bounded payload.

create or replace function public.get_collection_visitor_matrix(
  p_owner_id uuid,
  p_collection_id uuid,
  p_visitor_limit integer default 30
)
returns table (
  visitor_key text,
  viewer_email text,
  file_id uuid,
  total_dwell_ms bigint,
  pages_viewed bigint,
  last_seen timestamptz
)
language sql
security definer
set search_path = public
as $$
  with room_links as (
    select id from public.share_links
    where owner_id = p_owner_id and collection_id = p_collection_id
  ),
  sig as (
    select
      coalesce(nullif(le.viewer_email, ''), le.session_id::text) as visitor_key,
      le.viewer_email,
      le.session_id,
      le.file_id,
      le.page_number,
      coalesce(le.dwell_ms, 0)::bigint as dwell,
      le.created_at as seen_at
    from public.link_events le
    where le.link_id in (select id from room_links)
      and le.session_id is not null
      and le.file_id is not null
      and le.event_type in ('view', 'page_view', 'download')
    union all
    select
      coalesce(nullif(r.viewer_email, ''), r.session_id::text),
      r.viewer_email,
      r.session_id,
      r.file_id,
      r.page_number,
      r.total_dwell_ms,
      r.last_seen
    from public.page_view_rollups r
    where r.link_id in (select id from room_links)
  ),
  top_visitors as (
    select sig.visitor_key
    from sig
    group by sig.visitor_key
    order by max(sig.seen_at) desc
    limit greatest(coalesce(p_visitor_limit, 30), 1)
  )
  select
    sig.visitor_key,
    max(sig.viewer_email) as viewer_email,
    sig.file_id,
    sum(sig.dwell)::bigint as total_dwell_ms,
    count(distinct sig.page_number) filter (where sig.page_number is not null)::bigint as pages_viewed,
    max(sig.seen_at) as last_seen
  from sig
  join top_visitors tv on tv.visitor_key = sig.visitor_key
  group by sig.visitor_key, sig.file_id;
$$;

revoke all on function public.get_collection_visitor_matrix(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_collection_visitor_matrix(uuid, uuid, integer) to service_role;

-- ───────────────────────────────────────────────────────────
-- The two RPCs scan link_events by link_id (the room's links). The existing
-- idx_link_events_link_created (013) serves that shape; no new index needed.
