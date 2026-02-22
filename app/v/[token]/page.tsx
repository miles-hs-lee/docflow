import { cookies, headers } from 'next/headers';

import { submitViewerAccessAction } from '@/lib/actions/viewer';
import { getViewerLinkByToken, recordLinkEvent } from '@/lib/data';
import { deniedMessage, evaluateBasePolicy, evaluateGrantPolicy } from '@/lib/policy';
import { createViewerSessionId, hashIp } from '@/lib/security';
import type { DeniedReason } from '@/lib/types';
import { decodeGrantCookie, getGrantCookieName, VIEWER_SESSION_COOKIE } from '@/lib/viewer-cookie';

type ViewerPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ViewerPage({ params, searchParams }: ViewerPageProps) {
  const { token } = await params;
  const query = await searchParams;

  const link = await getViewerLinkByToken(token);

  if (!link || !link.file) {
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
    let sessionId = cookieStore.get(VIEWER_SESSION_COOKIE)?.value;
    if (!sessionId) {
      sessionId = createViewerSessionId();
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

    await recordLinkEvent({
      linkId: link.id,
      fileId: link.file.id,
      ownerId: link.owner_id,
      eventType: 'denied',
      reason: baseDenied,
      sessionId,
      viewerEmail: grant?.email,
      ipHash: hashIp(ip),
      userAgent
    });

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

  return (
    <main className="viewer-layout">
      <section className="viewer-card viewer-card-wide">
        <div className="between">
          <div>
            <h1>{link.label}</h1>
            <p className="muted">보안 링크를 통해 문서가 로드됩니다.</p>
          </div>
          {link.allow_download ? (
            <a className="button button-primary" href={`/api/v/${token}/download`}>
              다운로드
            </a>
          ) : (
            <span className="badge badge-inactive">다운로드 차단</span>
          )}
        </div>

        <iframe
          className="pdf-frame"
          title="shared-pdf"
          src={`/api/v/${token}/document`}
          sandbox="allow-scripts allow-same-origin"
        />
      </section>
    </main>
  );
}
