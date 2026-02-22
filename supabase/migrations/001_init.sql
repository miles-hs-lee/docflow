-- Extensions
create extension if not exists pgcrypto;

-- Files uploaded by owners
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Share links with independent policy sets
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  token text not null unique check (char_length(token) >= 32),
  is_active boolean not null default true,
  expires_at timestamptz,
  max_views integer check (max_views is null or max_views > 0),
  require_email boolean not null default false,
  allowed_domains text[] not null default '{}',
  password_hash text,
  allow_download boolean not null default false,
  one_time boolean not null default false,
  deleted_at timestamptz,
  view_count bigint not null default 0,
  download_count bigint not null default 0,
  denied_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint share_links_password_hash_len check (password_hash is null or char_length(password_hash) >= 20)
);

create index if not exists idx_share_links_file_id on public.share_links(file_id);
create index if not exists idx_share_links_owner_id on public.share_links(owner_id);
create index if not exists idx_share_links_token on public.share_links(token);
create index if not exists idx_share_links_deleted_at on public.share_links(deleted_at);

-- Audit and analytics events
create table if not exists public.link_events (
  id bigserial primary key,
  link_id uuid not null references public.share_links(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('view', 'denied', 'email_submitted', 'password_failed', 'download')),
  reason text,
  session_id uuid,
  viewer_email text,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_link_events_link_event_type on public.link_events(link_id, event_type);
create index if not exists idx_link_events_owner_created_at on public.link_events(owner_id, created_at desc);
create index if not exists idx_link_events_reason on public.link_events(reason) where event_type = 'denied';

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_files_updated_at
before update on public.files
for each row
execute function public.set_updated_at();

create trigger trg_share_links_updated_at
before update on public.share_links
for each row
execute function public.set_updated_at();

-- Counter updates on event ingest
create or replace function public.bump_link_counters()
returns trigger
language plpgsql
as $$
begin
  if new.event_type = 'view' then
    update public.share_links
      set view_count = view_count + 1,
          updated_at = now()
      where id = new.link_id;
  elsif new.event_type = 'download' then
    update public.share_links
      set download_count = download_count + 1,
          updated_at = now()
      where id = new.link_id;
  elsif new.event_type = 'denied' then
    update public.share_links
      set denied_count = denied_count + 1,
          updated_at = now()
      where id = new.link_id;
  end if;

  return new;
end;
$$;

create trigger trg_bump_link_counters
after insert on public.link_events
for each row
execute function public.bump_link_counters();

-- RLS
alter table public.files enable row level security;
alter table public.share_links enable row level security;
alter table public.link_events enable row level security;

-- files policies
create policy "owners can view own files"
  on public.files
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own files"
  on public.files
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own files"
  on public.files
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own files"
  on public.files
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- share_links policies
create policy "owners can view own links"
  on public.share_links
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own links"
  on public.share_links
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own links"
  on public.share_links
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own links"
  on public.share_links
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- link_events policies
create policy "owners can view own link events"
  on public.link_events
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can insert own link events"
  on public.link_events
  for insert
  to authenticated
  with check (owner_id = auth.uid());

-- Metrics helper for owner UI
create or replace function public.get_owner_link_metrics(p_file_id uuid)
returns table (
  link_id uuid,
  views bigint,
  unique_viewers bigint,
  downloads bigint,
  denied bigint
)
language sql
security definer
set search_path = public
as $$
  select
    sl.id as link_id,
    sl.view_count as views,
    coalesce(uv.unique_viewers, 0) as unique_viewers,
    sl.download_count as downloads,
    sl.denied_count as denied
  from public.share_links sl
  left join lateral (
    select count(distinct le.session_id)::bigint as unique_viewers
    from public.link_events le
    where le.link_id = sl.id
      and le.event_type = 'view'
  ) uv on true
  where sl.owner_id = auth.uid()
    and sl.file_id = p_file_id;
$$;

grant execute on function public.get_owner_link_metrics(uuid) to authenticated;

-- Denied reason breakdown helper
create or replace function public.get_denied_reason_breakdown(p_link_id uuid)
returns table (
  reason text,
  total bigint
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(le.reason, 'unknown') as reason,
    count(*)::bigint as total
  from public.link_events le
  where le.link_id = p_link_id
    and le.owner_id = auth.uid()
    and le.event_type = 'denied'
  group by coalesce(le.reason, 'unknown')
  order by total desc;
$$;

grant execute on function public.get_denied_reason_breakdown(uuid) to authenticated;

-- Private storage bucket for PDF objects
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdf-files', 'pdf-files', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;
