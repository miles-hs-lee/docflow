import { Button, Stack } from '@polaris/ui';

import { BrandColorField } from '@/components/brand-color-field';
import { BrandingImageUploader } from '@/components/branding-image-uploader';
import { HiddenInput } from '@/components/hidden-input';
import type { ViewerBranding } from '@/lib/types';

type BrandingFormAction = (formData: FormData) => void | Promise<void>;

type BrandingEditorProps = {
  branding: ViewerBranding | null;
  saveAction: BrandingFormAction;
  removeLogoAction: BrandingFormAction;
  removeCoverAction: BrandingFormAction;
  /** Endpoint the logo uploader POSTs to (account vs per-collection). */
  logoEndpoint: string;
  /** Endpoint the cover uploader POSTs to (account vs per-collection). */
  coverEndpoint: string;
  /** Hidden fields included in every form (e.g. collectionId for a room). */
  hiddenFields?: { name: string; value: string }[];
  /** Copy shown when no logo is set. */
  noLogoLabel?: string;
  /** Copy shown when no cover image is set. */
  noCoverLabel?: string;
};

// Shared branding editor used by the account settings page + the per-room card.
// One place to manage every branding field for both scopes (logo + cover image
// reuse the same field-parameterized uploader + remove-action shape).
//
// Layout: width-capped so it doesn't stretch edge-to-edge on desktop; the
// save/upload buttons size to content (not full-width) and logo + cover sit
// side-by-side on wide screens, collapsing to a single column on mobile.
export function BrandingEditor({
  branding,
  saveAction,
  removeLogoAction,
  removeCoverAction,
  logoEndpoint,
  coverEndpoint,
  hiddenFields = [],
  noLogoLabel,
  noCoverLabel
}: BrandingEditorProps) {
  return (
    <div className="branding-editor">
      <form action={saveAction} className="form-grid">
        {hiddenFields.map((field) => (
          <HiddenInput key={field.name} name={field.name} value={field.value} />
        ))}
        {/* Native field so the label sits ABOVE the input, matching BrandColorField
            (the Polaris Input rendered "회사명" as a floating in-field label). */}
        <label className="brand-text-field">
          회사명
          {/* eslint-disable-next-line -- native input to keep a static label above, like the colour field */}
          <input
            type="text"
            name="companyName"
            placeholder="예: Acme Inc."
            defaultValue={branding?.company_name ?? ''}
            maxLength={80}
          />
        </label>
        <BrandColorField defaultValue={branding?.brand_color ?? ''} />
        <Button type="submit">브랜딩 저장</Button>
      </form>

      <div className="branding-asset-grid">
        <Stack gap={3} className="branding-asset">
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
          <BrandingImageUploader
            endpoint={logoEndpoint}
            fieldName="logo"
            noun="로고"
            helperText="PNG·JPG·WEBP·SVG · 최대 2MB · 가로형 로고 권장"
          />
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

        <Stack gap={3} className="branding-asset">
          <p className="muted small">커버 이미지</p>
          <p className="muted small">
            공유 링크 접근 화면·빈 데이터룸·파일 요청 페이지 상단에 표시되는 가로형 배너입니다.
          </p>
          {branding?.cover_image_url ? (
            <div
              className="brand-cover brand-cover-preview"
              role="img"
              aria-label="현재 커버 이미지"
              style={{ backgroundImage: `url("${branding.cover_image_url}")` }}
            />
          ) : (
            <p className="muted small">{noCoverLabel ?? '아직 업로드된 커버 이미지가 없습니다.'}</p>
          )}
          <BrandingImageUploader
            endpoint={coverEndpoint}
            fieldName="cover"
            noun="커버 이미지"
            helperText="PNG·JPG·WEBP·SVG · 최대 2MB · 가로형(약 3:1) 배너 권장"
          />
          {branding?.cover_image_url ? (
            <form action={removeCoverAction}>
              {hiddenFields.map((field) => (
                <HiddenInput key={field.name} name={field.name} value={field.value} />
              ))}
              <Button type="submit" variant="ghost" size="sm">
                커버 이미지 제거
              </Button>
            </form>
          ) : null}
        </Stack>
      </div>
    </div>
  );
}
