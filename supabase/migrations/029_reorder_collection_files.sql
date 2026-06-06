-- 029_reorder_collection_files.sql
-- Atomic, UPDATE-ONLY reorder for a data-room container (root or a folder).
--
-- Replaces the app-side upsert that persisted a reorder: upsert's INSERT path
-- could resurrect a membership removed concurrently between the member SELECT
-- and the write (re-adding the file at folder_id NULL), and the even earlier N
-- parallel UPDATEs could half-apply on a partial failure. This RPC is ONE
-- statement that only ever touches rows that already exist (file_ids not present
-- in the container simply don't match the WHERE), so it can neither insert nor
-- partially apply. sort_order is set to each id's 0-based position; folder_id is
-- never touched. Owner-scoped via p_owner_id (the app passes the authed owner).

create or replace function public.reorder_collection_files(
  p_collection_id uuid,
  p_owner_id uuid,
  p_file_ids uuid[]
)
returns void
language sql
as $$
  update public.collection_files cf
  set sort_order = o.ord - 1
  from unnest(p_file_ids) with ordinality as o(file_id, ord)
  where cf.collection_id = p_collection_id
    and cf.owner_id = p_owner_id
    and cf.file_id = o.file_id;
$$;

-- The app calls this with the service-role (admin) client.
grant execute on function public.reorder_collection_files(uuid, uuid, uuid[]) to service_role;
