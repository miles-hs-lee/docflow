-- Follow-up review fixes
--
-- Addresses three review findings carried over from migration 006:
--   1. claim_view RPC was granted to anon/authenticated; only the app's
--      service_role client should call it.
--   2. claim_view counted every call, so a collection viewer hitting N
--      files burned N units of max_views/one_time. Dedup by (link, session)
--      so the same browser session counts once per link, regardless of how
--      many files it walks through.
--   3. enqueue_link_event_outbox indiscriminately queued every event into
--      the automation outbox — including the new high-volume page_view
--      events — even when no active subscription existed. Gate on both.
--   4. claim_event_outbox_jobs did not recover stale 'processing' rows;
--      a worker crash/timeout left them locked forever. Add a 15-minute
--      lease check so they re-enter the pool.

-- ───────────────────────────────────────────────────────────
-- 1 + 2: replace claim_view (session-dedup + locked-down grants)

drop function if exists public.claim_view(uuid, uuid, uuid, text, text, text);

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

  -- Has this exact session already been counted as a view of this link?
  -- A collection viewer that opens 5 files inside one session should still
  -- only consume one slot of max_views / one_time on the link itself.
  select exists (
    select 1 from public.link_events
    where link_id = p_link_id
      and session_id = p_session_id
      and event_type = 'view'
  ) into v_already_viewed;

  if v_already_viewed then
    -- Allowed but no counter bump and no new event. Per-file telemetry
    -- can be captured separately (page_view, download, etc.).
    return query select true, null::text;
    return;
  end if;

  v_effective_max := case when v_link.one_time then 1 else v_link.max_views end;
  if v_effective_max is not null and v_link.view_count >= v_effective_max then
    return query select false, 'max_views_reached'::text;
    return;
  end if;

  insert into public.link_events (
    link_id, file_id, owner_id, event_type,
    session_id, viewer_email, ip_hash, user_agent
  ) values (
    p_link_id, p_file_id, v_link.owner_id, 'view',
    p_session_id, p_viewer_email, p_ip_hash, p_user_agent
  );

  return query select true, null::text;
end;
$$;

revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text) from anon;
revoke all on function public.claim_view(uuid, uuid, uuid, text, text, text) from authenticated;
grant execute on function public.claim_view(uuid, uuid, uuid, text, text, text) to service_role;

-- ───────────────────────────────────────────────────────────
-- 3: outbox enqueue gate
--
-- Queue an event only if (a) it's not page_view (which fires per scroll
-- segment and would flood the outbox) AND (b) the owner has at least one
-- active subscription that names this event_type. If neither holds, the
-- automation system has nothing to deliver and the row would just sit.

create or replace function public.enqueue_link_event_outbox()
returns trigger
language plpgsql
as $$
declare
  v_has_subscriber boolean;
begin
  if new.event_type = 'page_view' then
    return new;
  end if;

  select exists (
    select 1 from public.automation_subscriptions
    where owner_id = new.owner_id
      and is_active = true
      and new.event_type = any(event_types)
  ) into v_has_subscriber;

  if not v_has_subscriber then
    return new;
  end if;

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
      'ipHash', new.ip_hash,
      'userAgent', new.user_agent,
      'createdAt', new.created_at
    )
  );
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 4: outbox lease expiry
--
-- A row marked 'processing' more than 15 minutes ago means its worker
-- crashed / timed out / lost the function execution. Re-include those
-- in the claimable pool so subsequent dispatch runs can retry instead
-- of leaving the job stuck forever.

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
    where (
        (o.status in ('pending', 'failed') and o.next_attempt_at <= now())
        or (o.status = 'processing' and o.locked_at < now() - interval '15 minutes')
      )
      and o.attempts < 10
    order by o.created_at asc
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 1)
  ),
  updated as (
    update public.automation_event_outbox o
    set status = 'processing',
        attempts = o.attempts + 1,
        locked_at = now()
    from picked p
    where o.id = p.id
    returning o.*
  )
  select * from updated;
end;
$$;

grant execute on function public.claim_event_outbox_jobs(integer) to service_role;
