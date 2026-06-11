-- 039_analytics_enrichment_2.sql
-- Analytics review follow-ups (2026-06): meaningful-but-lightweight metrics.
--
--   #1  files.page_count — total pages, reported once by the viewer (which
--       already parses the PDF client-side). Unlocks true completion rates
--       and dense per-page heatmaps without server-side PDF parsing.
--   #2  link_events.country — ISO 3166-1 alpha-2 from the platform geo header
--       (x-vercel-ip-country). Recorded on 'view' claims only; raw IP is
--       still never stored (ip_hash stays HMAC-only).
--   #3  claim_view gains p_country (carries 038's restored dedup forward).
--   #4  get_link_visitors: pages_viewed counted distinct page numbers across
--       ALL files of a data-room link (p.1 of file A == p.1 of file B).
--       Now counts distinct (file_id, page_number). Also returns country +
--       last_user_agent so the UI can show geo/device without new collection.
--   #5  get_link_daily_views: was one lateral subquery per day (30 index
--       scans); now a single range scan + GROUP BY. Gains p_tz so days
--       bucket in the owner's timezone instead of UTC midnight.
--   #6  get_workspace_top_documents gains p_days (default 30) — all-time
--       rankings let stale documents squat the overview forever.
--   #7  get_link_engagement — total/avg dwell per engaged session for the
--       link summary tiles. Derived from existing page_view rows.
--   #8  get_link_country_breakdown — distinct view sessions per country.

-- ───────────────────────────────────────────────────────────
-- #1: page count, reported by the first viewer (only set while NULL).
alter table public.files
  add column if not exists page_count integer
    check (page_count is null or page_count > 0);

-- ───────────────────────────────────────────────────────────
-- #2: viewer country (2-letter code), 'view' events only.
alter table public.link_events
  add column if not exists country text
    check (country is null or char_length(country) = 2);

-- ───────────────────────────────────────────────────────────
-- #3: claim_view + p_country. Drop the 6-arg version (038) first; the new
-- parameter is DEFAULTed so pre-deploy app code calling with 6 named args
-- still resolves against this 7-arg function via PostgREST.
drop function if exists public.claim_view(uuid, uuid, uuid, text, text, text);

create function public.claim_view(
  p_link_id uuid,
  p_file_id uuid,
  p_session_id uuid,
  p_viewer_email text,
  p_ip_hash text,
  p_user_agent text,
  p_country text default null
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_effective_max int;
  v_already_viewed boolean;
begin
  select * into v_link from public.share_links where id = p_link_id for update;

  if v_link.id is null then
    return query select false, 'file_missing'::text;
    return;
  end if;

  if v_link.deleted_at is not null then
    return query select false, 'deleted'::text;
    return;
  end if;

  if v_link.is_active is false then
    return query select false, 'inactive'::text;
    return;
  end if;

  if v_link.expires_at is not null and v_link.expires_at < now() then
    return query select false, 'expired'::text;
    return;
  end if;

  -- 007/038 dedup: one counted view per (link, session), ever.
  select exists (
    select 1 from public.link_events
    where link_id = p_link_id
      and session_id = p_session_id
      and event_type = 'view'
  ) into v_already_viewed;

  if v_already_viewed then
    return query select true, null::text;
    return;
  end if;

  v_effective_max := case when v_link.one_time then 1 else v_link.max_views end;
  if v_effective_max is not null and v_link.view_count >= v_effective_max then
    return query select false, 'max_views_reached'::text;
    return;
  end if;

  insert into public.link_events (
    link_id, file_id, owner_id, workspace_id, event_type,
    session_id, viewer_email, ip_hash, user_agent, country
  ) values (
    p_link_id, p_file_id, v_link.owner_id, v_link.workspace_id, 'view',
    p_session_id, p_viewer_email, p_ip_hash, p_user_agent,
    nullif(upper(trim(coalesce(p_country, ''))), '')
  );

  return query select true, null::text;
end;
$$;

revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text, text) from public;
revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text, text) from anon;
revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text, text) from authenticated;
grant execute on function public.claim_view(uuid, uuid, uuid, text, text, text, text) to service_role;

-- ───────────────────────────────────────────────────────────
-- #4: visitor rollup — per-file page identity + geo/device passthrough.
-- Return columns change, so DROP first (017 precedent).
drop function if exists public.get_link_visitors(uuid, uuid, integer);

create function public.get_link_visitors(
  p_owner_id uuid,
  p_link_id uuid,
  p_limit integer default 100
)
returns table (
  visitor_key text,
  viewer_email text,
  sessions bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  pages_viewed bigint,
  total_dwell_ms bigint,
  downloads bigint,
  agreed boolean,
  country text,
  last_user_agent text
)
language sql
security definer
set search_path = public
as $$
  with evt as (
    select
      coalesce(nullif(le.viewer_email, ''), le.session_id::text) as visitor_key,
      le.viewer_email,
      le.session_id,
      le.event_type,
      le.file_id,
      le.page_number,
      le.dwell_ms,
      le.created_at,
      le.user_agent,
      le.country
    from public.link_events le
    where le.owner_id = p_owner_id
      and le.link_id = p_link_id
      and le.session_id is not null
      and le.event_type in ('view', 'page_view', 'download', 'agreement')
  )
  select
    evt.visitor_key,
    max(evt.viewer_email) as viewer_email,
    count(distinct evt.session_id)::bigint as sessions,
    min(evt.created_at) as first_seen,
    max(evt.created_at) as last_seen,
    -- Pages are identified per FILE — a data-room visitor reading p.1 of two
    -- different files has read two pages, not one.
    count(distinct (evt.file_id, evt.page_number))
      filter (where evt.page_number is not null)::bigint as pages_viewed,
    coalesce(sum(evt.dwell_ms), 0)::bigint as total_dwell_ms,
    count(*) filter (where evt.event_type = 'download')::bigint as downloads,
    bool_or(evt.event_type = 'agreement') as agreed,
    (array_agg(evt.country order by evt.created_at desc)
      filter (where evt.country is not null))[1] as country,
    (array_agg(evt.user_agent order by evt.created_at desc)
      filter (where evt.user_agent is not null))[1] as last_user_agent
  from evt
  group by evt.visitor_key
  order by max(evt.created_at) desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.get_link_visitors(uuid, uuid, integer) from public;
