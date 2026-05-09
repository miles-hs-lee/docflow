-- RPC permission lockdown + atomic hard-delete
--
-- 1. Postgres functions are EXECUTE-able by PUBLIC by default. Several
--    SECURITY DEFINER analytics RPCs in 001/003 had `grant ... to service_role`
--    (or authenticated) but no explicit revoke, leaving the PUBLIC default
--    intact. Anyone with anon/authenticated access could call them and
--    bypass RLS via the definer privilege. Migration 007 already locked
--    down claim_view; this migration finishes the job.
--
-- 2. hardDeleteLinkAction (lib/actions/owner.ts) ran two separate writes
--    (DELETE FROM link_events; DELETE FROM share_links) against an admin
--    client. If the second write failed, the first one had already
--    committed and the link survived without its events. Wrap both in a
--    single PL/pgSQL function so the work shares one transaction.

-- ───────────────────────────────────────────────────────────
-- 1. Lock down all SECURITY DEFINER RPCs

revoke all on function public.get_owner_link_metrics(uuid) from public;
revoke all on function public.get_owner_link_metrics(uuid) from anon;
revoke all on function public.get_owner_link_metrics(uuid) from authenticated;
grant execute on function public.get_owner_link_metrics(uuid) to authenticated;
-- ^^ Owner UI (RSC under requireOwner) calls this with the user's session;
--    keeping authenticated EXECUTE is intentional. The function filters
--    by `where sl.owner_id = auth.uid()` so other users see nothing.

revoke all on function public.get_denied_reason_breakdown(uuid) from public;
revoke all on function public.get_denied_reason_breakdown(uuid) from anon;
revoke all on function public.get_denied_reason_breakdown(uuid) from authenticated;
grant execute on function public.get_denied_reason_breakdown(uuid) to authenticated;
-- Same rationale as above — auth.uid() filtered.

revoke all on function public.claim_event_outbox_jobs(integer) from public;
revoke all on function public.claim_event_outbox_jobs(integer) from anon;
revoke all on function public.claim_event_outbox_jobs(integer) from authenticated;
grant execute on function public.claim_event_outbox_jobs(integer) to service_role;

revoke all on function public.get_link_summary_for_owner(uuid, uuid) from public;
revoke all on function public.get_link_summary_for_owner(uuid, uuid) from anon;
revoke all on function public.get_link_summary_for_owner(uuid, uuid) from authenticated;
grant execute on function public.get_link_summary_for_owner(uuid, uuid) to service_role;

revoke all on function public.get_link_denied_breakdown_for_owner(uuid, uuid) from public;
revoke all on function public.get_link_denied_breakdown_for_owner(uuid, uuid) from anon;
revoke all on function public.get_link_denied_breakdown_for_owner(uuid, uuid) from authenticated;
grant execute on function public.get_link_denied_breakdown_for_owner(uuid, uuid) to service_role;

-- ───────────────────────────────────────────────────────────
-- 2. Atomic hard delete

create or replace function public.hard_delete_link(p_link_id uuid, p_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  -- Confirm the link exists, belongs to this owner, and is in the trash.
  -- If anything fails the function aborts (no rows touched) — caller can
  -- safely treat the boolean return as "deletion happened or not".
  select exists (
    select 1 from public.share_links
    where id = p_link_id
      and owner_id = p_owner_id
      and deleted_at is not null
  ) into v_exists;

  if not v_exists then
    return false;
  end if;

  delete from public.link_events
  where link_id = p_link_id and owner_id = p_owner_id;

  delete from public.share_links
  where id = p_link_id and owner_id = p_owner_id;

  return true;
end;
$$;

revoke all on function public.hard_delete_link(uuid, uuid) from public;
revoke all on function public.hard_delete_link(uuid, uuid) from anon;
revoke all on function public.hard_delete_link(uuid, uuid) from authenticated;
grant execute on function public.hard_delete_link(uuid, uuid) to service_role;
