import { Badge, Button, Card, Checkbox, EmptyState, FileIcon, Input } from '@polaris/ui';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { CopyButton } from '@/components/copy-button';
import { HiddenInput } from '@/components/hidden-input';
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

function statusVariant(status: ReturnType<typeof linkStatus>) {
  if (status === 'active') return 'success' as const;
  if (status === 'deleted') return 'danger' as const;
  return 'warning' as const;
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

      <Card className="panel" variant="padded">
        <div className="between">
          <div className="stack-sm">
            <div className="row-actions">
              <FileIcon type="pdf" size={34} />
              <h2>{file.original_name}</h2>
            </div>
            <p className="muted">업로드일: {formatDateTime(file.created_at)}</p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard">파일 목록으로</Link>
          </Button>
        </div>
      </Card>

      <Card className="panel" variant="padded">
        <h2>공유 링크 생성</h2>
        <p className="muted">링크마다 다른 만료일, 이메일 조건, 비밀번호, 다운로드 정책을 적용할 수 있습니다.</p>
        <form action={createShareLinkAction} className="form-grid link-create-grid">
          <HiddenInput name="fileId" value={file.id} />
          <Input name="label" required label="링크 이름" placeholder="거래처 A용" />
          <Input type="datetime-local" name="expiresAt" label="만료일" />
          <Input type="number" name="maxViews" min={1} label="최대 조회수" placeholder="미설정" />
          <Input name="allowedDomains" label="허용 도메인" placeholder="company.com,partner.org" />
          <Input name="password" type="password" label="비밀번호" placeholder="필요한 경우만 입력" />
          <div className="check-grid">
            <Checkbox name="isActive" defaultChecked label="활성" containerClassName="check-item" />
            <Checkbox name="requireEmail" label="이메일 요구" containerClassName="check-item" />
            <Checkbox name="allowDownload" label="다운로드 허용" containerClassName="check-item" />
            <Checkbox name="oneTime" label="1회성 링크" containerClassName="check-item" />
          </div>
          <Button type="submit">링크 생성</Button>
        </form>
      </Card>

      <Card className="panel" variant="padded">
        <h2>링크 목록</h2>
        {links.length === 0 ? (
          <EmptyState title="생성된 링크가 없습니다" description="첫 공유 링크를 만들면 URL과 정책, 통계가 이곳에 표시됩니다." />
        ) : (
          <div className="stack-sm">
            {links.map((link) => {
              const metrics = metricsMap.get(link.id);
              const status = linkStatus(link);
              const url = `${appOrigin}/v/${link.token}`;

              return (
                <Card className="link-card compact" variant="padded" key={link.id}>
                  <div className="link-card-head">
                    <div className="link-card-title">
                      <strong>{link.label}</strong>
                      <p className="mono">{url}</p>
                    </div>
                    <div className="summary-meta link-inline-actions">
                      <Badge variant={statusVariant(status)} tone="subtle">
                        {status}
                      </Badge>
                      <CopyButton value={url} />
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/dashboard/links/${link.id}`}>통계</Link>
                      </Button>
                      <form action={softDeleteLinkAction}>
                        <HiddenInput name="linkId" value={link.id} />
                        <HiddenInput name="fileId" value={file.id} />
                        <Button type="submit" variant="danger" size="sm">
                          삭제
                        </Button>
                      </form>
                    </div>
                  </div>

                  <div className="metric-grid compact">
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

                  <details className="link-edit-toggle">
                    <summary>정책 수정</summary>
                    <form action={updateShareLinkAction} className="form-grid compact">
                      <HiddenInput name="linkId" value={link.id} />
                      <HiddenInput name="fileId" value={file.id} />
                      <Input name="label" defaultValue={link.label} required label="이름" />
                      <Input type="datetime-local" name="expiresAt" defaultValue={toDateTimeLocal(link.expires_at)} label="만료일" />
                      <Input type="number" min={1} name="maxViews" defaultValue={link.max_views ?? undefined} label="최대 조회수" />
                      <Input name="allowedDomains" defaultValue={link.allowed_domains.join(',')} label="허용 도메인" />
                      <Input type="password" name="newPassword" label="새 비밀번호" placeholder="변경 시 입력" />
                      <div className="check-grid">
                        <Checkbox name="isActive" defaultChecked={link.is_active} label="활성" containerClassName="check-item" />
                        <Checkbox name="requireEmail" defaultChecked={link.require_email} label="이메일 요구" containerClassName="check-item" />
                        <Checkbox name="allowDownload" defaultChecked={link.allow_download} label="다운로드 허용" containerClassName="check-item" />
                        <Checkbox name="oneTime" defaultChecked={link.one_time} label="1회성" containerClassName="check-item" />
                        <Checkbox name="clearPassword" label="비밀번호 제거" containerClassName="check-item" />
                      </div>
                      <Button type="submit">수정 저장</Button>
                    </form>
                  </details>
                </Card>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );
}
