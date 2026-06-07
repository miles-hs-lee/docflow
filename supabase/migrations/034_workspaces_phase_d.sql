-- 034_workspaces_phase_d.sql
-- TEAMS / WORKSPACES — PHASE D: invitations + workspace-scoped analytics RPCs.
--
-- workspace_invitations backs the token-link invite flow (no email infra yet —
-- an admin generates a link, shares it, the invitee accepts while logged in).
-- The three get_workspace_* RPCs mirror the get_owner_* aggregates (020) but
-- scope by workspace_id, so the dashboard shows the whole workspace's analytics
-- once a team has multiple members.

-- ── workspace_invitations ────────────────────────────────────────────────────
create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (char_length(email) <= 254),
  role public.workspace_role not null default 'member',
  token text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_workspace_invitations_workspace on public.workspace_invitations(workspace_id);
create index if not exists idx_workspace_invitations_token on public.workspace_invitations(token);

alter table public.workspace_invitations enable row level security;

-- Admins/owners manage invitations (defense-in-depth; the app reads/writes via
-- the service-role admin client, and the invitee resolves a token via
-- service-role on the accept route).
create policy "admins read invitations" on public.workspace_invitations
  for select to authenticated using (public.has_workspace_role(workspace_id, 'admin'));
create policy "admins create invitations" on public.workspace_invitations
  for insert to authenticated with check (public.has_workspace_role(workspace_id, 'admin'));
create policy "admins update invitations" on public.workspace_invitations
  for update to authenticated
  using (public.has_workspace_role(workspace_id, 'admin')) with check (public.has_workspace_role(workspace_id, 'admin'));
create policy "admins delete invitations" on public.workspace_invitations
  for delete to authenticated using (public.has_workspace_role(workspace_id, 'admin'));

-- ── workspace-scoped analytics (mirror get_owner_* from 020) ─────────────────
create or replace function public.get_workspace_overview(p_workspace_id uuid)
returns table (opens bigint, unique_viewers bigint, downloads bigint, denied bigint)
language sql security definer set search_path = public as $$
  with active_links as (
    select id, open_count, download_count, denied_count
    from public.share_links
    where workspace_id = p_workspace_id and deleted_at is null
  )
  select
    coalesce((select sum(open_count) from active_links), 0)::bigint as opens,
    (
      select count(distinct le.session_id)::bigint
      from public.link_events le
      where le.workspace_id = p_workspace_id
        and le.event_type = 'view'
        and le.session_id is not null
        and le.link_id in (select id from active_links)
    ) as unique_viewers,
    coalesce((select sum(download_count) from active_links), 0)::bigint as downloads,
    coalesce((select sum(denied_count) from active_links), 0)::bigint as denied;
$$;
revoke all on function public.get_workspace_overview(uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_overview(uuid) to service_role;

create or replace function public.get_workspace_top_documents(p_workspace_id uuid, p_limit integer default 5)
returns table (file_id uuid, original_name text, viewers bigint, views bigint)
language sql security definer set search_path = public as $$
  select
    f.id as file_id,
    f.original_name,
    count(distinct le.session_id)::bigint as viewers,
    count(*) filter (where le.event_type = 'view')::bigint as views
  from public.link_events le
  join public.files f on f.id = le.file_id and f.workspace_id = p_workspace_id
  where le.workspace_id = p_workspace_id
    and le.event_type in ('view', 'page_view')
    and le.session_id is not null
  group by f.id, f.original_name
  order by viewers desc, views desc
  limit greatest(coalesce(p_limit, 5), 1);
$$;
revoke all on function public.get_workspace_top_documents(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_workspace_top_documents(uuid, integer) to service_role;

create or replace function public.get_workspace_contacts(p_workspace_id uuid, p_limit integer default 200)
returns table (
  viewer_email text, documents bigint, sessions bigint, opens bigint,
  downloads bigint, agreed boolean, first_seen timestamptz, last_seen timestamptz
)
language sql security definer set search_path = public as $$
  select
    le.viewer_email,
    count(distinct le.file_id) filter (where le.file_id is not null)::bigint as documents,
    count(distinct le.session_id)::bigint as sessions,
    count(*) filter (where le.event_type = 'view')::bigint as opens,
    count(*) filter (where le.event_type = 'download')::bigint as downloads,
    bool_or(le.event_type = 'agreement') as agreed,
    min(le.created_at) as first_seen,
    max(le.created_at) as last_seen
  from public.link_events le
  where le.workspace_id = p_workspace_id
    and le.viewer_email is not null
    and le.viewer_email <> ''
  group by le.viewer_email
  order by max(le.created_at) desc
  limit greatest(coalesce(p_limit, 200), 1);
$$;
revoke all on function public.get_workspace_contacts(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_workspace_contacts(uuid, integer) to service_role;
