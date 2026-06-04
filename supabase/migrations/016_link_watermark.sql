-- Per-link dynamic watermark toggle.
--
-- The viewer always tiled a dynamic watermark (email · time · page) over
-- the PDF. Owners want this optional per link (e.g. internal previews vs
-- external high-sensitivity shares). Default TRUE so every existing link
-- keeps its current watermarked behavior; owners opt out per link.

alter table public.share_links
  add column if not exists watermark boolean not null default true;
