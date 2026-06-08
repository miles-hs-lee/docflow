-- ─────────────────────────────────────────────────────────────────────────────
-- 036 — workspace hardening follow-ups (review of 035)
--
-- (1) [P1] claim_file_request_upload never set workspace_id, but 035 made
--     file_request_uploads.workspace_id NOT NULL → EVERY inbound upload now
--     aborts at the claim INSERT (the route only set workspace_id later, on the
--     confirm UPDATE, which never runs). Set workspace_id = the request's
--     workspace inside the claim insert.
-- (2) [P1] accept_workspace_invitation is SECURITY DEFINER but kept Postgres's
--     default PUBLIC EXECUTE → a direct PostgREST caller could pass a forged
--     p_user_id / p_user_email to consume an invite and join a workspace.
--     Revoke from public/anon/authenticated (service-role only, like every other
--     definer RPC).
-- (3) [P2] 035's RLS loop opened authenticated INSERT/UPDATE/DELETE on
--     link_events, file_request_uploads, data_room_questions — tables written
--     ONLY by the service-role client (anonymous visitor view/upload/question
--     paths; 023 + 028 deliberately have NO authenticated insert). A workspace
--     member could forge analytics events, upload rows, and questions over
--     PostgREST. Drop those write policies (membership SELECT stays).
-- (4) [P2] delete_*_cascade / hard_delete_link were still gated by owner_id, so
--     in a SHARED workspace a member couldn't delete a resource another member
--     created. Re-scope to workspace_id (the app already verifies membership).
--
-- Re-runnable: claim is create-or-replace; revokes are idempotent; policy drops
-- use IF EXISTS; the delete RPCs drop-then-create (param rename owner→workspace).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) file-request upload claim now sets workspace_id ───────────────────────
create or replace function public.claim_file_request_upload(
  p_request_id uuid,
  p_upload_id uuid,
  p_uploader_email text,
  p_original_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_ip_hash text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.file_requests%rowtype;
begin
  select * into v_req from public.file_requests where id = p_request_id for update;
  if not found or v_req.deleted_at is not null then
    return 'not_found';
  end if;
  if not v_req.is_active then
    return 'closed';
  end if;
  if v_req.expires_at is not null and v_req.expires_at < now() then
    return 'expired';
  end if;
  if v_req.max_uploads is not null and v_req.upload_count >= v_req.max_uploads then
    return 'limit_reached';
  end if;

  insert into public.file_request_uploads
    (id, request_id, owner_id, workspace_id, uploader_email, original_name, storage_path, mime_type, size_bytes, ip_hash)
  values
    (p_upload_id, p_request_id, v_req.owner_id, v_req.workspace_id, p_uploader_email, p_original_name, p_storage_path, p_mime_type, p_size_bytes, p_ip_hash);

  return 'ok';
end;
$$;
revoke all on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) from public;
revoke all on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) from anon;
revoke all on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) from authenticated;
grant execute on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) to service_role;

-- ── 2) lock down accept_workspace_invitation (definer → service-role only) ────
revoke all on function public.accept_workspace_invitation(text, uuid, text) from public;
revoke all on function public.accept_workspace_invitation(text, uuid, text) from anon;
revoke all on function public.accept_workspace_invitation(text, uuid, text) from authenticated;
grant execute on function public.accept_workspace_invitation(text, uuid, text) to service_role;

-- ── 3) drop authenticated write policies on service-role-only tables ─────────
-- Written exclusively by the service-role client (anon/visitor paths). The
-- ws_read_* membership SELECT policies from 035 remain, so dashboards still read.
drop policy if exists "ws_insert_link_events"          on public.link_events;
drop policy if exists "ws_update_link_events"          on public.link_events;
drop policy if exists "ws_delete_link_events"          on public.link_events;
drop policy if exists "ws_insert_file_request_uploads" on public.file_request_uploads;
drop policy if exists "ws_update_file_request_uploads" on public.file_request_uploads;
drop policy if exists "ws_delete_file_request_uploads" on public.file_request_uploads;
drop policy if exists "ws_insert_data_room_questions"  on public.data_room_questions;
drop policy if exists "ws_update_data_room_questions"  on public.data_room_questions;
drop policy if exists "ws_delete_data_room_questions"  on public.data_room_questions;