revoke all on function public.get_link_visitors(uuid, uuid, integer) from anon;
revoke all on function public.get_link_visitors(uuid, uuid, integer) from authenticated;
grant execute on function public.get_link_visitors(uuid, uuid, integer) to service_role;

-- ───────────────────────────────────────────────────────────
-- #5: daily series — single range scan + timezone-aware day buckets.
-- Signature gains p_tz (DEFAULT keeps pre-deploy callers working).
drop function if exists public.get_link_daily_views(uuid, uuid, integer);

create function public.get_link_daily_views(
  p_owner_id uuid,
  p_link_id uuid,
  p_days integer default 30,
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
      ((now() at time zone p_tz)::date - (greatest(coalesce(p_days, 30), 1) - 1)) as start_day
  ),
  agg as (
    -- One index range scan over (link_id, created_at) for the whole window,
    -- instead of the old one-lateral-subquery-per-day (30 scans).
    select
      (le.created_at at time zone p_tz)::date as day,
      count(distinct le.session_id) filter (
        where le.event_type in ('view', 'page_view')
      ) as sessions,
      count(*) filter (where le.event_type = 'view') as new_viewers
    from public.link_events le, bounds b
    where le.owner_id = p_owner_id
      and le.link_id = p_link_id
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

revoke all on function public.get_link_daily_views(uuid, uuid, integer, text) from public;
revoke all on function public.get_link_daily_views(uuid, uuid, integer, text) from anon;
revoke all on function public.get_link_daily_views(uuid, uuid, integer, text) from authenticated;
grant execute on function public.get_link_daily_views(uuid, uuid, integer, text) to service_role;

-- ───────────────────────────────────────────────────────────
-- #6: top documents — recent-window ranking (p_days NULL = all-time).
drop function if exists public.get_workspace_top_documents(uuid, integer);

create function public.get_workspace_top_documents(
  p_workspace_id uuid,
  p_limit integer default 5,
  p_days integer default 30
)
returns table (file_id uuid, original_name text, viewers bigint, views bigint)
language sql
security definer
set search_path = public
as $$
  select
    f.id as file_id,
    f.original_name,
    count(distinct le.session_id)::bigint as viewers,
    count(*) filter (where le.event_type = 'view')::bigint as views
  from public.link_events le
  join public.files f on f.id = le.file_id and f.workspace_id = p_workspace_id
  where le.workspace_id = p_workspace_id
    and le.event_type in ('view', 'page_view')
    and le.session_id is not null
    and (p_days is null or le.created_at >= now() - make_interval(days => p_days))
  group by f.id, f.original_name
  order by viewers desc, views desc
  limit greatest(coalesce(p_limit, 5), 1);
$$;

revoke all on function public.get_workspace_top_documents(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_workspace_top_documents(uuid, integer, integer) to service_role;

-- ───────────────────────────────────────────────────────────
-- #7: link engagement — dwell totals + per-engaged-session average.
create or replace function public.get_link_engagement(p_owner_id uuid, p_link_id uuid)
returns table (total_dwell_ms bigint, dwell_sessions bigint, avg_dwell_ms bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(le.dwell_ms), 0)::bigint as total_dwell_ms,
    count(distinct le.session_id)::bigint as dwell_sessions,
    case
      when count(distinct le.session_id) > 0
        then (coalesce(sum(le.dwell_ms), 0) / count(distinct le.session_id))::bigint
      else 0::bigint
    end as avg_dwell_ms
  from public.link_events le
  where le.owner_id = p_owner_id
    and le.link_id = p_link_id
    and le.event_type = 'page_view';
$$;

revoke all on function public.get_link_engagement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_link_engagement(uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────
-- #8: country breakdown — distinct view sessions per country. NULL country
-- (header absent / pre-039 rows) groups as one bucket; the UI labels it.
create or replace function public.get_link_country_breakdown(
  p_owner_id uuid,
  p_link_id uuid,
  p_limit integer default 20
)
returns table (country text, viewers bigint)
language sql
security definer
set search_path = public
as $$
  select
    le.country,
    count(distinct le.session_id)::bigint as viewers
  from public.link_events le
  where le.owner_id = p_owner_id
    and le.link_id = p_link_id
    and le.event_type = 'view'
    and le.session_id is not null
  group by le.country
  order by viewers desc
  limit greatest(coalesce(p_limit, 20), 1);
$$;

revoke all on function public.get_link_country_breakdown(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_link_country_breakdown(uuid, uuid, integer) to service_role;
