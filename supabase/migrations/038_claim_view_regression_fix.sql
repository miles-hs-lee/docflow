-- 038_claim_view_regression_fix.sql
-- P0 regression fix from the 2026-06 analytics review.
--
-- Migration 033 recreated claim_view() to tag the inserted 'view' event with
-- workspace_id, but used the 006 body as its base instead of 007's. Two
-- hardenings silently regressed:
--
--   1. Session dedup (007) was lost. Every claim inserted a fresh 'view' row
--      and bumped view_count via trigger. The document route claims on EVERY
--      byte-serving request (PDF.js Range bursts) and explicitly relies on
--      "claim_view is session-deduped" — without the Redis marker cache each
--      chunk inflated 조회수/신규 and burned max_views / one_time slots
--      mid-read. Even with Redis, every revisit after the 6h marker TTL
--      consumed another max_views slot and counted as a new viewer.
--
--   2. EXECUTE was re-granted to anon/authenticated (007/008 locked the
--      function to service_role). Anyone holding the public anon key and a
--      link UUID (learnable from the grant cookie name) could insert fake
--      view events with arbitrary emails or exhaust max_views via PostgREST.
--
-- This restores the 007 semantics on top of 033's workspace tagging and
-- re-locks the grants. Migration 039 extends the signature with p_country —
-- if claim_view changes again, 007 + 033 + 039 must ALL be carried forward.

create or replace function public.claim_view(
  p_link_id uuid,
  p_file_id uuid,
  p_session_id uuid,
  p_viewer_email text,
  p_ip_hash text,
  p_user_agent text
)
returns table (allowed boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
  v_effective_max int;
  v_already_viewed boolean;
begin
  select * into v_link from public.share_links where id = p_link_id for update;

  if v_link.id is null then
    return query select false, 'file_missing'::text;
    return;
  end if;

  if v_link.deleted_at is not null then
    return query select false, 'deleted'::text;
    return;
  end if;

  if v_link.is_active is false then
    return query select false, 'inactive'::text;
    return;
  end if;

  if v_link.expires_at is not null and v_link.expires_at < now() then
    return query select false, 'expired'::text;
    return;
  end if;

  -- 007 dedup: has this exact session already been counted as a view of this
  -- link? A collection viewer that opens 5 files inside one session — or a
  -- PDF.js Range burst re-claiming per chunk — must only consume one slot of
  -- max_views / one_time, and must not insert duplicate 'view' rows.
  select exists (
    select 1 from public.link_events
    where link_id = p_link_id
      and session_id = p_session_id
      and event_type = 'view'
  ) into v_already_viewed;

  if v_already_viewed then
    -- Allowed but no counter bump and no new event. Per-page telemetry is
    -- captured separately (page_view, download, etc.).
    return query select true, null::text;
    return;
  end if;

  v_effective_max := case when v_link.one_time then 1 else v_link.max_views end;
  if v_effective_max is not null and v_link.view_count >= v_effective_max then
    return query select false, 'max_views_reached'::text;
    return;
  end if;

  -- 033: carry the link's workspace_id onto the view event so it stays
  -- visible under the workspace-membership SELECT policy.
  insert into public.link_events (
    link_id, file_id, owner_id, workspace_id, event_type,
    session_id, viewer_email, ip_hash, user_agent
  ) values (
    p_link_id, p_file_id, v_link.owner_id, v_link.workspace_id, 'view',
    p_session_id, p_viewer_email, p_ip_hash, p_user_agent
  );

  return query select true, null::text;
end;
$$;

-- Re-lock: 033 re-granted to anon/authenticated; only the app's service-role
-- client may claim views (007/008 posture).
revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text) from anon;
revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text) from authenticated;
grant execute on function public.claim_view(uuid, uuid, uuid, text, text, text) to service_role;

-- The dedup existence check (and hasViewForSession in lib/data.ts) probes
-- (link_id, session_id, event_type='view') on every claim / page_view ingest.
-- The 001 index (link_id, event_type) scans ALL of a link's view rows per
-- probe; this partial composite makes the probe a single index hit.
create index if not exists idx_link_events_link_session_view
  on public.link_events(link_id, session_id)
  where event_type = 'view';
