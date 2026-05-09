-- Tighten delete cascade RPCs + queue failed storage cleanups
--
-- 1. delete_file_cascade / delete_collection_cascade did:
--      check exists → count active links → delete
--    With Postgres' default READ COMMITTED isolation, a concurrent
--    INSERT into share_links between the count and the delete could
--    slip a fresh active link past the gate, only to be wiped by the
--    parent's ON DELETE CASCADE moments later. Holding a FOR UPDATE
--    lock on the parent row forces concurrent share_links inserts
--    referencing this parent to wait (FK insert needs FOR KEY SHARE
--    on the referenced row), so the count + delete observe the same
--    state.
--
-- 2. deleteFileAction's storage cleanup runs best-effort after the
--    DB cascade (commit 388e781). When it fails the orphan blob
--    accumulates silently. New pending_storage_deletions table holds
--    the storage_path + reason so a future cron / sweep job can
--    retry, and operators have an audit trail.

-- ────────────────────────────────────────────────────────
-- 1. Lock-protected cascade RPCs

create or replace function public.delete_file_cascade(p_file_id uuid, p_owner_id uuid)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_active integer;
begin
  -- FOR UPDATE on the parent row: blocks any concurrent share_links
  -- INSERT that references this file_id (FK insert needs FOR KEY SHARE
  -- on the referenced row, which conflicts with FOR UPDATE).
  select owner_id into v_owner
  from public.files
  where id = p_file_id
  for update;

  if v_owner is null or v_owner <> p_owner_id then
    return query select 'not_found'::text;
    return;
  end if;

  select count(*) into v_active
  from public.share_links
  where file_id = p_file_id
    and owner_id = p_owner_id
    and deleted_at is null;

  if v_active > 0 then
    return query select 'active_links_exist'::text;
    return;
  end if;

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
  v_owner uuid;
  v_active integer;
begin
  select owner_id into v_owner
  from public.collections
  where id = p_collection_id
  for update;

  if v_owner is null or v_owner <> p_owner_id then
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


-- ────────────────────────────────────────────────────────
-- 2. Pending storage deletions queue

create table if not exists public.pending_storage_deletions (
  id bigserial primary key,
  storage_path text not null,
  reason text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0
);

create index if not exists idx_pending_storage_deletions_unprocessed
  on public.pending_storage_deletions(created_at)
  where processed_at is null;

-- service_role only — application writes here when removePdfObject fails;
-- a future sweep job (not yet implemented) reads + retries.
revoke all on table public.pending_storage_deletions from public;
revoke all on table public.pending_storage_deletions from anon;
revoke all on table public.pending_storage_deletions from authenticated;
grant select, insert, update on table public.pending_storage_deletions to service_role;
grant usage, select on sequence public.pending_storage_deletions_id_seq to service_role;
