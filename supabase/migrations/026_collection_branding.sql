-- 026_collection_branding.sql
-- Per-data-room (collection) branding, layered ON TOP of account branding
-- (025_owner_branding). For a data-room share link, the viewer pages resolve
-- branding by FIELD-LEVEL merge: room.field ?? account.field. Logos reuse the
-- existing public `owner-logos` bucket (path prefix `${owner_id}/room-...`),
-- so no new bucket is needed.

create table if not exists public.collection_branding (
  collection_id uuid primary key references public.collections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_name text check (company_name is null or char_length(company_name) <= 80),
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_collection_branding_updated_at on public.collection_branding;
create trigger trg_collection_branding_updated_at
before update on public.collection_branding
for each row
execute function public.set_updated_at();

-- RLS — owner-scoped + the row's collection must belong to the owner (021 pattern).
-- App writes via the service-role client; public pages read via service-role too.
alter table public.collection_branding enable row level security;

create policy "owners can view own collection branding"
  on public.collection_branding for select to authenticated
  using (owner_id = auth.uid());

create policy "owners can insert own collection branding"
  on public.collection_branding for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
  );

create policy "owners can update own collection branding"
  on public.collection_branding for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
  );

create policy "owners can delete own collection branding"
  on public.collection_branding for delete to authenticated
  using (owner_id = auth.uid());
