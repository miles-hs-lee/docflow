-- MCP API keys per owner
create table if not exists public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  key_hash text not null unique check (char_length(key_hash) = 64),
  key_prefix text not null,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_api_keys_owner_id on public.mcp_api_keys(owner_id);
create index if not exists idx_mcp_api_keys_owner_revoked on public.mcp_api_keys(owner_id, revoked_at);

-- Automation webhook subscriptions
create table if not exists public.automation_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  webhook_url text not null,
  signing_secret text,
  event_types text[] not null,
  is_active boolean not null default true,
  last_delivery_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_subscriptions_webhook_url_check check (webhook_url ~* '^https?://'),
  constraint automation_subscriptions_event_types_check check (
    event_types <@ array['view', 'denied', 'email_submitted', 'password_failed', 'download']::text[]
    and array_length(event_types, 1) > 0
  )
);

create index if not exists idx_automation_subscriptions_owner_id on public.automation_subscriptions(owner_id);
create index if not exists idx_automation_subscriptions_owner_active on public.automation_subscriptions(owner_id, is_active);

-- Event delivery outbox
create table if not exists public.automation_event_outbox (
  id bigserial primary key,
  link_event_id bigint not null unique references public.link_events(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_automation_event_outbox_pending
  on public.automation_event_outbox(status, next_attempt_at, created_at);
create index if not exists idx_automation_event_outbox_owner
  on public.automation_event_outbox(owner_id, created_at desc);

-- Per-subscription delivery results for dedupe + audit
create table if not exists public.automation_deliveries (
  id bigserial primary key,
  outbox_id bigint not null references public.automation_event_outbox(id) on delete cascade,
  subscription_id uuid not null references public.automation_subscriptions(id) on delete cascade,
  status text not null check (status in ('delivered', 'failed')),
  attempt_no integer not null default 1,
  http_status integer,
  error text,
  response_body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outbox_id, subscription_id)
);

create index if not exists idx_automation_deliveries_outbox on public.automation_deliveries(outbox_id);
create index if not exists idx_automation_deliveries_subscription on public.automation_deliveries(subscription_id, created_at desc);

drop trigger if exists trg_automation_subscriptions_updated_at on public.automation_subscriptions;
create trigger trg_automation_subscriptions_updated_at
before update on public.automation_subscriptions
for each row
execute function public.set_updated_at();

drop trigger if exists trg_automation_deliveries_updated_at on public.automation_deliveries;
create trigger trg_automation_deliveries_updated_at
before update on public.automation_deliveries
for each row
execute function public.set_updated_at();

-- Queue every link event into outbox for async automation delivery
create or replace function public.enqueue_link_event_outbox()
returns trigger
language plpgsql
as $$
begin
  insert into public.automation_event_outbox (
    link_event_id,
    owner_id,
    event_type,
    payload
  )
  values (
    new.id,
    new.owner_id,
    new.event_type,
    jsonb_build_object(
      'eventId', new.id,
      'eventType', new.event_type,
      'ownerId', new.owner_id,
      'linkId', new.link_id,
      'fileId', new.file_id,
      'reason', new.reason,
      'sessionId', new.session_id,
      'viewerEmail', new.viewer_email,
      'createdAt', new.created_at
    )
  )
  on conflict (link_event_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_link_event_outbox on public.link_events;
create trigger trg_enqueue_link_event_outbox
after insert on public.link_events
for each row
execute function public.enqueue_link_event_outbox();

-- Claim pending jobs with row-level lock to prevent duplicate workers.
create or replace function public.claim_event_outbox_jobs(p_limit integer default 20)
returns setof public.automation_event_outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select o.id
    from public.automation_event_outbox o
    where o.status in ('pending', 'failed')
      and o.next_attempt_at <= now()
      and o.attempts < 10
    order by o.created_at asc
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 1)
  ),
  updated as (
    update public.automation_event_outbox o
    set status = 'processing',
        locked_at = now(),
        attempts = o.attempts + 1
    from picked
    where o.id = picked.id
    returning o.*
  )
  select * from updated;
end;
$$;

grant execute on function public.claim_event_outbox_jobs(integer) to service_role;

create or replace function public.get_link_summary_for_owner(p_owner_id uuid, p_link_id uuid)
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
    (
      select count(distinct le.session_id)::bigint
      from public.link_events le
      where le.owner_id = p_owner_id
        and le.link_id = p_link_id
        and le.event_type = 'view'
        and le.session_id is not null
    ) as unique_viewers,
    sl.download_count as downloads,
    sl.denied_count as denied
  from public.share_links sl
  where sl.owner_id = p_owner_id
    and sl.id = p_link_id;
$$;

grant execute on function public.get_link_summary_for_owner(uuid, uuid) to service_role;

create or replace function public.get_link_denied_breakdown_for_owner(p_owner_id uuid, p_link_id uuid)
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
  where le.owner_id = p_owner_id
    and le.link_id = p_link_id
    and le.event_type = 'denied'
  group by coalesce(le.reason, 'unknown')
  order by total desc;
$$;

grant execute on function public.get_link_denied_breakdown_for_owner(uuid, uuid) to service_role;

-- RLS
alter table public.mcp_api_keys enable row level security;
alter table public.automation_subscriptions enable row level security;
alter table public.automation_event_outbox enable row level security;
alter table public.automation_deliveries enable row level security;

create policy "owners can view own mcp api keys"
  on public.mcp_api_keys
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own mcp api keys"
  on public.mcp_api_keys
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own mcp api keys"
  on public.mcp_api_keys
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own mcp api keys"
  on public.mcp_api_keys
  for delete
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can view own automation subscriptions"
  on public.automation_subscriptions
  for select
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can create own automation subscriptions"
  on public.automation_subscriptions
  for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update own automation subscriptions"
  on public.automation_subscriptions
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners can delete own automation subscriptions"
  on public.automation_subscriptions
  for delete
  to authenticated
  using (owner_id = auth.uid());
