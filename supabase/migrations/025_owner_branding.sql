-- 025_owner_branding.sql
-- Custom branding (white-label): owners brand the public viewer (/v) and
-- file-request (/r) pages with their own logo, brand color, and company name.
-- When any branding is set, the public pages hide DocFlow entirely.
-- Custom domains are intentionally OUT of scope for this pass.

-- One branding row per owner.
create table if not exists public.owner_branding (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  company_name text check (company_name is null or char_length(company_name) <= 80),
  -- #RRGGBB or NULL. Applied as the Polaris accent on the public pages.
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Object path in the owner-logos bucket; the public URL is derived from it.
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_owner_branding_updated_at on public.owner_branding;
create trigger trg_owner_branding_updated_at
before update on public.owner_branding
for each row
execute function public.set_updated_at();

-- RLS — owner-scoped. The PUBLIC pages read branding via the service-role admin
-- client (bypasses RLS); these policies cover the owner's own settings reads/writes.
alter table public.owner_branding enable row level security;

create policy "owners can view own branding"
  on public.owner_branding for select to authenticated
  using (owner_id = auth.uid());

create policy "owners can insert own branding"
  on public.owner_branding for insert to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own branding"
  on public.owner_branding for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own branding"
  on public.owner_branding for delete to authenticated
  using (owner_id = auth.uid());

-- PUBLIC logo bucket: public=true means the /object/public/ URL needs no auth or
-- storage.objects policy (logos are shown on anonymous viewer pages and aren't
-- sensitive). Writes go through the service-role client like every other bucket.
-- 2MB cap; raster + svg. SVG is only ever rendered via CSS background-image /
-- <img>, which does not execute embedded scripts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'owner-logos',
  'owner-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do nothing;
