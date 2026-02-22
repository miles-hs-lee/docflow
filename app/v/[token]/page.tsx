import { cookies, headers } from 'next/headers';

import { submitViewerAccessAction } from '@/lib/actions/viewer';
import { getViewerLinkByToken, recordLinkEvent } from '@/lib/data';
import { deniedMessage, evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { hashIp, normalizeViewerSessionId } from '@/lib/security';
import type { DeniedReason } from '@/lib/types';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type ViewerPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ViewerPage({ params, searchParams }: ViewerPageProps) {
  const { token } = await params;
  const query = await searchParams;
  const selectedFileId = typeof query.fileId === 'string' ? query.fileId : null;

  const link = await getViewerLinkByToken(token);

  if (!link) {
    return (
      <main className="viewer-layout">
        <section className="viewer-card">
          <h1>문서에 접근할 수 없습니다.</h1>
          <p>요청한 링크가 존재하지 않거나 사용할 수 없습니다.</p>
        </section>
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
    'file_missing',
    'access_not_granted',
    'unknown'
  ]);

  const deniedReasonFromQuery =
    queryDenied && knownReasons.has(queryDenied as DeniedReason)
      ? (queryDenied as DeniedReason)
      : null;

  const requiresEmail = link.require_email || link.allowed_domains.length > 0;
  const requiresPassword = Boolean(link.password_hash);
  const needsForm = Boolean(grantDenied && (requiresEmail || requiresPassword));

  if (baseDenied) {
    const headersList = await headers();
    const rawSessionId = cookieStore.get(VIEWER_SESSION_COOKIE)?.value;
    const sessionId = normalizeViewerSessionId(rawSessionId);
    if (!rawSessionId || rawSessionId !== sessionId) {
      cookieStore.set(VIEWER_SESSION_COOKIE, sessionId, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 30
      });
    }

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
        <section className="viewer-card">
          <h1>접근할 수 없습니다.</h1>
          <p>{deniedMessage(baseDenied)}</p>
        </section>
      </main>
    );
  }

  if (needsForm) {
    return (
      <main className="viewer-layout">
        <section className="viewer-card">
          <h1>{link.label}</h1>
          <p>문서를 열람하려면 접근 조건을 입력해주세요.</p>
          {deniedReasonFromQuery ? (
            <p className="flash flash-error">{deniedMessage(deniedReasonFromQuery)}</p>
          ) : null}
          <form action={submitViewerAccessAction.bind(null, token)} className="form-grid">
            {requiresEmail ? (
              <label>
                이메일
                <input type="email" name="email" required placeholder="name@company.com" />
              </label>
            ) : null}

            {requiresPassword ? (
              <label>
                비밀번호
                <input type="password" name="password" required />
              </label>
            ) : null}

            <button type="submit" className="button button-primary">
              접근 조건 제출
            </button>
          </form>
        </section>
      </main>
    );
  }

  const availableFiles = link.file ? [link.file] : link.collection_files;
  const activeFile =
    (selectedFileId ? availableFiles.find((item) => item.id === selectedFileId) : null) ?? availableFiles[0] ?? null;

  if (!activeFile) {
    return (
      <main className="viewer-layout">
        <section className="viewer-card">
          <h1>문서에 접근할 수 없습니다.</h1>
          <p>이 링크에 연결된 문서를 찾을 수 없습니다.</p>
        </section>
      </main>
    );
  }

  const docSrc = link.collection_id
    ? `/api/v/${token}/document?fileId=${encodeURIComponent(activeFile.id)}`
    : `/api/v/${token}/document`;
  const downloadSrc = link.collection_id
    ? `/api/v/${token}/download?fileId=${encodeURIComponent(activeFile.id)}`
    : `/api/v/${token}/download`;

  return (
    <main className="viewer-app">
      <header className="viewer-topbar">
        <div className="viewer-brand">
          <strong>DocFlow</strong>
          <span className="viewer-title">
            {link.label}
            {link.collection_id ? ` · ${activeFile.original_name}` : ''}
          </span>
        </div>
        <div className="viewer-actions">
          {link.allow_download ? (
            <a className="button button-primary" href={downloadSrc}>
              다운로드
            </a>
          ) : (
            <span className="badge badge-inactive">다운로드 차단</span>
          )}
        </div>
      </header>
      <section className={`viewer-main${link.collection_id ? ' with-list' : ''}`}>
        {link.collection_id ? (
          <aside className="viewer-file-list">
            {availableFiles.map((file) => {
              const href = `/v/${token}?fileId=${encodeURIComponent(file.id)}`;
              const isActive = file.id === activeFile.id;
              return (
                <a key={file.id} href={href} className={`viewer-file-link${isActive ? ' active' : ''}`}>
                  {file.original_name}
                </a>
              );
            })}
          </aside>
        ) : null}
        <iframe className="pdf-frame" title="shared-pdf" src={docSrc} />
      </section>
    </main>
  );
}
