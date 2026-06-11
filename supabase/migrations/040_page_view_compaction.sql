-- 040_page_view_compaction.sql
-- link_events growth control: page_view rows dominate volume (one row per
-- dwell segment, with email/ip_hash/UA denormalized onto every row). This
-- migration compacts page_view rows older than a cutoff (default 90 days)
-- into a session-grain rollup and deletes the raws.
--
-- Grain choice: (link, file, session, page). Day-grain rollups would break
-- distinct-session metrics (daily distincts don't compose); session-grain
-- keeps every current aggregate EXACT:
--   - per-page viewers  = count(distinct session)  → rollup keeps session_id
--   - dwell / row counts = sums                     → additive
--   - visitor identity   = email-else-session       → rollup keeps both
-- Audit events (view / download / denied / agreement / email_submitted /
-- password_failed) are never compacted. The 30-day daily-trend RPC reads a
-- window far inside the cutoff, so it stays raw-only by construction.
--
-- Read paths that aggregate page signals are redefined below as
-- raw ∪ rollup: get_per_page_stats, get_link_visitors, get_link_engagement,
-- get_workspace_top_documents, get_workspace_contacts.
-- (The owner-scoped 020 variants are superseded by the workspace RPCs the
-- app actually calls and are left as-is.)
--
-- The compactor runs from the existing daily dispatch cron (best-effort,
-- batch-limited): app/api/automation/dispatch → compact_page_view_events().

-- ───────────────────────────────────────────────────────────
-- Rollup table

create table if not exists public.page_view_rollups (
  id bigserial primary key,
  link_id uuid not null references public.share_links(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  session_id uuid not null,
  viewer_email text,
  page_number integer not null check (page_number > 0),
  views bigint not null check (views > 0),
  total_dwell_ms bigint not null default 0 check (total_dwell_ms >= 0),
  first_seen timestamptz not null,
  last_seen timestamptz not null
);

-- Upsert target for the compactor (merge across runs) + visitor lookups
-- (leads with link_id).
create unique index if not exists ux_page_view_rollups_grain
  on public.page_view_rollups(link_id, file_id, session_id, page_number);

-- Heatmap shape: (owner, file[, link]).
create index if not exists idx_page_view_rollups_owner_file_page
  on public.page_view_rollups(owner_id, file_id, page_number);

-- Workspace rollups (top documents / contacts).
create index if not exists idx_page_view_rollups_workspace
  on public.page_view_rollups(workspace_id);

alter table public.page_view_rollups enable row level security;

-- Post-035 posture: membership SELECT only (the owner_id policies were
-- retired in 035; member write policies were dropped in 036/037 — every
-- write goes through the service-role compactor, which bypasses RLS).
create policy "ws_read_page_view_rollups"
  on public.page_view_rollups
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- ───────────────────────────────────────────────────────────
-- Compactor. Batch-limited so a daily cron tick stays bounded; reruns make
-- incremental progress. Rows lacking session/page/link/file are skipped
-- (unusable for visitor analytics; negligible volume).

create or replace function public.compact_page_view_events(
  p_older_than_days integer default 90,
  p_limit integer default 50000
)
returns table (compacted_rows bigint, rollup_rows bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Floor of 30 days: the daily-trend RPC reads a 30-day raw window, so a
  -- misconfigured caller must never compact inside it.
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_older_than_days, 90), 30));
  v_ids bigint[];
  v_deleted bigint := 0;
  v_rolled bigint := 0;
