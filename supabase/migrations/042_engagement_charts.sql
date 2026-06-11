-- 042_engagement_charts.sql
-- Visualization round: the three chart surfaces that need NEW aggregation
-- (everything else in the round reuses existing RPC outputs).
--
--   #1  get_link_gate_funnel / get_collection_gate_funnel — distinct sessions
--       per access stage (방문 → 이메일 제출 → NDA 서명 → 열람 → 다운로드).
--       Shows how much friction each gate adds. All stages come from audit
--       events that are never compacted, so plain raw queries are exact.
--   #2  get_workspace_daily_views — 039's per-link daily series, workspace-
--       wide, for the overview sparkline. Backed by a new (workspace_id,
--       created_at) index that also serves the recent-activity feed.
--   #3  get_link_punchcard — day-of-week × hour engagement (view/page_view)
--       over the last 90 days, timezone-aware. 90 days keeps it inside the
--       raw page_view retention window (040 compacts only >90d), so rollups
--       (which lose hour granularity) never matter here.
--
-- All SECURITY DEFINER + service_role-only, matching the analytics RPCs.

-- ───────────────────────────────────────────────────────────
-- Index: workspace-scoped event scans (daily series, recent feed previously
-- leaned on owner/link indexes).
create index if not exists idx_link_events_workspace_created
  on public.link_events(workspace_id, created_at desc);

-- ───────────────────────────────────────────────────────────
-- #1: gate funnel — one row of distinct-session stage counts.
-- "visits" = any session that touched the link (gates, denials, views,
-- downloads). page_view is excluded: its sessions are a subset of 'view'
-- sessions (ingest requires a claimed view), so scanning it adds cost, not
-- signal.

create or replace function public.get_link_gate_funnel(
  p_owner_id uuid,
  p_link_id uuid
)
returns table (
  visits bigint,
  email_submits bigint,
  agreements bigint,
  viewers bigint,
  downloaders bigint
)
language sql
security definer
set search_path = public
as $$
  select
    count(distinct le.session_id) filter (
      where le.event_type in ('view', 'denied', 'email_submitted', 'password_failed', 'agreement', 'download')
    )::bigint as visits,
    count(distinct le.session_id) filter (where le.event_type = 'email_submitted')::bigint as email_submits,
    count(distinct le.session_id) filter (where le.event_type = 'agreement')::bigint as agreements,
    count(distinct le.session_id) filter (where le.event_type = 'view')::bigint as viewers,
    count(distinct le.session_id) filter (where le.event_type = 'download')::bigint as downloaders
  from public.link_events le
  where le.owner_id = p_owner_id
    and le.link_id = p_link_id
    and le.session_id is not null;
$$;

revoke all on function public.get_link_gate_funnel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_link_gate_funnel(uuid, uuid) to service_role;

create or replace function public.get_collection_gate_funnel(
  p_owner_id uuid,
  p_collection_id uuid
)
returns table (
  visits bigint,
  email_submits bigint,
  agreements bigint,
  viewers bigint,
  downloaders bigint
)
language sql
security definer
set search_path = public
as $$
  select
    count(distinct le.session_id) filter (
      where le.event_type in ('view', 'denied', 'email_submitted', 'password_failed', 'agreement', 'download')
    )::bigint as visits,
    count(distinct le.session_id) filter (where le.event_type = 'email_submitted')::bigint as email_submits,
    count(distinct le.session_id) filter (where le.event_type = 'agreement')::bigint as agreements,
    count(distinct le.session_id) filter (where le.event_type = 'view')::bigint as viewers,
    count(distinct le.session_id) filter (where le.event_type = 'download')::bigint as downloaders
  from public.link_events le
  where le.owner_id = p_owner_id
    and le.session_id is not null
    and le.link_id in (
      select id from public.share_links
      where owner_id = p_owner_id and collection_id = p_collection_id
    );
$$;

revoke all on function public.get_collection_gate_funnel(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_collection_gate_funnel(uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────
-- #2: workspace-wide daily series (039's shape, workspace scope).

create or replace function public.get_workspace_daily_views(
  p_workspace_id uuid,
  p_days integer default 14,
  p_tz text default 'UTC'
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
  with bounds as (
    select
      (now() at time zone p_tz)::date as today,
      ((now() at time zone p_tz)::date - (greatest(coalesce(p_days, 14), 1) - 1)) as start_day
  ),
  agg as (
    select
      (le.created_at at time zone p_tz)::date as day,
      count(distinct le.session_id) filter (
        where le.event_type in ('view', 'page_view')
      ) as sessions,
      count(*) filter (where le.event_type = 'view') as new_viewers
    from public.link_events le, bounds b
    where le.workspace_id = p_workspace_id
      and le.created_at >= (b.start_day::timestamp at time zone p_tz)
    group by 1
  )
  select
    d::date as day,
    coalesce(a.sessions, 0)::bigint as sessions,
    coalesce(a.new_viewers, 0)::bigint as new_viewers
  from bounds b
  cross join generate_series(b.start_day, b.today, interval '1 day') d
  left join agg a on a.day = d::date
  order by day;
$$;

revoke all on function public.get_workspace_daily_views(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.get_workspace_daily_views(uuid, integer, text) to service_role;

-- ───────────────────────────────────────────────────────────
-- #3: day-of-week × hour punchcard. dow follows ISO-ish extract(dow):
-- 0=일요일 … 6=토요일 (the UI maps labels). Engagement = view + page_view
-- events; 90-day window stays inside raw page_view retention.

create or replace function public.get_link_punchcard(
  p_owner_id uuid,
  p_link_id uuid,
  p_tz text default 'UTC'
)
returns table (
  dow integer,
  hour integer,
  hits bigint
)
language sql
security definer
set search_path = public
as $$
  select
    extract(dow from (le.created_at at time zone p_tz))::integer as dow,
    extract(hour from (le.created_at at time zone p_tz))::integer as hour,
    count(*)::bigint as hits
  from public.link_events le
  where le.owner_id = p_owner_id
    and le.link_id = p_link_id
    and le.event_type in ('view', 'page_view')
    and le.created_at >= now() - interval '90 days'
  group by 1, 2;
$$;

revoke all on function public.get_link_punchcard(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_link_punchcard(uuid, uuid, text) to service_role;
