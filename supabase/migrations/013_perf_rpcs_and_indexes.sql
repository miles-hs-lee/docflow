-- Performance: aggregation RPCs + lightweight event verify + composite indexes
--
-- 1. listPerPageStats and getMetricsForLink were pulling raw event rows
--    over the wire and aggregating in Node (Map / Set). Each owner's
--    "page heatmap" page made N round trips of N rows for a metric that
--    can be one GROUP BY in Postgres.
--
-- 2. /api/v/[token]/event called getViewerLinkByToken on every page-scroll
--    signal — three table reads (link + collection + collection_files +
--    files) per dwell event. The endpoint only needs link + owner + a
--    membership check; this migration adds get_link_for_event() and
--    resolve_collection_file() so the route can do one read per event.
--
-- 3. getViewerLinkByToken does 3-4 round trips (link → file or
--    collection → mapping → files). get_viewer_link_bundle() returns
--    everything as a single JSONB in one round trip.
--
-- 4. Existing indexes were single-column. Owner-side dashboards filter
--    by (file_id, deleted_at IS NULL) and order by created_at DESC; the
--    page-heatmap query filters (owner_id, file_id, page_number) etc.
--    Add composite/partial indexes that match the query shape.

-- ────────────────────────────────────────────────────────
-- 1. Per-page stats aggregation

create or replace function public.get_per_page_stats(
  p_owner_id uuid,
  p_file_id uuid,
  p_link_id uuid default null
)
returns table (page_number integer, views bigint, total_dwell_ms bigint)
language sql
security definer
set search_path = public
as $$
  select
    page_number,
    count(*)::bigint as views,
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

-- ────────────────────────────────────────────────────────
-- 2. Per-link unique viewer count (replaces in-memory Set)

create or replace function public.get_link_unique_views(p_owner_id uuid, p_link_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(distinct session_id)::bigint
  from public.link_events
  where owner_id = p_owner_id
    and link_id = p_link_id
    and event_type = 'view'
    and session_id is not null;
$$;

revoke all on function public.get_link_unique_views(uuid, uuid) from public;
revoke all on function public.get_link_unique_views(uuid, uuid) from anon;
revoke all on function public.get_link_unique_views(uuid, uuid) from authenticated;
grant execute on function public.get_link_unique_views(uuid, uuid) to service_role;

-- ────────────────────────────────────────────────────────
-- 3. Single-trip viewer bundle (replaces 3-4 round-trip getViewerLinkByToken)

create or replace function public.get_viewer_link_bundle(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.share_links%rowtype;
  v_file public.files%rowtype;
  v_collection public.collections%rowtype;
  v_files jsonb;
begin
  select * into v_link from public.share_links where token = p_token;
  if v_link.id is null then
    return null::jsonb;
  end if;

  if v_link.file_id is not null then
    -- defense-in-depth: only files owned by the link's owner
    select * into v_file
    from public.files
    where id = v_link.file_id and owner_id = v_link.owner_id;
  end if;

  if v_link.collection_id is not null then
    select * into v_collection
    from public.collections
    where id = v_link.collection_id and owner_id = v_link.owner_id;

    select coalesce(jsonb_agg(to_jsonb(f) order by cf.sort_order), '[]'::jsonb)
    into v_files
    from public.collection_files cf
    join public.files f
      on f.id = cf.file_id and f.owner_id = v_link.owner_id
    where cf.collection_id = v_link.collection_id
      and cf.owner_id = v_link.owner_id;
  end if;

  return jsonb_build_object(
    'link', to_jsonb(v_link),
    'file', case when v_file.id is null then null else to_jsonb(v_file) end,
    'collection', case when v_collection.id is null then null else to_jsonb(v_collection) end,
    'collection_files', coalesce(v_files, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_viewer_link_bundle(text) from public;
revoke all on function public.get_viewer_link_bundle(text) from anon;
revoke all on function public.get_viewer_link_bundle(text) from authenticated;
grant execute on function public.get_viewer_link_bundle(text) to service_role;

-- ────────────────────────────────────────────────────────
-- 4. Lightweight event-endpoint helpers
--
-- /api/v/[token]/event is high-volume (one call per page enter/exit on
-- every viewer scroll). It needs exactly: the link's id + owner + base
-- policy fields + grant policy fields, plus a fast collection-file
-- membership check when fileId comes from the client. Skip files /
-- collection / collection_files row materialization — page_view never
-- needs the parent metadata.

create or replace function public.get_link_for_event(p_token text)
returns table (
  id uuid,
  owner_id uuid,
  file_id uuid,
  collection_id uuid,
  is_active boolean,
  deleted_at timestamptz,
  expires_at timestamptz,
  max_views integer,
  one_time boolean,
  view_count bigint,
  require_email boolean,
  allowed_domains text[],
  password_hash text,
  policy_version integer
)
language sql
security definer
set search_path = public
as $$
  select id, owner_id, file_id, collection_id,
         is_active, deleted_at, expires_at,
         max_views, one_time, view_count,
         require_email, allowed_domains, password_hash, policy_version
  from public.share_links
  where token = p_token;
$$;

revoke all on function public.get_link_for_event(text) from public;
revoke all on function public.get_link_for_event(text) from anon;
revoke all on function public.get_link_for_event(text) from authenticated;
grant execute on function public.get_link_for_event(text) to service_role;


create or replace function public.collection_contains_file(
  p_collection_id uuid,
  p_file_id uuid,
  p_owner_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.collection_files
    where collection_id = p_collection_id
      and file_id = p_file_id
      and owner_id = p_owner_id
  );
$$;

revoke all on function public.collection_contains_file(uuid, uuid, uuid) from public;
revoke all on function public.collection_contains_file(uuid, uuid, uuid) from anon;
revoke all on function public.collection_contains_file(uuid, uuid, uuid) from authenticated;
grant execute on function public.collection_contains_file(uuid, uuid, uuid) to service_role;

-- ────────────────────────────────────────────────────────
-- 5. Composite + partial indexes matching dashboard / link / event queries

create index if not exists idx_share_links_file_active
  on public.share_links(file_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_share_links_collection_active
  on public.share_links(collection_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_link_events_link_created
  on public.link_events(link_id, created_at desc);

-- Better-shaped partial index for page heatmap (replaces the file_id-only
-- partial from migration 004). Old one is left in place — Postgres picks
-- the smallest scan automatically; dropping it is a follow-up if needed.
create index if not exists idx_link_events_owner_file_page_view
  on public.link_events(owner_id, file_id, page_number)
  where event_type = 'page_view';