begin
  select array_agg(id) into v_ids
  from (
    select id
    from public.link_events
    where event_type = 'page_view'
      and created_at < v_cutoff
      and session_id is not null
      and page_number is not null
      and link_id is not null
      and file_id is not null
    order by id
    limit greatest(coalesce(p_limit, 50000), 1000)
  ) batch;

  if v_ids is null then
    return query select 0::bigint, 0::bigint;
    return;
  end if;

  -- workspace_id is NOT in the GROUP BY: a link's old rows may predate 033
  -- tagging (NULL) while newer ones carry the id — two groups would collide
  -- on the conflict target inside one INSERT. min() over text prefers the
  -- tagged value (min ignores NULLs) and keeps the grain unique per batch.
  insert into public.page_view_rollups as r (
    link_id, file_id, owner_id, workspace_id, session_id, viewer_email,
    page_number, views, total_dwell_ms, first_seen, last_seen
  )
  select
    le.link_id,
    le.file_id,
    le.owner_id,
    min(le.workspace_id::text)::uuid,
    le.session_id,
    max(le.viewer_email),
    le.page_number,
    count(*)::bigint,
    coalesce(sum(le.dwell_ms), 0)::bigint,
    min(le.created_at),
    max(le.created_at)
  from public.link_events le
  where le.id = any(v_ids)
  group by le.link_id, le.file_id, le.owner_id, le.session_id, le.page_number
  on conflict (link_id, file_id, session_id, page_number)
  do update set
    views = r.views + excluded.views,
    total_dwell_ms = r.total_dwell_ms + excluded.total_dwell_ms,
    first_seen = least(r.first_seen, excluded.first_seen),
    last_seen = greatest(r.last_seen, excluded.last_seen),
    viewer_email = coalesce(excluded.viewer_email, r.viewer_email),
    workspace_id = coalesce(r.workspace_id, excluded.workspace_id);
  get diagnostics v_rolled = row_count;

  delete from public.link_events where id = any(v_ids);
  get diagnostics v_deleted = row_count;

  return query select v_deleted, v_rolled;
end;
$$;

revoke all on function public.compact_page_view_events(integer, integer) from public, anon, authenticated;
grant execute on function public.compact_page_view_events(integer, integer) to service_role;

-- ───────────────────────────────────────────────────────────
-- get_per_page_stats: raw ∪ rollup (same signature → CREATE OR REPLACE).

