-- Atomic file / collection delete
--
-- deleteFileAction and deleteCollectionAction were issuing four separate
-- admin-client writes (count active links, fetch trashed link ids, delete
-- their events, delete the trash links, delete the parent). Each step
-- was its own request; a failure between them left the DB in a partial
-- state — most often "events gone, links still there" or vice versa.
--
-- This migration moves the entire sequence into two PL/pgSQL functions
-- so the work runs inside a single transaction. The application now only
-- needs to (a) check storage cleanup separately for files and (b) call
-- the RPC and react to the returned status.

create or replace function public.delete_file_cascade(p_file_id uuid, p_owner_id uuid)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer;
begin
  if not exists (
    select 1 from public.files where id = p_file_id and owner_id = p_owner_id
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  -- Active link gate — same contract as the UI: must trash all share links
  -- for this file before the file itself can be removed.
  select count(*) into v_active
  from public.share_links
  where file_id = p_file_id
    and owner_id = p_owner_id
    and deleted_at is null;

  if v_active > 0 then
    return query select 'active_links_exist'::text;
    return;
  end if;

  -- Wipe all link_events that belong to share_links of this file
  -- (whether the share_link was trashed or not — by this point nothing
  -- non-trashed exists). Then drop the share_links rows so the FK
  -- cascade has nothing left to set NULL.
  delete from public.link_events
  where link_id in (
    select id from public.share_links
    where file_id = p_file_id and owner_id = p_owner_id
  );

  delete from public.share_links
  where file_id = p_file_id and owner_id = p_owner_id;

  delete from public.files
  where id = p_file_id and owner_id = p_owner_id;

  return query select 'ok'::text;
end;
$$;

revoke all on function public.delete_file_cascade(uuid, uuid) from public;
revoke all on function public.delete_file_cascade(uuid, uuid) from anon;
revoke all on function public.delete_file_cascade(uuid, uuid) from authenticated;
grant execute on function public.delete_file_cascade(uuid, uuid) to service_role;


create or replace function public.delete_collection_cascade(p_collection_id uuid, p_owner_id uuid)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer;
begin
  if not exists (
    select 1 from public.collections where id = p_collection_id and owner_id = p_owner_id
  ) then
    return query select 'not_found'::text;
    return;
  end if;

  select count(*) into v_active
  from public.share_links
  where collection_id = p_collection_id
    and owner_id = p_owner_id
    and deleted_at is null;

  if v_active > 0 then
    return query select 'active_links_exist'::text;
    return;
  end if;

  delete from public.link_events
  where link_id in (
    select id from public.share_links
    where collection_id = p_collection_id and owner_id = p_owner_id
  );

  delete from public.share_links
  where collection_id = p_collection_id and owner_id = p_owner_id;

  delete from public.collections
  where id = p_collection_id and owner_id = p_owner_id;

  return query select 'ok'::text;
end;
$$;

revoke all on function public.delete_collection_cascade(uuid, uuid) from public;
revoke all on function public.delete_collection_cascade(uuid, uuid) from anon;
revoke all on function public.delete_collection_cascade(uuid, uuid) from authenticated;
grant execute on function public.delete_collection_cascade(uuid, uuid) to service_role;
