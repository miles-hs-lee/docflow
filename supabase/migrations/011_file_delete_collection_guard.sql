-- Tighten file delete + harden pending_storage_deletions
--
-- 1. delete_file_cascade only counted active share_links that pointed
--    DIRECTLY at the file (file_id = p_file_id). It missed the case
--    where the file is a member of a collection that has its own active
--    share_link (collection_id = c.id). Deleting the file then dropped
--    the collection_files mapping via cascade and left the collection
--    link still active but pointing at a smaller / empty bundle.
--
--    Fix: lock every collection that contains this file, then count
--    active share_links targeting any of those collections. If any
--    exist, deny with a new status code so the application can give the
--    owner a precise error.
--
-- 2. pending_storage_deletions (migration 010) had grants revoked but
--    no row-level security, so Supabase Security Advisor / SOC2 reviews
--    will flag it as "table in public schema with RLS off." Turn RLS
--    on; service_role bypasses RLS automatically, so the application
--    keeps working without explicit policies.

-- ────────────────────────────────────────────────────────
-- 1. delete_file_cascade with collection-link guard

create or replace function public.delete_file_cascade(p_file_id uuid, p_owner_id uuid)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_active_file_links integer;
  v_active_collection_links integer;
begin
  select owner_id into v_owner
  from public.files
  where id = p_file_id
  for update;

  if v_owner is null or v_owner <> p_owner_id then
    return query select 'not_found'::text;
    return;
  end if;

  -- Lock every collection that currently contains this file. New
  -- share_links INSERTs targeting those collections will block on
  -- FOR KEY SHARE until our transaction commits, so the count below
  -- and the cascade delete that follows see a consistent view.
  perform 1
  from public.collections c
  where exists (
    select 1 from public.collection_files cf
    where cf.file_id = p_file_id and cf.collection_id = c.id
  )
  for update;

  -- Direct file-link active gate
  select count(*) into v_active_file_links
  from public.share_links
  where file_id = p_file_id
    and owner_id = p_owner_id
    and deleted_at is null;

  if v_active_file_links > 0 then
    return query select 'active_links_exist'::text;
    return;
  end if;

  -- Indirect: any active share_link targeting a collection that
  -- contains this file. Deleting the file would silently shrink /
  -- empty the bundle the link still points at.
  select count(*) into v_active_collection_links
  from public.share_links sl
  where sl.owner_id = p_owner_id
    and sl.deleted_at is null
    and sl.collection_id in (
      select cf.collection_id
      from public.collection_files cf
      where cf.file_id = p_file_id
    );

  if v_active_collection_links > 0 then
    return query select 'active_collection_links_exist'::text;
    return;
  end if;

  -- Wipe events of every share_link that referenced this file directly.
  -- Collection share_links and their events are NOT touched here — those
  -- belong to the collection's own delete path.
  delete from public.link_events
  where link_id in (
    select id from public.share_links
    where file_id = p_file_id and owner_id = p_owner_id
  );

  delete from public.share_links
  where file_id = p_file_id and owner_id = p_owner_id;

  -- file deletion cascades to collection_files (membership only — the
  -- collections themselves and their share_links survive intact).
  delete from public.files
  where id = p_file_id and owner_id = p_owner_id;

  return query select 'ok'::text;
end;
$$;

revoke all on function public.delete_file_cascade(uuid, uuid) from public;
revoke all on function public.delete_file_cascade(uuid, uuid) from anon;
revoke all on function public.delete_file_cascade(uuid, uuid) from authenticated;
grant execute on function public.delete_file_cascade(uuid, uuid) to service_role;


-- ────────────────────────────────────────────────────────
-- 2. RLS on pending_storage_deletions

alter table public.pending_storage_deletions enable row level security;

-- No policies are defined: service_role bypasses RLS, so the application
-- writes still work, and every other role gets denied automatically.
-- This satisfies "RLS enabled on every public table" advisor checks
-- without weakening the existing service_role-only access pattern.
