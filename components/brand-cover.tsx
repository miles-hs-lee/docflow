import type { ViewerBranding } from '@/lib/types';

// Optional wide hero/cover banner for the public branded LANDING surfaces:
// the viewer access gate, the empty-data-room screen, and the file-request
// page. Renders nothing when no cover image is set (so it's safe to drop into
// any card unconditionally). Background-image (not <img>) keeps it consistent
// with BrandMark + dodges the no-img-element lint; an SVG rendered via
// background-image cannot execute scripts.
export function BrandCover({ branding }: { branding: ViewerBranding | null }) {
  if (!branding?.cover_image_url) return null;
  return (
    <div
      className="brand-cover"
      role="img"
      aria-label={branding.company_name ? `${branding.company_name} 커버 이미지` : '커버 이미지'}
      style={{ backgroundImage: `url("${branding.cover_image_url}")` }}
    />
  );
}