create or replace function public.get_per_page_stats(
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
  with sig as (
    select le.page_number, le.session_id, 1::bigint as views, coalesce(le.dwell_ms, 0)::bigint as dwell
    from public.link_events le
    where le.owner_id = p_owner_id
      and le.file_id = p_file_id
      and le.event_type = 'page_view'
      and le.page_number is not null
      and (p_link_id is null or le.link_id = p_link_id)
    union all
    select r.page_number, r.session_id, r.views, r.total_dwell_ms
    from public.page_view_rollups r
    where r.owner_id = p_owner_id
      and r.file_id = p_file_id
      and (p_link_id is null or r.link_id = p_link_id)
  )
  select
    sig.page_number,
    sum(sig.views)::bigint as views,
    -- A session straddling the compaction cutoff appears in both branches;
    -- count(distinct) collapses it, so viewers stays exact.
    count(distinct sig.session_id)::bigint as viewers,
    sum(sig.dwell)::bigint as total_dwell_ms
  from sig
  group by sig.page_number
  order by sig.page_number;
$$;

-- ───────────────────────────────────────────────────────────
-- get_link_visitors: page signals from raw ∪ rollup; identity/audit columns
-- (downloads, agreement, UA, country) come from the never-compacted events.
-- Same signature/columns as 039 → CREATE OR REPLACE.

create or replace function public.get_link_visitors(
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
      coalesce(le.dwell_ms, 0)::bigint as dwell,
      le.created_at as first_at,
      le.created_at as last_at,
      le.user_agent,
      le.country
    from public.link_events le
    where le.owner_id = p_owner_id
      and le.link_id = p_link_id
      and le.session_id is not null
      and le.event_type in ('view', 'page_view', 'download', 'agreement')
    union all
    select
      coalesce(nullif(r.viewer_email, ''), r.session_id::text),
      r.viewer_email,
      r.session_id,
      'page_view'::text,
      r.file_id,
      r.page_number,
      r.total_dwell_ms,
      r.first_seen,
      r.last_seen,
      null::text,
      null::text
    from public.page_view_rollups r
    where r.owner_id = p_owner_id
      and r.link_id = p_link_id
  )
  select
    evt.visitor_key,
    max(evt.viewer_email) as viewer_email,
    count(distinct evt.session_id)::bigint as sessions,
    min(evt.first_at) as first_seen,
    max(evt.last_at) as last_seen,
    count(distinct (evt.file_id, evt.page_number))
      filter (where evt.page_number is not null)::bigint as pages_viewed,
    coalesce(sum(evt.dwell), 0)::bigint as total_dwell_ms,
    count(*) filter (where evt.event_type = 'download')::bigint as downloads,
    bool_or(evt.event_type = 'agreement') as agreed,
    (array_agg(evt.country order by evt.last_at desc)
      filter (where evt.country is not null))[1] as country,
    (array_agg(evt.user_agent order by evt.last_at desc)
      filter (where evt.user_agent is not null))[1] as last_user_agent
  from evt
  group by evt.visitor_key
  order by max(evt.last_at) desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;

-- ───────────────────────────────────────────────────────────
-- get_link_engagement: raw ∪ rollup (same signature → CREATE OR REPLACE).

create or replace function public.get_link_engagement(p_owner_id uuid, p_link_id uuid)
returns table (total_dwell_ms bigint, dwell_sessions bigint, avg_dwell_ms bigint)
language sql
security definer
set search_path = public
as $$
  with sig as (
    select le.session_id, coalesce(le.dwell_ms, 0)::bigint as dwell
    from public.link_events le
    where le.owner_id = p_owner_id
      and le.link_id = p_link_id
      and le.event_type = 'page_view'
    union all
    select r.session_id, r.total_dwell_ms
    from public.page_view_rollups r
    where r.owner_id = p_owner_id
      and r.link_id = p_link_id
  )
  select
    coalesce(sum(sig.dwell), 0)::bigint as total_dwell_ms,
    count(distinct sig.session_id)::bigint as dwell_sessions,
    case
      when count(distinct sig.session_id) > 0
        then (coalesce(sum(sig.dwell), 0) / count(distinct sig.session_id))::bigint
      else 0::bigint
    end as avg_dwell_ms
  from sig;
$$;

-- ───────────────────────────────────────────────────────────
-- get_workspace_top_documents: rollups join the all-time path; the windowed
-- path uses last_seen so a compacted session straddling the window edge is
-- approximated to its latest activity. Same signature as 039.

create or replace function public.get_workspace_top_documents(
  p_workspace_id uuid,
  p_limit integer default 5,
  p_days integer default 30
)
returns table (file_id uuid, original_name text, viewers bigint, views bigint)
language sql
security definer
set search_path = public
as $$
  with sig as (
    select le.file_id, le.session_id, (le.event_type = 'view') as is_view
    from public.link_events le
    where le.workspace_id = p_workspace_id
      and le.event_type in ('view', 'page_view')
      and le.session_id is not null
      and (p_days is null or le.created_at >= now() - make_interval(days => p_days))
    union all
    select r.file_id, r.session_id, false
    from public.page_view_rollups r
    where r.workspace_id = p_workspace_id
      and (p_days is null or r.last_seen >= now() - make_interval(days => p_days))
  )
  select
    f.id as file_id,
    f.original_name,
    count(distinct s.session_id)::bigint as viewers,
    count(*) filter (where s.is_view)::bigint as views
  from sig s
  join public.files f on f.id = s.file_id and f.workspace_id = p_workspace_id
  group by f.id, f.original_name
  order by viewers desc, views desc
  limit greatest(coalesce(p_limit, 5), 1);
$$;

revoke all on function public.get_workspace_top_documents(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_workspace_top_documents(uuid, integer, integer) to service_role;

-- ───────────────────────────────────────────────────────────
-- get_workspace_contacts: compacted page signals keep an identified
-- visitor's documents / sessions / first–last seen exact. Same signature.

create or replace function public.get_workspace_contacts(p_workspace_id uuid, p_limit integer default 200)
returns table (
  viewer_email text, documents bigint, sessions bigint, opens bigint,
  downloads bigint, agreed boolean, first_seen timestamptz, last_seen timestamptz
)
language sql
security definer
set search_path = public
as $$
  with evt as (
    select le.viewer_email, le.file_id, le.session_id, le.event_type,
           le.created_at as first_at, le.created_at as last_at
    from public.link_events le
    where le.workspace_id = p_workspace_id
      and le.viewer_email is not null
      and le.viewer_email <> ''
    union all
    select r.viewer_email, r.file_id, r.session_id, 'page_view'::text,
           r.first_seen, r.last_seen
    from public.page_view_rollups r
    where r.workspace_id = p_workspace_id
      and r.viewer_email is not null
      and r.viewer_email <> ''
  )
  select
    evt.viewer_email,
    count(distinct evt.file_id) filter (where evt.file_id is not null)::bigint as documents,
    count(distinct evt.session_id)::bigint as sessions,
    count(*) filter (where evt.event_type = 'view')::bigint as opens,
    count(*) filter (where evt.event_type = 'download')::bigint as downloads,
    bool_or(evt.event_type = 'agreement') as agreed,
    min(evt.first_at) as first_seen,
    max(evt.last_at) as last_seen
  from evt
  group by evt.viewer_email
  order by max(evt.last_at) desc
  limit greatest(coalesce(p_limit, 200), 1);
$$;
