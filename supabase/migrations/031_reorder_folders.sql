-- 031_reorder_folders.sql
-- Atomic, UPDATE-ONLY reorder for sibling folders within a data room — the
-- folder counterpart of reorder_collection_files (029). The app passes the
-- ordered ids of ONE parent's children; sort_order is set to each id's 0-based
-- position. Only matches existing rows (ids not in the room don't match → no
-- insert), folder names/parents are never touched. Owner + collection scoped.

create or replace function public.reorder_folders(
  p_collection_id uuid,
  p_owner_id uuid,
  p_folder_ids uuid[]
)
returns void
language sql
as $$
  update public.folders f
  set sort_order = o.ord - 1
  from unnest(p_folder_ids) with ordinality as o(folder_id, ord)
  where f.collection_id = p_collection_id
    and f.owner_id = p_owner_id
    and f.id = o.folder_id;
$$;

-- The app calls this with the service-role (admin) client.
grant execute on function public.reorder_folders(uuid, uuid, uuid[]) to service_role;
