-- 024_review_fixes_2.sql
-- Post-deploy review hardening (Codex + self-review) for Phase 3 + File Request:
--  C1. Account deletion must clean the request-uploads bucket → pending_storage_deletions
--      gains a `bucket` column so the sweeper can target either bucket.
--  C2. max_uploads must hold under concurrency → claim_file_request_upload() does an
--      atomic FOR UPDATE limit-check + insert in one txn (kills the TOCTOU window).
--  M4. The folder-closure recursive CTE was duplicated in get_viewer_link_bundle and
--      link_can_view_file → extract a single viewer_group_folder_closure() both call.

-- ── C1. Per-bucket storage-deletion queue ───────────────────────────────────
-- Default 'pdf-files' keeps every existing queued row valid; request-uploads
-- failures now enqueue with their own bucket.
alter table public.pending_storage_deletions
  add column if not exists bucket text not null default 'pdf-files';

-- ── M4. Shared viewer-group folder closure ──────────────────────────────────
-- Granted folders + all descendants for a group, owner/collection-scoped.
-- UNION (set) terminates even on a diamond/cycle. SECURITY DEFINER so the two
-- definer callers below (and the /event path) can use it.
create or replace function public.viewer_group_folder_closure(
  p_group_id uuid,
  p_collection_id uuid,
  p_owner_id uuid
)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive granted(folder_id) as (
    select vgf.folder_id
    from public.viewer_group_folders vgf
    where vgf.group_id = p_group_id
      and vgf.owner_id = p_owner_id
    union
    select f.id
    from public.folders f
    join granted g on f.parent_folder_id = g.folder_id
    where f.collection_id = p_collection_id
      and f.owner_id = p_owner_id
  )
  select folder_id from granted;
$$;

revoke all on function public.viewer_group_folder_closure(uuid, uuid, uuid) from public;
revoke all on function public.viewer_group_folder_closure(uuid, uuid, uuid) from anon;
revoke all on function public.viewer_group_folder_closure(uuid, uuid, uuid) from authenticated;
grant execute on function public.viewer_group_folder_closure(uuid, uuid, uuid) to service_role;

-- get_viewer_link_bundle — same behavior as 022, now calling the shared closure.
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
  v_folders jsonb;
  v_include_root boolean := true;
  v_closure uuid[] := '{}'::uuid[];
begin
  select * into v_link from public.share_links where token = p_token;
  if v_link.id is null then
    return null::jsonb;
  end if;

  if v_link.file_id is not null then
    select * into v_file
    from public.files
    where id = v_link.file_id and owner_id = v_link.owner_id;
  end if;

  if v_link.collection_id is not null then
    select * into v_collection
    from public.collections
    where id = v_link.collection_id and owner_id = v_link.owner_id;

    if v_link.viewer_group_id is not null then
      select coalesce(vg.include_root, true) into v_include_root
      from public.viewer_groups vg
      where vg.id = v_link.viewer_group_id and vg.owner_id = v_link.owner_id;

      select coalesce(array_agg(fid), '{}'::uuid[]) into v_closure
      from public.viewer_group_folder_closure(v_link.viewer_group_id, v_link.collection_id, v_link.owner_id) fid;
    end if;

    select coalesce(
      jsonb_agg(
        to_jsonb(f) || jsonb_build_object('folder_id', cf.folder_id)
        order by cf.sort_order
      ),
      '[]'::jsonb
    )
    into v_files
    from public.collection_files cf
    join public.files f
      on f.id = cf.file_id and f.owner_id = v_link.owner_id
    where cf.collection_id = v_link.collection_id
      and cf.owner_id = v_link.owner_id
      and (
        v_link.viewer_group_id is null
        or cf.folder_id = any(v_closure)
        or (cf.folder_id is null and v_include_root)
      );

    select coalesce(
      jsonb_agg(to_jsonb(fo) order by fo.sort_order, fo.name),
      '[]'::jsonb
    )
    into v_folders
    from public.folders fo
    where fo.collection_id = v_link.collection_id
      and fo.owner_id = v_link.owner_id
      and (v_link.viewer_group_id is null or fo.id = any(v_closure));
  end if;

  return jsonb_build_object(
    'link', to_jsonb(v_link),
    'file', case when v_file.id is null then null else to_jsonb(v_file) end,
    'collection', case when v_collection.id is null then null else to_jsonb(v_collection) end,
    'collection_files', coalesce(v_files, '[]'::jsonb),
    'folders', coalesce(v_folders, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_viewer_link_bundle(text) from public;
revoke all on function public.get_viewer_link_bundle(text) from anon;
revoke all on function public.get_viewer_link_bundle(text) from authenticated;
grant execute on function public.get_viewer_link_bundle(text) to service_role;

-- link_can_view_file — same behavior as 022, now calling the shared closure.
create or replace function public.link_can_view_file(p_link_id uuid, p_file_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.share_links%rowtype;
  v_folder_id uuid;
  v_in_collection boolean;
  v_include_root boolean := true;
  v_closure uuid[] := '{}'::uuid[];
begin
  select * into v_link from public.share_links where id = p_link_id;
  if v_link.id is null or v_link.collection_id is null then
    return false;
  end if;

  select cf.folder_id, true into v_folder_id, v_in_collection
  from public.collection_files cf
  where cf.collection_id = v_link.collection_id
    and cf.file_id = p_file_id
    and cf.owner_id = v_link.owner_id;

  if not coalesce(v_in_collection, false) then
    return false;
  end if;

  if v_link.viewer_group_id is null then
    return true;
  end if;

  select coalesce(vg.include_root, true) into v_include_root
  from public.viewer_groups vg
  where vg.id = v_link.viewer_group_id and vg.owner_id = v_link.owner_id;

  if v_folder_id is null then
    return coalesce(v_include_root, true);
  end if;

  select coalesce(array_agg(fid), '{}'::uuid[]) into v_closure
  from public.viewer_group_folder_closure(v_link.viewer_group_id, v_link.collection_id, v_link.owner_id) fid;

  return v_folder_id = any(v_closure);
end;
$$;

revoke all on function public.link_can_view_file(uuid, uuid) from public;
revoke all on function public.link_can_view_file(uuid, uuid) from anon;
revoke all on function public.link_can_view_file(uuid, uuid) from authenticated;
grant execute on function public.link_can_view_file(uuid, uuid) to service_role;

-- ── C2. Atomic upload claim ─────────────────────────────────────────────────
-- Locks the request row (FOR UPDATE), re-checks active/expiry/max_uploads, and
-- inserts the upload in one transaction so concurrent uploads cannot exceed the
-- limit. The existing after-insert trigger increments upload_count within the
-- same locked txn; the next waiter then reads the updated count. owner_id is
-- taken from the request row (never trusted from the caller). Returns a status
-- string: 'ok' | 'not_found' | 'closed' | 'expired' | 'limit_reached'.
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
    (id, request_id, owner_id, uploader_email, original_name, storage_path, mime_type, size_bytes, ip_hash)
  values
    (p_upload_id, p_request_id, v_req.owner_id, p_uploader_email, p_original_name, p_storage_path, p_mime_type, p_size_bytes, p_ip_hash);

  return 'ok';
end;
$$;

revoke all on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) from public;
revoke all on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) from anon;
revoke all on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) from authenticated;
grant execute on function public.claim_file_request_upload(uuid, uuid, text, text, text, text, bigint, text) to service_role;
