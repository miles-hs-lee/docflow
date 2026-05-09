-- Grant policy fingerprint
--
-- Pin every viewer grant cookie to the policy snapshot it was issued against.
-- When the owner changes any policy field on a share_link (password, expiry,
-- domain allowlist, max_views, etc.), policy_version bumps automatically and
-- all previously-issued grant cookies become invalid on next access.
--
-- Without this, a viewer who satisfied "email only" earlier could keep using
-- their cookie even after the owner adds a password requirement.

alter table public.share_links
  add column if not exists policy_version integer not null default 0;

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
      or new.deleted_at is distinct from old.deleted_at) then
    new.policy_version = coalesce(old.policy_version, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_share_links_bump_policy on public.share_links;
create trigger trg_share_links_bump_policy
before update on public.share_links
for each row
execute function public.bump_policy_version();

-- ────────────────────────────────────────────────────────────
-- Preserve link_events when their parent share_link / file is hard-deleted.
--
-- Originally link_events.{link_id, file_id} were ON DELETE CASCADE — deleting
-- a file or collection would silently wipe its audit log. Application code
-- now blocks file/collection deletion when active (non-soft-deleted) links
-- exist, so the only paths that reach here are intentional cleanup; even
-- then we want the audit row to survive (link_id / file_id become NULL).
alter table public.link_events
  alter column link_id drop not null,
  alter column file_id drop not null;

alter table public.link_events
  drop constraint if exists link_events_link_id_fkey;
alter table public.link_events
  add constraint link_events_link_id_fkey
  foreign key (link_id) references public.share_links(id) on delete set null;

alter table public.link_events
  drop constraint if exists link_events_file_id_fkey;
alter table public.link_events
  add constraint link_events_file_id_fkey
  foreign key (file_id) references public.files(id) on delete set null;
