-- 019_space_folders.sql
-- Spaces Phase 1: turn a flat Collection into a folder-structured space
-- (data room). ADDITIVE — existing collections keep working with every file
-- at the space root (folder_id NULL). Collection deletion already cascades:
-- folders.collection_id and collection_files both ON DELETE CASCADE, so
-- delete_collection_cascade needs no change.

-- ───────────────────────────────────────────────────────────
-- Folder tree, scoped to a collection (= space). Self-referential.
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  -- NULL = top-level folder. Deleting a folder cascades to its subfolders.
  parent_folder_id uuid references public.folders(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_folders_collection
  on public.folders(collection_id, parent_folder_id, sort_order);
create index if not exists idx_folders_owner on public.folders(owner_id);

-- A file's place in the tree. NULL = space root. ON DELETE SET NULL so
-- deleting a folder drops its files back to the root rather than removing
-- them from the space.
alter table public.collection_files
  add column if not exists folder_id uuid references public.folders(id) on delete set null;

create index if not exists idx_collection_files_folder on public.collection_files(folder_id);

drop trigger if exists trg_folders_updated_at on public.folders;
create trigger trg_folders_updated_at
before update on public.folders
for each row
execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────
-- RLS — owner-scoped, mirroring collections / collection_files.
alter table public.folders enable row level security;

create policy "owners can view own folders"
  on public.folders for select to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own folders"
  on public.folders for insert to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own folders"
  on public.folders for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own folders"
  on public.folders for delete to authenticated
  using (owner_id = auth.uid());

-- ───────────────────────────────────────────────────────────
-- get_viewer_link_bundle now also returns the folder list, and each file
-- carries its folder_id, so the viewer can render a tree. CREATE OR REPLACE
-- keeps the existing grants. Pre-019 viewers (no 'folders' key) fall back to
-- a flat list, and folder_id is simply absent → every file renders at root.
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

    -- Each file row, augmented with its collection_files.folder_id.
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
      and cf.owner_id = v_link.owner_id;

    select coalesce(
      jsonb_agg(to_jsonb(fo) order by fo.sort_order, fo.name),
      '[]'::jsonb
    )
    into v_folders
    from public.folders fo
    where fo.collection_id = v_link.collection_id
      and fo.owner_id = v_link.owner_id;
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