-- ── 4) re-scope delete RPCs from owner_id to workspace_id ────────────────────
-- The app already gates the resource to the caller's workspace; the RPC's second
-- owner_id check was too strict for shared workspaces. Param NAME changes
-- (p_owner_id → p_workspace_id) so DROP before CREATE.

drop function if exists public.hard_delete_link(uuid, uuid);
create or replace function public.hard_delete_link(p_link_id uuid, p_workspace_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_exists boolean;
begin
  select exists (
    select 1 from public.share_links
    where id = p_link_id and workspace_id = p_workspace_id and deleted_at is not null
  ) into v_exists;
  if not v_exists then
    return false;
  end if;
  delete from public.link_events where link_id = p_link_id and workspace_id = p_workspace_id;
  delete from public.share_links where id = p_link_id and workspace_id = p_workspace_id;
  return true;
end;
$$;
revoke all on function public.hard_delete_link(uuid, uuid) from public;
revoke all on function public.hard_delete_link(uuid, uuid) from anon;
revoke all on function public.hard_delete_link(uuid, uuid) from authenticated;
grant execute on function public.hard_delete_link(uuid, uuid) to service_role;

drop function if exists public.delete_file_cascade(uuid, uuid);
create or replace function public.delete_file_cascade(p_file_id uuid, p_workspace_id uuid)
returns table (status text)
language plpgsql security definer set search_path = public as $$
declare
  v_workspace uuid;
  v_active_file_links integer;
  v_active_collection_links integer;
begin
  select workspace_id into v_workspace from public.files where id = p_file_id for update;
  if v_workspace is null or v_workspace <> p_workspace_id then
    return query select 'not_found'::text; return;
  end if;

  -- Lock collections that contain this file (blocks racing share_link inserts).
  perform 1 from public.collections c
  where exists (select 1 from public.collection_files cf where cf.file_id = p_file_id and cf.collection_id = c.id)
  for update;

  select count(*) into v_active_file_links from public.share_links
  where file_id = p_file_id and workspace_id = p_workspace_id and deleted_at is null;
  if v_active_file_links > 0 then
    return query select 'active_links_exist'::text; return;
  end if;

  select count(*) into v_active_collection_links from public.share_links sl
  where sl.workspace_id = p_workspace_id and sl.deleted_at is null
    and sl.collection_id in (select cf.collection_id from public.collection_files cf where cf.file_id = p_file_id);
  if v_active_collection_links > 0 then
    return query select 'active_collection_links_exist'::text; return;
  end if;

  delete from public.link_events
  where link_id in (select id from public.share_links where file_id = p_file_id and workspace_id = p_workspace_id);
  delete from public.share_links where file_id = p_file_id and workspace_id = p_workspace_id;
  delete from public.files where id = p_file_id and workspace_id = p_workspace_id;
  return query select 'ok'::text;
end;
$$;
revoke all on function public.delete_file_cascade(uuid, uuid) from public;
revoke all on function public.delete_file_cascade(uuid, uuid) from anon;
revoke all on function public.delete_file_cascade(uuid, uuid) from authenticated;
grant execute on function public.delete_file_cascade(uuid, uuid) to service_role;

drop function if exists public.delete_collection_cascade(uuid, uuid);
create or replace function public.delete_collection_cascade(p_collection_id uuid, p_workspace_id uuid)
returns table (status text)
language plpgsql security definer set search_path = public as $$
declare
  v_workspace uuid;
  v_active integer;
begin
  select workspace_id into v_workspace from public.collections where id = p_collection_id for update;
  if v_workspace is null or v_workspace <> p_workspace_id then
    return query select 'not_found'::text; return;
  end if;

  select count(*) into v_active from public.share_links
  where collection_id = p_collection_id and workspace_id = p_workspace_id and deleted_at is null;
  if v_active > 0 then
    return query select 'active_links_exist'::text; return;
  end if;

  delete from public.link_events
  where link_id in (select id from public.share_links where collection_id = p_collection_id and workspace_id = p_workspace_id);
  delete from public.share_links where collection_id = p_collection_id and workspace_id = p_workspace_id;
  delete from public.collections where id = p_collection_id and workspace_id = p_workspace_id;
  return query select 'ok'::text;
end;
$$;
revoke all on function public.delete_collection_cascade(uuid, uuid) from public;
revoke all on function public.delete_collection_cascade(uuid, uuid) from anon;
revoke all on function public.delete_collection_cascade(uuid, uuid) from authenticated;
grant execute on function public.delete_collection_cascade(uuid, uuid) to service_role;
