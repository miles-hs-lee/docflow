import { Button, Input, Stack } from '@polaris/ui';

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

      <Stack gap={3}>
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
    </>
  );
}
