-- 035_workspaces_hardening.sql
-- TEAMS / WORKSPACES — hardening pass (addresses code-review findings):
--   1) workspace_id → NOT NULL on the 15 tenanted tables (backfill + insert
--      tagging are complete; a live probe confirmed zero NULLs).
--   2) RLS cleanup: retire the now-redundant owner_id policies and replace them
--      with a clean workspace set — SELECT = is_workspace_member(workspace_id),
--      writes = has_workspace_role(workspace_id,'member'). share_links /
--      collection_files keep 012's cross-PARENT check, now cross-WORKSPACE.
--      (Still defense-in-depth — the app writes via the service-role client —
--      but the posture is now workspace-correct, not owner-only.)
--   3) reorder_collection_files / reorder_folders re-scoped from p_owner_id to
--      p_workspace_id so a room with files/folders created by DIFFERENT members
--      reorders fully (was: owner_id = p_owner_id → partial / not_found).
--   4) accept_workspace_invitation(): atomic, one-use invite acceptance with a
--      row lock that validates pending + not-expired + email match and inserts
--      membership + consumes the invite in ONE transaction.

-- ── 0) defensive re-backfill (belt-and-suspenders before SET NOT NULL) ───────
-- Any row still NULL (e.g. a link_events view recorded in the 032→033 window,
-- before claim_view tagged workspace_id) maps via owner_id → the owner's personal
-- workspace, so SET NOT NULL below can't abort on a fresh/lagged apply. Idempotent
-- — touches 0 rows on an already-tagged DB (this environment's probe showed 0).
update public.files                    t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.share_links              t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.link_events              t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.collections              t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.collection_files         t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.folders                  t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.viewer_groups            t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.viewer_group_folders     t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.file_requests            t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.file_request_uploads     t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.owner_branding           t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.collection_branding      t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.data_room_questions      t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.mcp_api_keys             t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.automation_subscriptions t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
-- link_events is the only tenanted table with a nullable owner_id (deleted-user
-- orphans, owner_id SET NULL): any still-NULL workspace_id there is unmappable, so
-- delete those orphans (already invisible under membership RLS) for a clean NOT NULL.
delete from public.link_events where workspace_id is null;

-- ── 1) NOT NULL ──────────────────────────────────────────────────────────────
alter table public.files                    alter column workspace_id set not null;
alter table public.share_links              alter column workspace_id set not null;
alter table public.link_events              alter column workspace_id set not null;
alter table public.collections              alter column workspace_id set not null;
alter table public.collection_files         alter column workspace_id set not null;
alter table public.folders                  alter column workspace_id set not null;
alter table public.viewer_groups            alter column workspace_id set not null;
alter table public.viewer_group_folders     alter column workspace_id set not null;
alter table public.file_requests            alter column workspace_id set not null;
alter table public.file_request_uploads     alter column workspace_id set not null;
alter table public.owner_branding           alter column workspace_id set not null;
alter table public.collection_branding      alter column workspace_id set not null;
alter table public.data_room_questions      alter column workspace_id set not null;
alter table public.mcp_api_keys             alter column workspace_id set not null;
alter table public.automation_subscriptions alter column workspace_id set not null;

-- ── 2) RLS cleanup ───────────────────────────────────────────────────────────
-- Drop every existing policy on the 15 tables (owner_id SELECT/INSERT/UPDATE/
-- DELETE from 001/002/012/021/… + the additive membership SELECT from 033).
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'files','share_links','link_events','collections','collection_files',
        'folders','viewer_groups','viewer_group_folders','file_requests',
        'file_request_uploads','owner_branding','collection_branding',
        'data_room_questions','mcp_api_keys','automation_subscriptions'
      ])
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Standard workspace set for the 13 tables without cross-parent constraints.
do $$
declare
  t text;
  tbls text[] := array[
    'files','link_events','collections','folders','viewer_groups',
    'viewer_group_folders','file_requests','file_request_uploads','owner_branding',
    'collection_branding','data_room_questions','mcp_api_keys','automation_subscriptions'
  ];
begin
  foreach t in array tbls loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))', 'ws_read_' || t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_workspace_role(workspace_id, ''member''))', 'ws_insert_' || t, t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_workspace_role(workspace_id, ''member'')) with check (public.has_workspace_role(workspace_id, ''member''))', 'ws_update_' || t, t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_workspace_role(workspace_id, ''member''))', 'ws_delete_' || t, t);
  end loop;
end $$;

