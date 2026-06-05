-- 018_teams_nda_visitors.sql
-- Three features delivered together:
--   A. Microsoft Teams notification channel for automation subscriptions.
--   B. Clickwrap NDA / agreement gate on share links.
--   C. Visitor-centric analytics rollup RPC.

-- ───────────────────────────────────────────────────────────
-- A. Teams notification channel
--
-- automation_subscriptions already delivers to a webhook_url via the
-- outbox → QStash kick → dispatch pipeline. 'teams' reuses that whole
-- pipeline but the dispatcher formats the body as an Adaptive Card message
-- envelope (lib/notify/teams.ts) and skips HMAC signing — Teams / Power
-- Automate authenticate via the secret URL, not a signature header.
-- Default 'webhook' so every existing subscription keeps its behavior.
alter table public.automation_subscriptions
  add column if not exists destination_type text not null default 'webhook'
  check (destination_type in ('webhook', 'teams'));

-- ───────────────────────────────────────────────────────────
-- B. Clickwrap NDA / agreement gate
--
-- A new grant-layer gate (parallel to email / password): the viewer must
-- read the NDA text and click "동의" + type their name before access is
-- granted. This is a clickwrap agreement (a simple electronic signature) —
-- NOT a counter-signed eSignature. Assent is captured as a durable
-- 'agreement' event for audit.
alter table public.share_links
  add column if not exists require_agreement boolean not null default false;
alter table public.share_links
  add column if not exists agreement_text text;

-- New 'agreement' event type. Drop + re-add the CHECK with the full set
-- (mirrors migration 004's pattern for adding 'page_view').
alter table public.link_events drop constraint if exists link_events_event_type_check;
alter table public.link_events
  add constraint link_events_event_type_check
  check (event_type in ('view', 'denied', 'email_submitted', 'password_failed', 'download', 'page_view', 'agreement'));

-- Captured signer name for 'agreement' events. NULL for every other event
-- type, exactly like page_number / dwell_ms stay NULL outside page_view
-- (migration 004 precedent).
alter table public.link_events
  add column if not exists agreement_name text;

-- Fold the NDA columns into the grant fingerprint. bump_policy_version
-- (migration 005) predates these columns. Enabling require_agreement
-- already re-gates a stale grant (it carries no agreedAt), but editing the
-- NDA text must force prior signers to re-accept the new terms — so bump
-- policy_version when either column changes. CREATE OR REPLACE keeps the
-- existing trigger binding; only the function body changes.
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
      or new.agreement_text is distinct from old.agreement_text) then
    new.policy_version = coalesce(old.policy_version, 0) + 1;
  end if;
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- C. Visitor-centric analytics
--
-- One row per visitor for a link. A visitor is keyed by email when the
-- link collected one, else by session_id — so repeat visits from the same
-- identified person collapse into a single row, while anonymous sessions
-- stay distinct. Aggregates engagement (distinct pages read, total dwell),
-- downloads, and NDA agreement into a single round trip for the link detail
-- "방문자" table. SECURITY DEFINER + service-role only; the caller passes
-- p_owner_id (the function does not see auth.uid()), matching the existing
-- analytics RPCs (get_link_daily_views etc.).
create or replace function public.get_link_visitors(
  p_owner_id uuid,
  p_link_id uuid,
  p_limit integer default 100
)
returns table (
  visitor_key text,
  viewer_email text,
  sessions bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  pages_viewed bigint,
  total_dwell_ms bigint,
  downloads bigint,
  agreed boolean
)
language sql
security definer
set search_path = public
as $$
  with evt as (
    select
      coalesce(nullif(le.viewer_email, ''), le.session_id::text) as visitor_key,
      le.viewer_email,
      le.session_id,
      le.event_type,
      le.page_number,
      le.dwell_ms,
      le.created_at
    from public.link_events le
    where le.owner_id = p_owner_id
      and le.link_id = p_link_id
      and le.session_id is not null
      and le.event_type in ('view', 'page_view', 'download', 'agreement')
  )
  select
    evt.visitor_key,
    max(evt.viewer_email) as viewer_email,
    count(distinct evt.session_id)::bigint as sessions,
    min(evt.created_at) as first_seen,
    max(evt.created_at) as last_seen,
    -- page_number / dwell_ms are NULL outside page_view rows; count(distinct)
    -- and sum() both ignore NULLs, so these reduce to the page_view rows.
    count(distinct evt.page_number)::bigint as pages_viewed,
    coalesce(sum(evt.dwell_ms), 0)::bigint as total_dwell_ms,
    count(*) filter (where evt.event_type = 'download')::bigint as downloads,
    bool_or(evt.event_type = 'agreement') as agreed
  from evt
  group by evt.visitor_key
  order by max(evt.created_at) desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;

revoke all on function public.get_link_visitors(uuid, uuid, integer) from public;
revoke all on function public.get_link_visitors(uuid, uuid, integer) from anon;
revoke all on function public.get_link_visitors(uuid, uuid, integer) from authenticated;
grant execute on function public.get_link_visitors(uuid, uuid, integer) to service_role;
