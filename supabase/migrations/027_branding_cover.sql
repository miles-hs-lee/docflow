-- 027_branding_cover.sql
-- Cover/hero image branding, layered on top of 025_owner_branding +
-- 026_collection_branding. Mirrors the existing logo_path column on BOTH
-- branding scopes (account + per-data-room) so a cover is resolved by the same
-- field-level merge (room.cover ?? account.cover). Reuses the existing public
-- `owner-logos` bucket (path prefix `${owner_id}/cover-` / `room-...-cover-`),
-- so no new bucket is needed.
--
-- The cover surfaces on the public branded LANDING screens (viewer access gate,
-- empty data room, file-request page), not inside the full-screen PDF viewer.

alter table public.owner_branding add column if not exists cover_image_path text;
alter table public.collection_branding add column if not exists cover_image_path text;
