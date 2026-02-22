-- Collections (multi-file bundles)
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_files (
  collection_id uuid not null references public.collections(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (collection_id, file_id)
);

create index if not exists idx_collections_owner_id on public.collections(owner_id);
create index if not exists idx_collection_files_collection_id on public.collection_files(collection_id);
create index if not exists idx_collection_files_owner_id on public.collection_files(owner_id);

do $$
begin
  alter table public.share_links alter column file_id drop not null;
exception
  when undefined_column then null;
end $$;

alter table public.share_links add column if not exists collection_id uuid references public.collections(id) on delete cascade;

create index if not exists idx_share_links_collection_id on public.share_links(collection_id);

do $$
begin
  alter table public.share_links drop constraint if exists share_links_target_check;
  alter table public.share_links add constraint share_links_target_check
    check (((file_id is not null)::int + (collection_id is not null)::int) = 1);
exception
  when duplicate_object then null;
end $$;

create trigger trg_collections_updated_at
before update on public.collections
for each row
execute function public.set_updated_at();

alter table public.collections enable row level security;
alter table public.collection_files enable row level security;

create policy "owners can view own collections"
  on public.collections
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own collections"
  on public.collections
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own collections"
  on public.collections
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own collections"
  on public.collections
  for delete
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can view own collection files"
  on public.collection_files
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own collection files"
  on public.collection_files
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own collection files"
  on public.collection_files
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own collection files"
  on public.collection_files
  for delete
  to authenticated
  using (owner_id = auth.uid());
