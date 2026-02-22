import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { CopyButton } from '@/components/copy-button';
import { Flash } from '@/components/flash';
import {
  createCollectionShareLinkAction,
  softDeleteLinkAction,
  updateShareLinkAction
} from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { getCollection, listFilesForCollection, listLinksForCollection } from '@/lib/data';
import { publicEnv } from '@/lib/env-public';
import { formatDateOnly, formatDateTime } from '@/lib/format';

type CollectionLinksPageProps = {
  params: Promise<{ collectionId: string }>;
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

export default async function CollectionLinksPage({ params, searchParams }: CollectionLinksPageProps) {
  const { collectionId } = await params;
  const query = await searchParams;
  const headerStore = await headers();

  const { supabase } = await requireOwner();
  const [collection, files, links] = await Promise.all([
    getCollection(supabase, collectionId),
    listFilesForCollection(supabase, collectionId),
    listLinksForCollection(supabase, collectionId)
  ]);

  if (!collection) {
    notFound();
  }

  const success = typeof query.success === 'string' ? decodeURIComponent(query.success) : undefined;
  const error = typeof query.error === 'string' ? decodeURIComponent(query.error) : undefined;

  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  const protocol = headerStore.get('x-forwarded-proto') ?? 'https';
  const appOrigin = host ? `${protocol}://${host}` : publicEnv.appUrl;
  const redirectPath = `/dashboard/collections/${collection.id}`;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <article className="panel">
        <div className="between">
          <div>
            <h2>{collection.name}</h2>
            <p className="muted">
              포함 문서 {files.length}개 {collection.description ? `| ${collection.description}` : ''}
            </p>
          </div>
          <Link href="/dashboard" className="button button-ghost">
            대시보드로
          </Link>
        </div>
      </article>

      <article className="panel">
        <h2>포함 문서</h2>
        {files.length === 0 ? (
          <p className="muted">묶음에 포함된 문서가 없습니다.</p>
        ) : (
          <div className="collection-file-list">
            {files.map((file) => (
              <span key={file.id} className="collection-file-chip">
                {file.original_name}
              </span>
            ))}
          </div>
        )}
      </article>

      <article className="panel">
        <h2>문서 묶음 링크 생성</h2>
        <form action={createCollectionShareLinkAction} className="form-grid link-create-grid">
          <input type="hidden" name="collectionId" value={collection.id} />
          <label>
            링크 이름
            <input name="label" required placeholder="영업 제안 패키지" />
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
          <div className="stack-sm">
            {links.map((link) => {
              const status = linkStatus(link);
              const url = `${appOrigin}/v/${link.token}`;

              return (
                <article className="link-card compact" key={link.id}>
                  <div className="link-card-head">
                    <div className="link-card-title">
                      <strong>{link.label}</strong>
                      <p className="mono">{url}</p>
                    </div>
                    <div className="summary-meta link-inline-actions">
                      <span className={`badge badge-${status}`}>{status}</span>
                      <CopyButton value={url} />
                      <Link href={`/dashboard/links/${link.id}`} className="button button-ghost">
                        통계
                      </Link>
                      <form action={softDeleteLinkAction}>
                        <input type="hidden" name="linkId" value={link.id} />
                        <input type="hidden" name="redirectTo" value={redirectPath} />
                        <button type="submit" className="button button-danger">
                          삭제
                        </button>
                      </form>
                    </div>
                  </div>

                  <div className="metric-grid compact">
                    <div>
                      <p className="metric-label">조회수</p>
                      <p className="metric-value">{link.view_count}</p>
                    </div>
                    <div>
                      <p className="metric-label">다운로드</p>
                      <p className="metric-value">{link.download_count}</p>
                    </div>
                    <div>
                      <p className="metric-label">거부</p>
                      <p className="metric-value">{link.denied_count}</p>
                    </div>
                    <div>
                      <p className="metric-label">생성일</p>
                      <p className="metric-value">{formatDateOnly(link.created_at)}</p>
                    </div>
                  </div>

                  <details className="link-edit-toggle">
                    <summary>정책 수정</summary>
                    <form action={updateShareLinkAction} className="form-grid compact">
                      <input type="hidden" name="linkId" value={link.id} />
                      <input type="hidden" name="redirectTo" value={redirectPath} />
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
                      <button type="submit" className="button button-primary">
                        수정 저장
                      </button>
                    </form>
                  </details>

                  <p className="muted small">
                    만료일 {formatDateTime(link.expires_at)} | 다운로드 {link.allow_download ? '허용' : '차단'}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