-- share_links: writes also assert the referenced file/collection live in the
-- SAME workspace (012's cross-owner check, now cross-workspace).
drop policy if exists "ws_read_share_links" on public.share_links;
drop policy if exists "ws_insert_share_links" on public.share_links;
drop policy if exists "ws_update_share_links" on public.share_links;
drop policy if exists "ws_delete_share_links" on public.share_links;
create policy "ws_read_share_links" on public.share_links
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "ws_insert_share_links" on public.share_links
  for insert to authenticated with check (
    public.has_workspace_role(workspace_id, 'member')
    and (file_id is null or exists (select 1 from public.files f where f.id = file_id and f.workspace_id = share_links.workspace_id))
    and (collection_id is null or exists (select 1 from public.collections c where c.id = collection_id and c.workspace_id = share_links.workspace_id))
  );
create policy "ws_update_share_links" on public.share_links
  for update to authenticated
  using (public.has_workspace_role(workspace_id, 'member'))
  with check (
    public.has_workspace_role(workspace_id, 'member')
    and (file_id is null or exists (select 1 from public.files f where f.id = file_id and f.workspace_id = share_links.workspace_id))
    and (collection_id is null or exists (select 1 from public.collections c where c.id = collection_id and c.workspace_id = share_links.workspace_id))
  );
create policy "ws_delete_share_links" on public.share_links
  for delete to authenticated using (public.has_workspace_role(workspace_id, 'member'));

-- collection_files: both parents (collection + file) must share the workspace.
drop policy if exists "ws_read_collection_files" on public.collection_files;
drop policy if exists "ws_insert_collection_files" on public.collection_files;
drop policy if exists "ws_update_collection_files" on public.collection_files;
drop policy if exists "ws_delete_collection_files" on public.collection_files;
create policy "ws_read_collection_files" on public.collection_files
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "ws_insert_collection_files" on public.collection_files
  for insert to authenticated with check (
    public.has_workspace_role(workspace_id, 'member')
    and exists (select 1 from public.collections c where c.id = collection_id and c.workspace_id = collection_files.workspace_id)
    and exists (select 1 from public.files f where f.id = file_id and f.workspace_id = collection_files.workspace_id)
  );
create policy "ws_update_collection_files" on public.collection_files
  for update to authenticated
  using (public.has_workspace_role(workspace_id, 'member'))
  with check (
    public.has_workspace_role(workspace_id, 'member')
    and exists (select 1 from public.collections c where c.id = collection_id and c.workspace_id = collection_files.workspace_id)
    and exists (select 1 from public.files f where f.id = file_id and f.workspace_id = collection_files.workspace_id)
  );
create policy "ws_delete_collection_files" on public.collection_files
  for delete to authenticated using (public.has_workspace_role(workspace_id, 'member'));

-- ── 3) reorder RPCs → workspace-scoped ───────────────────────────────────────
-- Renaming the middle param (p_owner_id → p_workspace_id) requires DROP first —
-- CREATE OR REPLACE cannot rename an input parameter. Idempotent via IF EXISTS.
drop function if exists public.reorder_collection_files(uuid, uuid, uuid[]);
drop function if exists public.reorder_folders(uuid, uuid, uuid[]);

create or replace function public.reorder_collection_files(
  p_collection_id uuid,
  p_workspace_id uuid,
  p_file_ids uuid[]
)
returns void language sql as $$
  update public.collection_files cf
  set sort_order = o.ord - 1
  from unnest(p_file_ids) with ordinality as o(file_id, ord)
  where cf.collection_id = p_collection_id
    and cf.workspace_id = p_workspace_id
    and cf.file_id = o.file_id;
$$;
grant execute on function public.reorder_collection_files(uuid, uuid, uuid[]) to service_role;

create or replace function public.reorder_folders(
  p_collection_id uuid,
  p_workspace_id uuid,
  p_folder_ids uuid[]
)
returns void language sql as $$
  update public.folders f
  set sort_order = o.ord - 1
  from unnest(p_folder_ids) with ordinality as o(folder_id, ord)
  where f.collection_id = p_collection_id
    and f.workspace_id = p_workspace_id
    and f.id = o.folder_id;
$$;
grant execute on function public.reorder_folders(uuid, uuid, uuid[]) to service_role;

-- ── 4) atomic, one-use invite acceptance ─────────────────────────────────────
create or replace function public.accept_workspace_invitation(
  p_token text,
  p_user_id uuid,
  p_user_email text
)
returns table (workspace_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
declare v_inv record;
begin
  -- Row lock serializes concurrent accepts so an invite is consumed exactly once.
  select * into v_inv from public.workspace_invitations where token = p_token for update;
  if v_inv.id is null then
    return query select null::uuid, 'not_found'::text; return;
  end if;
  if v_inv.status <> 'pending' then
    return query select null::uuid, 'not_pending'::text; return;
  end if;
  if v_inv.expires_at is not null and v_inv.expires_at < now() then
    return query select null::uuid, 'expired'::text; return;
  end if;
  -- Bind to the invited email (case-insensitive) — token possession alone must
  -- not grant membership.
  if lower(trim(v_inv.email)) <> lower(trim(coalesce(p_user_email, ''))) then
    return query select null::uuid, 'email_mismatch'::text; return;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_inv.workspace_id, p_user_id, v_inv.role)
  on conflict (workspace_id, user_id) do nothing;  -- don't downgrade an existing member

  update public.workspace_invitations
  set status = 'accepted', accepted_by = p_user_id, accepted_at = now()
  where id = v_inv.id;

  return query select v_inv.workspace_id, 'ok'::text;
end;
$$;
grant execute on function public.accept_workspace_invitation(text, uuid, text) to service_role;
