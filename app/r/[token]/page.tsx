import type { Metadata } from 'next';

import { Card } from '@polaris/ui';

import { BrandMark } from '@/components/brand-mark';
import { FileRequestUploader } from '@/components/file-request-uploader';
import { brandAccentStyle } from '@/lib/branding';
import { getFileRequestByToken, getOwnerBranding } from '@/lib/data';

// State (active/closed) can change at any time, so never serve a cached page.
export const dynamic = 'force-dynamic';

type FileRequestPageProps = {
  params: Promise<{ token: string }>;
};

// White-label: brand the tab / preview / favicon; never "DocFlow". noindex.
export async function generateMetadata({ params }: FileRequestPageProps): Promise<Metadata> {
  const { token } = await params;
  const base: Metadata = { robots: { index: false, follow: false } };

  const req = await getFileRequestByToken(token);
  if (!req) return { ...base, title: '파일 요청' };

  const branding = await getOwnerBranding(req.owner_id);
  if (!branding) return { ...base, title: req.title };

  return {
    ...base,
    title: branding.company_name ? `${req.title} · ${branding.company_name}` : req.title,
    description: null,
    icons: branding.logo_url ? { icon: branding.logo_url } : null
  };
}

export default async function FileRequestPage({ params }: FileRequestPageProps) {
  const { token } = await params;
  const req = await getFileRequestByToken(token);

  if (!req) {
    return (
      <main className="viewer-layout">
        <Card className="viewer-card" variant="padded">
          <h1>요청을 찾을 수 없습니다.</h1>
          <p>링크가 올바르지 않거나 더 이상 사용할 수 없습니다.</p>
        </Card>
      </main>
    );
  }

  const expired = req.expires_at ? new Date(req.expires_at) < new Date() : false;
  const closed = !req.is_active || expired;
  const limitReached = req.max_uploads !== null && req.upload_count >= req.max_uploads;
  const branding = await getOwnerBranding(req.owner_id);

  return (
    <main className="viewer-layout" style={brandAccentStyle(branding?.brand_color)}>
      <Card className="viewer-card" variant="padded">
        <div className="brand-row">
          <BrandMark branding={branding} tone="onLight" />
        </div>

        <h1>{req.title}</h1>
        {req.instructions ? <p className="muted">{req.instructions}</p> : null}

        {closed ? (
          <p>이 요청은 현재 파일을 받지 않습니다.</p>
        ) : limitReached ? (
          <p>업로드 한도에 도달하여 더 이상 파일을 받지 않습니다.</p>
        ) : (
          <>
            <p className="muted small">아래에서 파일을 업로드하면 요청한 사람에게 전달됩니다.</p>
            <FileRequestUploader token={token} requireEmail={req.require_email} />
          </>
        )}
      </Card>
    </main>
  );
}
