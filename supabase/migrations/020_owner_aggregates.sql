-- 020_owner_aggregates.sql
-- IA restructure: account-level rollups for the overview dashboard ("전체 통계")
-- and the contacts page ("연락처"). All aggregate existing link_events /
-- share_links data — no new collection. SECURITY DEFINER + service_role; the
-- caller passes p_owner_id (functions do not see auth.uid()), matching the
-- other analytics RPCs.

-- ───────────────────────────────────────────────────────────
-- Account-wide engagement totals across the owner's active (non-trashed)
-- links. Trashed links' history is excluded (reflects current performance).
create or replace function public.get_owner_overview(p_owner_id uuid)
returns table (
  opens bigint,
  unique_viewers bigint,
  downloads bigint,
  denied bigint
)
language sql
security definer
set search_path = public
as $$
  with active_links as (
    select id, open_count, download_count, denied_count
    from public.share_links
    where owner_id = p_owner_id and deleted_at is null
  )
  select
    coalesce((select sum(open_count) from active_links), 0)::bigint as opens,
    (
      select count(distinct le.session_id)::bigint
      from public.link_events le
      where le.owner_id = p_owner_id
        and le.event_type = 'view'
        and le.session_id is not null
        and le.link_id in (select id from active_links)
    ) as unique_viewers,
    coalesce((select sum(download_count) from active_links), 0)::bigint as downloads,
    coalesce((select sum(denied_count) from active_links), 0)::bigint as denied;
$$;

revoke all on function public.get_owner_overview(uuid) from public;
revoke all on function public.get_owner_overview(uuid) from anon;
revoke all on function public.get_owner_overview(uuid) from authenticated;
grant execute on function public.get_owner_overview(uuid) to service_role;

-- ───────────────────────────────────────────────────────────
-- Top documents by reach. Keyed off link_events.file_id (set on both 'view'
-- and 'page_view'), so a file engaged inside a data-room link counts too —
-- not just direct file links.
create or replace function public.get_owner_top_documents(p_owner_id uuid, p_limit integer default 5)
returns table (
  file_id uuid,
  original_name text,
  viewers bigint,
  views bigint
)
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
  join public.files f on f.id = le.file_id and f.owner_id = p_owner_id
  where le.owner_id = p_owner_id
    and le.event_type in ('view', 'page_view')
    and le.session_id is not null
  group by f.id, f.original_name
  order by viewers desc, views desc
  limit greatest(coalesce(p_limit, 5), 1);
$$;

revoke all on function public.get_owner_top_documents(uuid, integer) from public;
revoke all on function public.get_owner_top_documents(uuid, integer) from anon;
revoke all on function public.get_owner_top_documents(uuid, integer) from authenticated;
grant execute on function public.get_owner_top_documents(uuid, integer) to service_role;

-- ───────────────────────────────────────────────────────────
-- Contacts: everyone who submitted an email (require_email gates), rolled up
-- across ALL the owner's links — the "who are my leads, and what did they
-- look at" view. Newest activity first.
create or replace function public.get_owner_contacts(p_owner_id uuid, p_limit integer default 200)
returns table (
  viewer_email text,
  documents bigint,
  sessions bigint,
  opens bigint,
  downloads bigint,
  agreed boolean,
  first_seen timestamptz,
  last_seen timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    le.viewer_email,
    count(distinct le.file_id) filter (where le.file_id is not null)::bigint as documents,
    count(distinct le.session_id)::bigint as sessions,
    count(*) filter (where le.event_type = 'view')::bigint as opens,
    count(*) filter (where le.event_type = 'download')::bigint as downloads,
    bool_or(le.event_type = 'agreement') as agreed,
    min(le.created_at) as first_seen,
    max(le.created_at) as last_seen
  from public.link_events le
  where le.owner_id = p_owner_id
    and le.viewer_email is not null
    and le.viewer_email <> ''
  group by le.viewer_email
  order by max(le.created_at) desc
  limit greatest(coalesce(p_limit, 200), 1);
$$;

revoke all on function public.get_owner_contacts(uuid, integer) from public;
revoke all on function public.get_owner_contacts(uuid, integer) from anon;
revoke all on function public.get_owner_contacts(uuid, integer) from authenticated;
grant execute on function public.get_owner_contacts(uuid, integer) to service_role;
