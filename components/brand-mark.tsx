import { PolarisLogo } from '@polaris/ui/logos';

import type { ViewerBranding } from '@/lib/types';

type BrandMarkProps = {
  branding: ViewerBranding | null;
  // 'onDark' = dark surface (viewer topbar) → white logo chip + light text.
  // 'onLight' = light surface (file-request card) → full-color logo + dark text.
  tone: 'onDark' | 'onLight';
};

// The brand lockup on the public pages. With branding configured it shows the
// owner's logo (or company name) and NOTHING from DocFlow (white-label). With no
// branding it falls back to the default DocFlow mark.
export function BrandMark({ branding, tone }: BrandMarkProps) {
  if (branding?.logo_url) {
    return (
      <span
        className={`brand-logo${tone === 'onDark' ? ' brand-logo-chip' : ''}`}
        role="img"
        aria-label={branding.company_name || '로고'}
        style={{ backgroundImage: `url("${branding.logo_url}")` }}
      />
    );
  }

  if (branding?.company_name) {
    return <strong className={`brand-name brand-name-${tone}`}>{branding.company_name}</strong>;
  }

  return (
    <>
      <PolarisLogo variant="horizontal" tone={tone === 'onDark' ? 'negative' : 'default'} size={20} aria-hidden />
      <span className="viewer-divider" aria-hidden />
      <strong className={`brand-name brand-name-${tone}`}>DocFlow</strong>
    </>
  );
}
