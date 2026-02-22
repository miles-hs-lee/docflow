import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { CopyButton } from '@/components/copy-button';
import { Flash } from '@/components/flash';
import {
  createShareLinkAction,
  softDeleteLinkAction,
  updateShareLinkAction
} from '@/lib/actions/owner';
import { publicEnv } from '@/lib/env-public';
import { requireOwner } from '@/lib/auth';
import { getFile, getMetricsForFile, listLinksForFile } from '@/lib/data';
import { formatDateOnly, formatDateTime } from '@/lib/format';

type FileLinksPageProps = {
  params: Promise<{ fileId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toDateTimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function linkStatus(link: {
  is_active: boolean;
  deleted_at: string | null;
  expires_at: string | null;
}) {
  if (link.deleted_at) return 'deleted';
  if (!link.is_active) return 'inactive';
  if (link.expires_at && new Date(link.expires_at) < new Date()) return 'expired';
  return 'active';
}

export default async function FileLinksPage({ params, searchParams }: FileLinksPageProps) {
  const { fileId } = await params;
  const query = await searchParams;
  const headerStore = await headers();

  const { supabase } = await requireOwner();
  const [file, links, metricsMap] = await Promise.all([
    getFile(supabase, fileId),
    listLinksForFile(supabase, fileId),
    getMetricsForFile(supabase, fileId)
  ]);

  if (!file) {
    notFound();
  }

  const success = typeof query.success === 'string' ? decodeURIComponent(query.success) : undefined;
  const error = typeof query.error === 'string' ? decodeURIComponent(query.error) : undefined;
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  const protocol = headerStore.get('x-forwarded-proto') ?? 'https';
  const appOrigin = host ? `${protocol}://${host}` : publicEnv.appUrl;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <article className="panel">
        <div className="between">
          <div>
            <h2>{file.original_name}</h2>
            <p className="muted">업로드일: {formatDateTime(file.created_at)}</p>
          </div>
          <Link href="/dashboard" className="button button-ghost">
            파일 목록으로
          </Link>
        </div>
      </article>

      <article className="panel">
        <h2>공유 링크 생성</h2>
        <form action={createShareLinkAction} className="form-grid">
          <input type="hidden" name="fileId" value={file.id} />
          <label>
            링크 이름
            <input name="label" required placeholder="거래처 A용" />
          </label>
          <label>
            만료일
            <input type="datetime-local" name="expiresAt" />
          </label>
          <label>
            최대 조회수
            <input type="number" name="maxViews" min={1} placeholder="미설정" />
          </label>
          <label>
            허용 도메인(콤마 구분)
            <input name="allowedDomains" placeholder="company.com,partner.org" />
          </label>
          <label>
            비밀번호
            <input name="password" type="password" placeholder="필요한 경우만 입력" />
          </label>
          <div className="check-grid">
            <label className="check-item">
              <input type="checkbox" name="isActive" defaultChecked /> 활성
            </label>
            <label className="check-item">
              <input type="checkbox" name="requireEmail" /> 이메일 요구
            </label>
            <label className="check-item">
              <input type="checkbox" name="allowDownload" /> 다운로드 허용
            </label>
            <label className="check-item">
              <input type="checkbox" name="oneTime" /> 1회성 링크
            </label>
          </div>
          <button type="submit" className="button button-primary">
            링크 생성
          </button>
        </form>
      </article>

      <article className="panel">
        <h2>링크 목록</h2>
        {links.length === 0 ? (
          <p className="muted">생성된 링크가 없습니다.</p>
        ) : (
          <div className="stack-md">
            {links.map((link) => {
              const metrics = metricsMap.get(link.id);
              const status = linkStatus(link);
              const url = `${appOrigin}/v/${link.token}`;

              return (
                <details className="link-card" key={link.id}>
                  <summary>
                    <div>
                      <strong>{link.label}</strong>
                      <p className="mono">{url}</p>
                    </div>
                    <div className="summary-meta">
                      <span className={`badge badge-${status}`}>{status}</span>
                      <CopyButton value={url} />
                    </div>
                  </summary>

                  <div className="link-card-content">
                    <div className="metric-grid">
                      <div>
                        <p className="metric-label">조회수</p>
                        <p className="metric-value">{metrics?.views ?? link.view_count}</p>
                      </div>
                      <div>
                        <p className="metric-label">유니크</p>
                        <p className="metric-value">{metrics?.unique_viewers ?? 0}</p>
                      </div>
                      <div>
                        <p className="metric-label">다운로드</p>
                        <p className="metric-value">{metrics?.downloads ?? link.download_count}</p>
                      </div>
                      <div>
                        <p className="metric-label">거부</p>
                        <p className="metric-value">{metrics?.denied ?? link.denied_count}</p>
                      </div>
                    </div>

                    <p className="muted small">
                      생성일 {formatDateOnly(link.created_at)} | 만료일 {formatDateTime(link.expires_at)} | 다운로드{' '}
                      {link.allow_download ? '허용' : '차단'}
                    </p>

                    <form action={updateShareLinkAction} className="form-grid compact">
                      <input type="hidden" name="linkId" value={link.id} />
                      <input type="hidden" name="fileId" value={file.id} />
                      <label>
                        이름
                        <input name="label" defaultValue={link.label} required />
                      </label>
                      <label>
                        만료일
                        <input type="datetime-local" name="expiresAt" defaultValue={toDateTimeLocal(link.expires_at)} />
                      </label>
                      <label>
                        최대 조회수
                        <input type="number" min={1} name="maxViews" defaultValue={link.max_views ?? undefined} />
                      </label>
                      <label>
                        허용 도메인
                        <input name="allowedDomains" defaultValue={link.allowed_domains.join(',')} />
                      </label>
                      <label>
                        새 비밀번호
                        <input type="password" name="newPassword" placeholder="변경 시 입력" />
                      </label>
                      <div className="check-grid">
                        <label className="check-item">
                          <input type="checkbox" name="isActive" defaultChecked={link.is_active} /> 활성
                        </label>
                        <label className="check-item">
                          <input type="checkbox" name="requireEmail" defaultChecked={link.require_email} /> 이메일 요구
                        </label>
                        <label className="check-item">
                          <input type="checkbox" name="allowDownload" defaultChecked={link.allow_download} /> 다운로드 허용
                        </label>
                        <label className="check-item">
                          <input type="checkbox" name="oneTime" defaultChecked={link.one_time} /> 1회성
                        </label>
                        <label className="check-item">
                          <input type="checkbox" name="clearPassword" /> 비밀번호 제거
                        </label>
                      </div>
                      <div className="row-actions">
                        <button type="submit" className="button button-primary">
                          정책 저장
                        </button>
                        <Link href={`/dashboard/links/${link.id}`} className="button button-ghost">
                          통계 상세
                        </Link>
                      </div>
                    </form>

                    <form action={softDeleteLinkAction}>
                      <input type="hidden" name="linkId" value={link.id} />
                      <input type="hidden" name="fileId" value={file.id} />
                      <button type="submit" className="button button-danger">
                        링크 삭제(휴지통 이동)
                      </button>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
