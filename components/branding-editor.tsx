import { Button, Input, Stack } from '@polaris/ui';

import { HiddenInput } from '@/components/hidden-input';
import { LogoUploader } from '@/components/logo-uploader';
import type { ViewerBranding } from '@/lib/types';

type BrandingFormAction = (formData: FormData) => void | Promise<void>;

type BrandingEditorProps = {
  branding: ViewerBranding | null;
  saveAction: BrandingFormAction;
  removeLogoAction: BrandingFormAction;
  /** Endpoint the LogoUploader POSTs to (account vs per-collection). */
  logoEndpoint: string;
  /** Hidden fields included in every form (e.g. collectionId for a room). */
  hiddenFields?: { name: string; value: string }[];
  /** Copy shown when no logo is set. */
  noLogoLabel?: string;
};

// Shared branding editor used by the account settings page + the per-room card.
// One place to add future fields (e.g. a cover image) for both scopes.
export function BrandingEditor({
  branding,
  saveAction,
  removeLogoAction,
  logoEndpoint,
  hiddenFields = [],
  noLogoLabel
}: BrandingEditorProps) {
  return (
    <>
      <form action={saveAction} className="form-grid">
        {hiddenFields.map((field) => (
          <HiddenInput key={field.name} name={field.name} value={field.value} />
        ))}
        <Input
          name="companyName"
          label="회사명"
          placeholder="예: Acme Inc."
          defaultValue={branding?.company_name ?? ''}
          maxLength={80}
        />
        <Input
          name="brandColor"
          label="브랜드 색상 (HEX)"
          placeholder="#RRGGBB"
          defaultValue={branding?.brand_color ?? ''}
        />
        <Button type="submit">브랜딩 저장</Button>
      </form>

      <Stack gap={3}>
        <p className="muted small">로고</p>
        {branding?.logo_url ? (
          <div
            className="brand-logo brand-logo-chip"
            role="img"
            aria-label="현재 로고"
            style={{ backgroundImage: `url("${branding.logo_url}")` }}
          />
        ) : (
          <p className="muted small">{noLogoLabel ?? '아직 업로드된 로고가 없습니다.'}</p>
        )}
        <LogoUploader endpoint={logoEndpoint} />
        {branding?.logo_url ? (
          <form action={removeLogoAction}>
            {hiddenFields.map((field) => (
              <HiddenInput key={field.name} name={field.name} value={field.value} />
            ))}
            <Button type="submit" variant="ghost" size="sm">
              로고 제거
            </Button>
          </form>
        ) : null}
      </Stack>
    </>
  );
}
