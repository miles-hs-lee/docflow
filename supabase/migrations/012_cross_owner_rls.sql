-- Cross-owner RLS hardening
--
-- Threat model: an authenticated user could craft a share_links INSERT
-- with file_id = <another user's file UUID> and owner_id = auth.uid().
-- The existing RLS policy only checked owner_id, so the row was accepted.
-- /api/v/[token]/document then loaded the file with the service-role
-- client (bypassing RLS) and served it to anyone who had the link token.
--
-- collection_files had the same shape: a user could weld a foreign
-- file or a foreign collection together by crafting an INSERT/UPDATE
-- whose owner_id matched themselves but whose collection_id / file_id
-- belonged to another tenant.
--
-- Fix: every WITH CHECK that touches share_links / collection_files
-- now also asserts that the referenced parent (file / collection)
-- belongs to the same auth.uid(). The application's service-role path
-- adds a defense-in-depth re-check on read (lib/data.ts).

-- ────────────────────────────────────────────────────────
-- share_links: parent-ownership in WITH CHECK

drop policy if exists "owners can create own links" on public.share_links;
create policy "owners can create own links"
  on public.share_links
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and (
      file_id is null
      or exists (select 1 from public.files f where f.id = file_id and f.owner_id = auth.uid())
    )
    and (
      collection_id is null
      or exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
    )
  );

drop policy if exists "owners can update own links" on public.share_links;
create policy "owners can update own links"
  on public.share_links
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and (
      file_id is null
      or exists (select 1 from public.files f where f.id = file_id and f.owner_id = auth.uid())
    )
    and (
      collection_id is null
      or exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────
-- collection_files: both parents must belong to auth.uid()

drop policy if exists "owners can create own collection files" on public.collection_files;
create policy "owners can create own collection files"
  on public.collection_files
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
    and exists (select 1 from public.files f where f.id = file_id and f.owner_id = auth.uid())
  );

drop policy if exists "owners can update own collection files" on public.collection_files;
create policy "owners can update own collection files"
  on public.collection_files
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (select 1 from public.collections c where c.id = collection_id and c.owner_id = auth.uid())
    and exists (select 1 from public.files f where f.id = file_id and f.owner_id = auth.uid())
  );
