-- 023_file_requests.sql
-- File Request (inbound upload): a tokened public page where a visitor uploads
-- files to the owner — the reverse of a share link. Net-new flow; uploads land
-- in a dedicated private bucket + their own table, kept separate from the
-- owner's curated `files` (which feed share links). Broad file types allowed.

-- ───────────────────────────────────────────────────────────
-- A request the owner publishes. token addresses the public /r/<token> page.
create table if not exists public.file_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (char_length(token) >= 32),
  title text not null check (char_length(trim(title)) > 0),
  instructions text,
  require_email boolean not null default false,
  is_active boolean not null default true,
  expires_at timestamptz,
  max_uploads integer check (max_uploads is null or max_uploads > 0),
  upload_count bigint not null default 0 check (upload_count >= 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_file_requests_owner on public.file_requests(owner_id, created_at desc);

drop trigger if exists trg_file_requests_updated_at on public.file_requests;
create trigger trg_file_requests_updated_at
before update on public.file_requests
for each row
execute function public.set_updated_at();

-- One uploaded file. Owner-denormalized for simple RLS + listing. Storage object
-- lives in the 'request-uploads' bucket at storage_path.
create table if not exists public.file_request_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.file_requests(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  uploader_email text,
  original_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_file_request_uploads_request
  on public.file_request_uploads(request_id, created_at desc);
create index if not exists idx_file_request_uploads_owner on public.file_request_uploads(owner_id);

-- Keep file_requests.upload_count accurate on both insert (new upload) and
-- delete (owner cleanup, or the upload route's compensating delete on a storage
-- failure). During a request cascade-delete the parent update simply hits 0 rows.
create or replace function public.bump_request_upload_count()
returns trigger
language plpgsql
as $$
begin
  update public.file_requests
  set upload_count = upload_count + 1
  where id = new.request_id;
  return new;
end;
$$;

drop trigger if exists trg_bump_request_upload_count on public.file_request_uploads;
create trigger trg_bump_request_upload_count
after insert on public.file_request_uploads
for each row
execute function public.bump_request_upload_count();

create or replace function public.drop_request_upload_count()
returns trigger
language plpgsql
as $$
begin
  update public.file_requests
  set upload_count = greatest(upload_count - 1, 0)
  where id = old.request_id;
  return old;
end;
$$;

drop trigger if exists trg_drop_request_upload_count on public.file_request_uploads;
create trigger trg_drop_request_upload_count
after delete on public.file_request_uploads
for each row
execute function public.drop_request_upload_count();

-- ───────────────────────────────────────────────────────────
-- RLS — owner-scoped. Visitor uploads are written by the service-role client
-- (bypasses RLS), so there is intentionally NO authenticated insert policy on
-- file_request_uploads: an authenticated user can never insert an upload row.
alter table public.file_requests enable row level security;

create policy "owners can view own file requests"
  on public.file_requests for select to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own file requests"
  on public.file_requests for insert to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own file requests"
  on public.file_requests for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own file requests"
  on public.file_requests for delete to authenticated
  using (owner_id = auth.uid());

alter table public.file_request_uploads enable row level security;

create policy "owners can view own request uploads"
  on public.file_request_uploads for select to authenticated
  using (owner_id = auth.uid());

create policy "owners can delete own request uploads"
  on public.file_request_uploads for delete to authenticated
  using (owner_id = auth.uid());

-- ───────────────────────────────────────────────────────────
-- Private bucket for inbound uploads. Broad document types; 50MB cap matches
-- the owner upload route. The allowed_mime_types list is a server-side backstop
-- (Supabase Storage rejects an upload whose contentType is not in this set).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-uploads',
  'request-uploads',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

-- ───────────────────────────────────────────────────────────
-- 'file_uploaded' becomes a subscribable automation event so owners can be
-- notified (Teams/webhook) when a visitor uploads. File uploads never write
-- link_events, so that constraint is untouched — only the subscription set
-- (021's version) is widened.
alter table public.automation_subscriptions
  drop constraint if exists automation_subscriptions_event_types_check;
alter table public.automation_subscriptions
  add constraint automation_subscriptions_event_types_check check (
    event_types <@ array['view', 'denied', 'email_submitted', 'password_failed', 'download', 'agreement', 'file_uploaded']::text[]
    and array_length(event_types, 1) > 0
  );
