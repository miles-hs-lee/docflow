import { Alert, AlertDescription, Badge, Button, Card, Checkbox, Input } from '@polaris/ui';

import type { Metadata } from 'next';

import { BrandMark } from '@/components/brand-mark';
import { PdfViewer } from '@/components/pdf-viewer-lazy';
import { SpaceViewerNav } from '@/components/space-viewer-nav';
import { cookies, headers } from 'next/headers';

import { brandAccentStyle } from '@/lib/branding';
import { submitViewerAccessAction } from '@/lib/actions/viewer';
import { bumpOpenCount, getOwnerBranding, getViewerLinkByToken, getViewerLinkMeta, recordLinkEvent } from '@/lib/data';
import { deniedMessage, evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import type { DeniedReason } from '@/lib/types';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type ViewerPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// White-label: when the owner has branding, the browser tab / link preview /
// favicon show their brand, never "DocFlow". Viewer links are private, so
// noindex regardless. (description/icons set to null explicitly override the
// root layout's DocFlow values.)
export async function generateMetadata({ params }: ViewerPageProps): Promise<Metadata> {
  const { token } = await params;
  const base: Metadata = { robots: { index: false, follow: false } };

  const meta = await getViewerLinkMeta(token);
  if (!meta) return { ...base, title: '문서' };

  const branding = await getOwnerBranding(meta.owner_id);
  if (!branding) return { ...base, title: meta.label };

  return {
    ...base,
    title: branding.company_name ? `${meta.label} · ${branding.company_name}` : meta.label,
    description: null,
    icons: branding.logo_url ? { icon: branding.logo_url } : null
  };
}

export default async function ViewerPage({ params, searchParams }: ViewerPageProps) {
  const { token } = await params;
  const query = await searchParams;
  const selectedFileId = typeof query.fileId === 'string' ? query.fileId : null;

  const link = await getViewerLinkByToken(token);

  if (!link) {
    return (
      <main className="viewer-layout">
        <Card className="viewer-card" variant="padded">
          <h1>문서에 접근할 수 없습니다.</h1>
          <p>요청한 링크가 존재하지 않거나 사용할 수 없습니다.</p>
        </Card>
      </main>
    );
  }

  const cookieStore = await cookies();
  const rawGrant = cookieStore.get(getGrantCookieName(link.id))?.value;
  const grant = decodeGrantCookie(rawGrant, link.id);
  const eventFileId = link.file?.id ?? link.collection_files[0]?.id ?? null;

  const baseDenied = evaluateBasePolicy({ link, grant });
  const grantDenied = !baseDenied ? evaluateGrantPolicy({ link, grant }) : null;
  const queryDenied = typeof query.denied === 'string' ? query.denied : null;
  const knownReasons = new Set<DeniedReason>([
    'expired',
    'inactive',
    'deleted',
    'max_views_reached',
    'domain_not_allowed',
    'wrong_password',
    'email_required',
    'password_required',
    'agreement_required',
    'file_missing',
    'access_not_granted',
    'too_many_attempts',
    'unknown'
  ]);

  const deniedReasonFromQuery =
    queryDenied && knownReasons.has(queryDenied as DeniedReason)
      ? (queryDenied as DeniedReason)
      : null;

  const requiresEmail = link.require_email || link.allowed_domains.length > 0;
  const requiresPassword = Boolean(link.password_hash);
  const requiresAgreement = link.require_agreement;
  const needsForm = Boolean(grantDenied && (requiresEmail || requiresPassword || requiresAgreement));

  if (baseDenied) {
    const headersList = await headers();
    // Session cookie is guaranteed by middleware on every /v/* request — read only.
    const sessionId = normalizeViewerSessionId(cookieStore.get(VIEWER_SESSION_COOKIE)?.value);

    const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const userAgent = headersList.get('user-agent');

    if (eventFileId) {
      try {
        await recordLinkEvent({
          linkId: link.id,
          fileId: eventFileId,
          ownerId: link.owner_id,
          eventType: 'denied',
          reason: baseDenied,
          sessionId,
          viewerEmail: grant?.email,
          ipHash: hashIp(ip),
          userAgent
        });
      } catch {
        // Do not fail page render when analytics ingest is unavailable.
      }
    }

    return (
      <main className="viewer-layout">
        <Card className="viewer-card" variant="padded">
          <h1>접근할 수 없습니다.</h1>
          <p>{deniedMessage(baseDenied)}</p>
        </Card>
      </main>
    );
  }

  if (needsForm) {
    return (
      <main className="viewer-layout">
        <Card className="viewer-card" variant="padded">
          <h1>{link.label}</h1>
          <p>문서를 열람하려면 접근 조건을 입력해주세요.</p>
          {deniedReasonFromQuery ? (
            <Alert variant="danger">
              <AlertDescription>{deniedMessage(deniedReasonFromQuery)}</AlertDescription>
            </Alert>
          ) : null}
          <form action={submitViewerAccessAction.bind(null, token)} className="form-grid">
            {requiresEmail ? (
              <Input type="email" name="email" required label="이메일" placeholder="name@company.com" />
            ) : null}

            {requiresPassword ? (
              <Input type="password" name="password" required label="비밀번호" />
            ) : null}

            {requiresAgreement ? (
              <>
                <div className="nda-text">
                  {link.agreement_text?.trim() ||
                    '본 문서를 열람함으로써 본인은 문서에 포함된 정보를 기밀로 유지하며, 사전 서면 동의 없이 제3자에게 공개하지 않을 것에 동의합니다.'}
                </div>
                <Input name="agreementName" required label="이름(서명)" placeholder="실명을 입력하세요" />
                <Checkbox name="agree" value="on" required label="위 내용을 읽었으며 이에 동의합니다." />
              </>
            ) : null}

            <Button type="submit">접근 조건 제출</Button>
          </form>
        </Card>
      </main>
    );
  }

  const availableFiles = link.file ? [link.file] : link.collection_files;
  const activeFile =
    (selectedFileId ? availableFiles.find((item) => item.id === selectedFileId) : null) ?? availableFiles[0] ?? null;

  if (!activeFile) {
    return (
      <main className="viewer-layout">
        <Card className="viewer-card" variant="padded">
          <h1>문서에 접근할 수 없습니다.</h1>
          <p>이 링크에 연결된 문서를 찾을 수 없습니다.</p>
        </Card>
      </main>
    );
  }

  const docSrc = link.collection_id
    ? `/api/v/${token}/document?fileId=${encodeURIComponent(activeFile.id)}`
    : `/api/v/${token}/document`;
  const downloadSrc = link.collection_id
    ? `/api/v/${token}/download?fileId=${encodeURIComponent(activeFile.id)}`
    : `/api/v/${token}/download`;
  const eventEndpoint = `/api/v/${token}/event`;
  // White-label: when the owner has branding, the watermark falls back to their
  // company name instead of "DocFlow Viewer". Degrades to null pre-migration.
  const branding = await getOwnerBranding(link.owner_id);
  const watermarkLabel = grant?.email || branding?.company_name || 'DocFlow Viewer';

  // #1: count this open. Bumped once per granted viewer-page render — NOT
  // per PDF.js byte-range request (those hit the /document route, not this
  // page) — so open_count tracks real opens (incl. repeat opens by the same
  // session) and stays distinct from the session-deduped unique count.
  // Best-effort + non-blocking; bumpOpenCount swallows its own errors.
  await bumpOpenCount(link.id);

  return (
    <main className="viewer-app" style={brandAccentStyle(branding?.brand_color)}>
      <header className="viewer-topbar">
        <div className="viewer-brand">
          <BrandMark branding={branding} tone="onDark" />
          <span className="viewer-title">
            {link.label}
            {link.collection_id ? ` · ${activeFile.original_name}` : ''}
          </span>
        </div>
        <div className="viewer-actions">
          {link.allow_download ? (
            <Button asChild size="sm">
              <a href={downloadSrc}>다운로드</a>
            </Button>
          ) : (
            <Badge variant="warning" tone="subtle">다운로드 차단</Badge>
          )}
        </div>
      </header>
      <section className={`viewer-main${link.collection_id ? ' with-list' : ''}`}>
        {link.collection_id ? (
          <aside className="viewer-file-list">
            <SpaceViewerNav
              token={token}
              folders={link.folders}
              files={link.collection_files}
              activeFileId={activeFile.id}
            />
          </aside>
        ) : null}
        <PdfViewer
          documentSrc={docSrc}
          eventEndpoint={eventEndpoint}
          fileId={link.collection_id ? activeFile.id : undefined}
          watermarkLabel={watermarkLabel}
          watermark={link.watermark}
        />
      </section>
    </main>
  );
}
