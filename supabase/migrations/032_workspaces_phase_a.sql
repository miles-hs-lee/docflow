-- 032_workspaces_phase_a.sql
-- TEAMS / WORKSPACES — PHASE A (additive only; RLS + app behavior UNCHANGED).
--
-- Re-tenants the app from per-user (owner_id) to per-workspace. This phase ONLY:
--   1) creates workspaces + workspace_members (+ role enum + membership helpers),
--   2) adds a nullable workspace_id to every user-facing owner_id table,
--   3) backfills one PERSONAL workspace per existing user and moves all their
--      rows into it (so every current row lands in exactly one workspace).
-- Existing owner_id RLS is left intact (Phase C swaps it) and the app still
-- filters by owner_id (Phase B swaps it), so this deploys with ZERO user-visible
-- change. workspace_id stays nullable until the app always sets it (later NOT
-- NULL migration). owner_id is kept as the "created_by / uploader" attribution.

-- ── role enum ────────────────────────────────────────────────────────────────
do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

-- ── workspaces ───────────────────────────────────────────────────────────────
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0 and char_length(name) <= 80),
  -- The creator (and, for personal backfill workspaces, the sole owner). The
  -- authoritative roster lives in workspace_members; this is attribution + the
  -- backfill mapping. SET NULL so a deleted user doesn't cascade the workspace.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_workspaces_updated_at on public.workspaces;
create trigger trg_workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();

-- ── workspace_members (the roster) ───────────────────────────────────────────
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists idx_workspace_members_user on public.workspace_members(user_id, workspace_id);

-- ── membership helpers (SECURITY DEFINER so they bypass RLS — used by Phase C
--    RLS + by app reads; calling them from a policy ON workspace_members does
--    NOT recurse because the definer read skips RLS). ──────────────────────────
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_workspace_role(p_workspace_id uuid, p_min public.workspace_role)
returns boolean language sql security definer stable
set search_path = public as $$
  -- Hierarchy owner > admin > member (do NOT rely on enum ordinal order).
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
      and (
        p_min = 'member'
        or (p_min = 'admin' and m.role in ('admin', 'owner'))
        or (p_min = 'owner' and m.role = 'owner')
      )
  );
$$;

grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, public.workspace_role) to authenticated, service_role;

-- ── RLS on the two new tables ────────────────────────────────────────────────
alter table public.workspaces enable row level security;

create policy "members read their workspaces" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "admins update their workspace" on public.workspaces
  for update to authenticated
  using (public.has_workspace_role(id, 'admin')) with check (public.has_workspace_role(id, 'admin'));
create policy "owner deletes their workspace" on public.workspaces
  for delete to authenticated using (public.has_workspace_role(id, 'owner'));
-- (No authenticated INSERT yet — the app creates workspaces via service-role;
--  Phase D adds member-initiated creation.)

alter table public.workspace_members enable row level security;

create policy "members read their roster" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "admins add roster" on public.workspace_members
  for insert to authenticated with check (public.has_workspace_role(workspace_id, 'admin'));
create policy "admins update roster" on public.workspace_members
  for update to authenticated
  using (public.has_workspace_role(workspace_id, 'admin')) with check (public.has_workspace_role(workspace_id, 'admin'));
create policy "admins remove roster" on public.workspace_members
  for delete to authenticated using (public.has_workspace_role(workspace_id, 'admin'));

-- ── workspace_id on every user-facing owner_id table (nullable for now) ───────
alter table public.files                 add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.share_links           add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.link_events           add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.collections           add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.collection_files      add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.folders               add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.viewer_groups         add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.viewer_group_folders  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.file_requests         add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.file_request_uploads  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.owner_branding        add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.collection_branding   add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.data_room_questions   add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.mcp_api_keys          add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.automation_subscriptions add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- ── backfill: one personal workspace per user, then map every row by owner_id ─
insert into public.workspaces (id, name, created_by)
select gen_random_uuid(), '개인 워크스페이스', u.id
from auth.users u
where not exists (select 1 from public.workspaces w where w.created_by = u.id);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.created_by, 'owner'
from public.workspaces w
where w.created_by is not null
on conflict (workspace_id, user_id) do nothing;

-- Move each row into its owner's personal workspace (rows with a NULL owner_id —
-- e.g. orphaned link_events from a deleted user — are simply left unmapped).
update public.files                 t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.share_links           t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.link_events           t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.collections           t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.collection_files      t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.folders               t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.viewer_groups         t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.viewer_group_folders  t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.file_requests         t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.file_request_uploads  t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.owner_branding        t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.collection_branding   t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.data_room_questions   t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.mcp_api_keys          t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;
update public.automation_subscriptions t set workspace_id = w.id from public.workspaces w where w.created_by = t.owner_id and t.workspace_id is null;

-- ── workspace_id indexes (RLS perf in Phase C + workspace filtering in Phase B) ─
create index if not exists idx_files_workspace                 on public.files(workspace_id);
create index if not exists idx_share_links_workspace           on public.share_links(workspace_id);
create index if not exists idx_link_events_workspace           on public.link_events(workspace_id);
create index if not exists idx_collections_workspace           on public.collections(workspace_id);
create index if not exists idx_collection_files_workspace      on public.collection_files(workspace_id);
create index if not exists idx_folders_workspace               on public.folders(workspace_id);
create index if not exists idx_viewer_groups_workspace         on public.viewer_groups(workspace_id);
create index if not exists idx_viewer_group_folders_workspace  on public.viewer_group_folders(workspace_id);
create index if not exists idx_file_requests_workspace         on public.file_requests(workspace_id);
create index if not exists idx_file_request_uploads_workspace  on public.file_request_uploads(workspace_id);
create index if not exists idx_owner_branding_workspace        on public.owner_branding(workspace_id);
create index if not exists idx_collection_branding_workspace   on public.collection_branding(workspace_id);
create index if not exists idx_data_room_questions_workspace   on public.data_room_questions(workspace_id);
create index if not exists idx_mcp_api_keys_workspace          on public.mcp_api_keys(workspace_id);
create index if not exists idx_automation_subscriptions_workspace on public.automation_subscriptions(workspace_id);
