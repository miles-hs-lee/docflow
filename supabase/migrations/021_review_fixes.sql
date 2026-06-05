-- 021_review_fixes.sql
-- Post-review hardening (Codex + self-review):
--  1. allow 'agreement' in automation_subscriptions so NDA-acceptance can be notified
--  2. index for owner-level contact aggregation
--  3. get_link_visitors: scope pages_viewed per (file, page) — collection links
--     conflated identical page numbers across files
--  4. get_owner_contacts: count only actually-viewed documents
--  5. get_collection_unique_views / get_collection_link_uniques — true distinct
--     room unique + a batched per-link unique (kills the N+1 on the room page)
--  6. folders / collection_files RLS: enforce same-owner + same-collection for
--     parent_folder_id / folder_id (defense-in-depth for the authenticated role)

-- ── 1. 'agreement' becomes a subscribable automation event ──────────────────
alter table public.automation_subscriptions
  drop constraint if exists automation_subscriptions_event_types_check;
alter table public.automation_subscriptions
  add constraint automation_subscriptions_event_types_check check (
    event_types <@ array['view', 'denied', 'email_submitted', 'password_failed', 'download', 'agreement']::text[]
    and array_length(event_types, 1) > 0
  );

-- ── 2. contact-aggregation index (get_owner_contacts groups by viewer_email) ─
create index if not exists idx_link_events_owner_email
  on public.link_events(owner_id, viewer_email)
  where viewer_email is not null;

-- ── 3. get_link_visitors: pages_viewed counts distinct (file, page) ──────────
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
  agreed boolean
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
      le.created_at
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
    -- distinct (file, page) so the same page number in two different files of a
    -- data room counts twice (it's a different document page).
    count(distinct (evt.file_id, evt.page_number)) filter (where evt.event_type = 'page_view')::bigint as pages_viewed,
    coalesce(sum(evt.dwell_ms), 0)::bigint as total_dwell_ms,
    count(*) filter (where evt.event_type = 'download')::bigint as downloads,
    bool_or(evt.event_type = 'agreement') as agreed
  from evt
  group by evt.visitor_key
  order by max(evt.created_at) desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.get_link_visitors(uuid, uuid, integer) from public;
revoke all on function public.get_link_visitors(uuid, uuid, integer) from anon;
revoke all on function public.get_link_visitors(uuid, uuid, integer) from authenticated;
grant execute on function public.get_link_visitors(uuid, uuid, integer) to service_role;

-- ── 4. get_owner_contacts: documents = distinct files actually VIEWED ────────
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
    count(distinct le.file_id) filter (
      where le.event_type in ('view', 'page_view') and le.file_id is not null
    )::bigint as documents,
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

-- ── 5. Room-level true distinct unique + batched per-link unique ─────────────
-- Replaces the per-link sum on the data-room page (which double-counted a
-- visitor who opened multiple links of the same room).
create or replace function public.get_collection_unique_views(p_owner_id uuid, p_collection_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(distinct le.session_id)::bigint
  from public.link_events le
  where le.owner_id = p_owner_id
    and le.event_type = 'view'
    and le.session_id is not null
    and le.link_id in (
      select id from public.share_links
      where collection_id = p_collection_id and owner_id = p_owner_id and deleted_at is null
    );
$$;

revoke all on function public.get_collection_unique_views(uuid, uuid) from public;
revoke all on function public.get_collection_unique_views(uuid, uuid) from anon;
revoke all on function public.get_collection_unique_views(uuid, uuid) from authenticated;
grant execute on function public.get_collection_unique_views(uuid, uuid) to service_role;

-- Per-link distinct unique for every link of a room in ONE query (the room
-- page previously fired one get_link_unique_views RPC per link → N+1).
create or replace function public.get_collection_link_uniques(p_owner_id uuid, p_collection_id uuid)
returns table (link_id uuid, unique_viewers bigint)
language sql
security definer
set search_path = public
as $$
  select sl.id as link_id, coalesce(uv.unique_viewers, 0)::bigint as unique_viewers
  from public.share_links sl
  left join lateral (
    select count(distinct le.session_id)::bigint as unique_viewers
    from public.link_events le
    where le.owner_id = p_owner_id
      and le.link_id = sl.id
      and le.event_type = 'view'
      and le.session_id is not null
  ) uv on true
  where sl.collection_id = p_collection_id
    and sl.owner_id = p_owner_id
    and sl.deleted_at is null;
$$;

revoke all on function public.get_collection_link_uniques(uuid, uuid) from public;
revoke all on function public.get_collection_link_uniques(uuid, uuid) from anon;
revoke all on function public.get_collection_link_uniques(uuid, uuid) from authenticated;
grant execute on function public.get_collection_link_uniques(uuid, uuid) to service_role;

-- ── 6. RLS: same-owner + same-collection for folder references ───────────────
-- The app writes these via the service-role client (bypasses RLS), so this is
-- defense-in-depth for any authenticated-role path: a folder's parent must live
-- in the same collection, and a file's folder must belong to the same collection.
drop policy if exists "owners can create own folders" on public.folders;
create policy "owners can create own folders"
  on public.folders for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
    and (
      parent_folder_id is null
      or exists (
        select 1 from public.folders p
        where p.id = parent_folder_id and p.owner_id = auth.uid() and p.collection_id = collection_id
      )
    )
  );

drop policy if exists "owners can update own folders" on public.folders;
create policy "owners can update own folders"
  on public.folders for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
    and (
      parent_folder_id is null
      or exists (
        select 1 from public.folders p
        where p.id = parent_folder_id and p.owner_id = auth.uid() and p.collection_id = collection_id
      )
    )
  );

drop policy if exists "owners can create own collection files" on public.collection_files;
create policy "owners can create own collection files"
  on public.collection_files for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (
      folder_id is null
      or exists (
        select 1 from public.folders f
        where f.id = folder_id and f.owner_id = auth.uid() and f.collection_id = collection_files.collection_id
      )
    )
  );

drop policy if exists "owners can update own collection files" on public.collection_files;
create policy "owners can update own collection files"
  on public.collection_files for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (
      folder_id is null
      or exists (
        select 1 from public.folders f
        where f.id = folder_id and f.owner_id = auth.uid() and f.collection_id = collection_files.collection_id
      )
    )
  );
