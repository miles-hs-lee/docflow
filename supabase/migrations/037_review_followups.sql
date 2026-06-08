-- ─────────────────────────────────────────────────────────────────────────────
-- 037 — review follow-ups (automation API + new-signup lazy workspace)
--
-- (A) Race-safe, atomic personal-workspace creation. requireWorkspace() lazily
--     creates a personal workspace for a brand-new account; the app-side 2-step
--     insert (workspace + membership) could (i) create DUPLICATES under a
--     concurrent first-load (two tabs / prefetch — React cache() only dedups
--     within one request) and (ii) leave an ORPHAN workspace if the membership
--     insert failed after the workspace insert committed. Move it into one
--     SECURITY DEFINER function behind a per-user advisory lock that re-checks
--     membership before inserting.
--
-- (B) Finish the RLS write-surface lockdown 036 started. EVERY write to a
--     tenanted table goes through the service-role admin client (verified: no
--     authenticated-session .insert/.update/.delete anywhere in the app), so the
--     ws_insert/ws_update/ws_delete member policies 035 created are dead
--     PostgREST write surface — a member could forge rows directly (most notably
--     mcp_api_keys with arbitrary scopes, or automation_subscriptions that skip
--     the app's SSRF/webhook validation). Drop ALL of them; membership SELECT
--     (ws_read_*) stays so dashboards still read.
--
-- Re-runnable: function is create-or-replace; policy drops use IF EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A) atomic, race-safe personal workspace ─────────────────────────────────
create or replace function public.ensure_personal_workspace(p_user_id uuid)
returns table (
  id uuid,
  name text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  role public.workspace_role
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws_id uuid;
begin
  -- Serialize concurrent first-load creates for the same user (txn-scoped lock).
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Already a member of any workspace? Return the earliest — never create a 2nd.
  select w.id into v_ws_id
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where m.user_id = p_user_id
  order by w.created_at asc
  limit 1;

  if v_ws_id is null then
    insert into public.workspaces (name, created_by)
    values ('개인 워크스페이스', p_user_id)
    returning workspaces.id into v_ws_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws_id, p_user_id, 'owner');
  end if;

  return query
  select w.id, w.name, w.created_by, w.created_at, w.updated_at, m.role
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where w.id = v_ws_id and m.user_id = p_user_id;
end;
$$;
revoke all on function public.ensure_personal_workspace(uuid) from public;
revoke all on function public.ensure_personal_workspace(uuid) from anon;
revoke all on function public.ensure_personal_workspace(uuid) from authenticated;
grant execute on function public.ensure_personal_workspace(uuid) to service_role;

-- ── B) drop ALL authenticated write policies (service-role writes everything) ─
do $$
declare
  t text;
  tbls text[] := array[
    'files','share_links','link_events','collections','collection_files','folders',
    'viewer_groups','viewer_group_folders','file_requests','file_request_uploads',
    'owner_branding','collection_branding','data_room_questions','mcp_api_keys',
    'automation_subscriptions'
  ];
begin
  foreach t in array tbls loop
    execute format('drop policy if exists %I on public.%I', 'ws_insert_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'ws_update_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'ws_delete_' || t, t);
  end loop;
end $$;
