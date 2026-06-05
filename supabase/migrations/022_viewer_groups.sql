-- 022_viewer_groups.sql
-- Data room Phase 3: viewer groups + per-folder permissions (per-link model).
--
-- A data room (collection) can define named viewer groups, each granted a set
-- of folders. A share link is optionally assigned to a group; viewers using
-- that link see ONLY the granted folders + their descendants (and, optionally,
-- root-level files). A link with no group (viewer_group_id NULL) keeps full
-- access — fully backward compatible. Granting a folder grants its whole
-- subtree (intuitive: "share the Financials folder" = everything under it).

-- ───────────────────────────────────────────────────────────
-- Named permission set, scoped to one collection (= data room).
create table if not exists public.viewer_groups (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  -- Whether grouped viewers also see root-level files (folder_id NULL = lobby).
  -- Default true: most rooms use the root as a shared lobby.
  include_root boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_viewer_groups_collection on public.viewer_groups(collection_id);
create index if not exists idx_viewer_groups_owner on public.viewer_groups(owner_id);

drop trigger if exists trg_viewer_groups_updated_at on public.viewer_groups;
create trigger trg_viewer_groups_updated_at
before update on public.viewer_groups
for each row
execute function public.set_updated_at();

-- Which folders a group can access. Granting a folder implicitly grants its
-- descendants (resolved at read time via a recursive walk). Both FKs cascade:
-- deleting a group or a folder removes the grant row.
create table if not exists public.viewer_group_folders (
  group_id uuid not null references public.viewer_groups(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, folder_id)
);

create index if not exists idx_viewer_group_folders_folder on public.viewer_group_folders(folder_id);
create index if not exists idx_viewer_group_folders_owner on public.viewer_group_folders(owner_id);

-- Assign a link to a group. NULL = full access (every existing link).
-- ON DELETE SET NULL: deleting a group reverts its links to full access.
alter table public.share_links
  add column if not exists viewer_group_id uuid references public.viewer_groups(id) on delete set null;

create index if not exists idx_share_links_viewer_group on public.share_links(viewer_group_id);

-- ───────────────────────────────────────────────────────────
-- RLS — owner-scoped, defense-in-depth (app writes via service-role client).
-- Mirrors the folders / collection_files same-owner + same-collection pattern
-- from migration 021.
alter table public.viewer_groups enable row level security;

create policy "owners can view own viewer groups"
  on public.viewer_groups for select to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own viewer groups"
  on public.viewer_groups for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
  );

create policy "owners can update own viewer groups"
  on public.viewer_groups for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
  );

create policy "owners can delete own viewer groups"
  on public.viewer_groups for delete to authenticated
  using (owner_id = auth.uid());

alter table public.viewer_group_folders enable row level security;

create policy "owners can view own group folders"
  on public.viewer_group_folders for select to authenticated
  using (owner_id = auth.uid());

-- A grant row's group and folder must both belong to the caller AND share the
-- same collection (a group cannot grant a folder from a different data room).
create policy "owners can create own group folders"
  on public.viewer_group_folders for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.viewer_groups g where g.id = group_id and g.owner_id = auth.uid())
    and exists (
      select 1
      from public.folders f
      join public.viewer_groups g on g.id = group_id
      where f.id = folder_id and f.owner_id = auth.uid() and f.collection_id = g.collection_id
    )
  );

create policy "owners can delete own group folders"
  on public.viewer_group_folders for delete to authenticated
  using (owner_id = auth.uid());

-- ───────────────────────────────────────────────────────────
-- bump_policy_version: fold viewer_group_id into the grant fingerprint, so
-- re-scoping a link (narrowing its group) invalidates any in-flight grant
-- cookie — the viewer must re-mint and gets the narrower bundle. Without this,
-- a grant-gated link (email/password/NDA) keeps serving the old, wider bundle
-- until the 6h cookie expires. CREATE OR REPLACE keeps the trigger binding.
create or replace function public.bump_policy_version()
returns trigger
language plpgsql
as $$
begin
  if (new.password_hash is distinct from old.password_hash
      or new.expires_at is distinct from old.expires_at
      or new.max_views is distinct from old.max_views
      or new.one_time is distinct from old.one_time
      or new.require_email is distinct from old.require_email
      or new.allowed_domains is distinct from old.allowed_domains
      or new.allow_download is distinct from old.allow_download
      or new.is_active is distinct from old.is_active
      or new.deleted_at is distinct from old.deleted_at
      or new.require_agreement is distinct from old.require_agreement
      or new.agreement_text is distinct from old.agreement_text
      or new.viewer_group_id is distinct from old.viewer_group_id) then
    new.policy_version = coalesce(old.policy_version, 0) + 1;
  end if;
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- get_viewer_link_bundle: when the link is assigned to a viewer group, filter
-- the returned folders + files to the group's permitted set. The permitted set
-- = the transitive closure of the granted folders (each granted folder + all
-- of its descendants), plus root files when include_root is true. When the link
-- has no group, behavior is byte-for-byte the pre-022 function.
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

    -- Resolve the group's permitted folder closure (only for grouped links).
    if v_link.viewer_group_id is not null then
      select coalesce(vg.include_root, true) into v_include_root
      from public.viewer_groups vg
      where vg.id = v_link.viewer_group_id and vg.owner_id = v_link.owner_id;

      with recursive granted(folder_id) as (
        select vgf.folder_id
        from public.viewer_group_folders vgf
        where vgf.group_id = v_link.viewer_group_id
          and vgf.owner_id = v_link.owner_id
        union   -- UNION (set): dedupes + terminates even on a diamond/cycle.
        select f.id
        from public.folders f
        join granted g on f.parent_folder_id = g.folder_id
        where f.collection_id = v_link.collection_id
          and f.owner_id = v_link.owner_id
      )
      select coalesce(array_agg(folder_id), '{}'::uuid[]) into v_closure from granted;
    end if;

    -- Each file row, augmented with its collection_files.folder_id. The group
    -- predicate is a no-op when viewer_group_id is null (guard short-circuits).
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

-- ───────────────────────────────────────────────────────────
-- link_can_view_file: group-aware membership check for the /event route, which
-- authorizes a specific file without loading the full bundle. Returns true iff
-- the file is in the link's collection AND (the link has no group OR the file's
-- folder is in the group's closure OR the file is a root file and include_root).
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

  -- File must belong to the link's collection (owner-scoped). PK(collection_id,
  -- file_id) guarantees at most one row; capture its folder placement.
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

  with recursive granted(folder_id) as (
    select vgf.folder_id
    from public.viewer_group_folders vgf
    where vgf.group_id = v_link.viewer_group_id
      and vgf.owner_id = v_link.owner_id
    union
    select f.id
    from public.folders f
    join granted g on f.parent_folder_id = g.folder_id
    where f.collection_id = v_link.collection_id
      and f.owner_id = v_link.owner_id
  )
  select coalesce(array_agg(folder_id), '{}'::uuid[]) into v_closure from granted;

  return v_folder_id = any(v_closure);
end;
$$;

revoke all on function public.link_can_view_file(uuid, uuid) from public;
revoke all on function public.link_can_view_file(uuid, uuid) from anon;
revoke all on function public.link_can_view_file(uuid, uuid) from authenticated;
grant execute on function public.link_can_view_file(uuid, uuid) to service_role;
