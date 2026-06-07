-- 033_workspaces_phase_c.sql
-- TEAMS / WORKSPACES — PHASE C (workspace-membership reads) + claim_view tag.
--
-- Design note — why this is purely ADDITIVE and safe:
--   The app writes every tenanted table through the service-role admin client
--   (which BYPASSES RLS) and uses the RLS-scoped client ONLY for dashboard
--   reads. So the only load-bearing RLS is SELECT. We therefore just ADD a
--   workspace-membership SELECT policy to each of the 15 tenanted tables. RLS
--   OR-combines policies per command, so SELECT becomes
--     (owner_id = auth.uid())  OR  is_workspace_member(workspace_id)
--   — strictly broader than before, so no existing read can break. For a user
--   with a single (personal) workspace the two disjuncts coincide, so there is
--   ZERO visible change until Phase D introduces multi-membership; at that point
--   a teammate sees the workspace's rows via the membership disjunct.
--
--   The existing owner_id INSERT/UPDATE/DELETE policies (incl. 012's cross-owner
--   parent checks on share_links / collection_files) are LEFT INTACT as
--   defense-in-depth — the app never writes these tables via the RLS client, so
--   they are not load-bearing. Converting writes to workspace-role checks and
--   retiring the now-redundant owner SELECT policies is a later cleanup, after
--   Phase D proves membership reads in production.
--
-- Also tags the view event inserted inside claim_view() with workspace_id (the
-- last app insert path that wasn't workspace-tagged), so view events remain
-- visible under the membership SELECT policy.

-- ── claim_view: carry the link's workspace_id onto the view event ────────────
create or replace function public.claim_view(
  p_link_id uuid,
  p_file_id uuid,
  p_session_id uuid,
  p_viewer_email text,
  p_ip_hash text,
  p_user_agent text
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_effective_max int;
begin
  select * into v_link from public.share_links where id = p_link_id for update;

  if v_link.id is null then
    return query select false, 'file_missing'::text;
    return;
  end if;

  if v_link.deleted_at is not null then
    return query select false, 'deleted'::text;
    return;
  end if;

  if v_link.is_active is false then
    return query select false, 'inactive'::text;
    return;
  end if;

  if v_link.expires_at is not null and v_link.expires_at < now() then
    return query select false, 'expired'::text;
    return;
  end if;

  v_effective_max := case when v_link.one_time then 1 else v_link.max_views end;
  if v_effective_max is not null and v_link.view_count >= v_effective_max then
    return query select false, 'max_views_reached'::text;
    return;
  end if;

  insert into public.link_events (
    link_id, file_id, owner_id, workspace_id, event_type,
    session_id, viewer_email, ip_hash, user_agent
  ) values (
    p_link_id, p_file_id, v_link.owner_id, v_link.workspace_id, 'view',
    p_session_id, p_viewer_email, p_ip_hash, p_user_agent
  );

  return query select true, null::text;
end;
$$;

grant execute on function public.claim_view(uuid, uuid, uuid, text, text, text)
  to service_role, authenticated, anon;

-- ── membership SELECT policies (additive; OR-combined with owner policies) ────
do $$
declare
  t text;
  tables text[] := array[
    'files', 'share_links', 'link_events', 'collections', 'collection_files',
    'folders', 'viewer_groups', 'viewer_group_folders', 'file_requests',
    'file_request_uploads', 'owner_branding', 'collection_branding',
    'data_room_questions', 'mcp_api_keys', 'automation_subscriptions'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', 'workspace members read ' || t, t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      'workspace members read ' || t, t
    );
  end loop;
end $$;
