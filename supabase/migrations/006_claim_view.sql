-- Atomic view claim
--
-- evaluateBasePolicy + recordLinkEvent('view') were two separate steps; under
-- concurrency, two requests against a max_views=1 link could both pass the
-- policy check (view_count was still 0 in both reads) and both serve the
-- document. The bump_link_counters() trigger then incremented to 2.
--
-- claim_view() does the read, the policy check, the event insert, and the
-- counter bump inside a single SELECT ... FOR UPDATE transaction so the
-- second concurrent caller sees the already-incremented count and is denied.

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

  v_effective_max := case when v_link.one_time then 1 else v_link.max_views end;
  if v_effective_max is not null and v_link.view_count >= v_effective_max then
    return query select false, 'max_views_reached'::text;
    return;
  end if;

  -- Insert the view event. The existing bump_link_counters() trigger will
  -- increment view_count atomically as part of this same transaction. The
  -- row lock above guarantees the next concurrent caller sees the bumped
  -- value when it re-reads.
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

-- Allow service-role + authenticated callers (the document/download routes
-- both run with the admin client; granting on the function explicitly is
-- harmless and forward-compatible with future RLS-aware callers).
grant execute on function public.claim_view(uuid, uuid, uuid, text, text, text)
  to service_role, authenticated, anon;
