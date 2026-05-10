import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  FileIcon,
  HStack,
  Input,
  Stack,
  VStack
} from '@polaris/ui';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { CopyButton } from '@/components/copy-button';
import { DateTimeInput } from '@/components/datetime-input';
import { HiddenInput } from '@/components/hidden-input';
import { LinkPolicySummary } from '@/components/link-policy-summary';
import {
  createShareLinkAction,
  softDeleteLinkAction,
  updateShareLinkAction
} from '@/lib/actions/owner';
import { publicEnv } from '@/lib/env-public';
import { requireOwner } from '@/lib/auth';
import { getFile, getMetricsForFile, listLinksForFile, listPerPageStats } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

type FileLinksPageProps = {
  params: Promise<{ fileId: string }>;
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

export default async function FileLinksPage({ params }: FileLinksPageProps) {
  const { fileId } = await params;
  const headerStore = await headers();

  const { supabase, user } = await requireOwner();
  const [file, links, metricsMap, pageStats] = await Promise.all([
    getFile(supabase, fileId),
    listLinksForFile(supabase, fileId),
    getMetricsForFile(supabase, fileId),
    listPerPageStats({ ownerId: user.id, fileId })
  ]);

  if (!file) {
    notFound();
  }

  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  const protocol = headerStore.get('x-forwarded-proto') ?? 'https';
  const appOrigin = host ? `${protocol}://${host}` : publicEnv.appUrl;

  return (
    <Stack asChild gap={5}>
      <section>
        <Card>
          <CardBody>
            <HStack justify="between" align="start" gap={4}>
              <VStack gap={3}>
                <HStack align="center" gap={2}>
                  <FileIcon type="pdf" size={34} />
                  <h2>{file.original_name}</h2>
                </HStack>
                <p className="muted">업로드일: {formatDateTime(file.created_at)}</p>
              </VStack>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard">파일 목록으로</Link>
              </Button>
            </HStack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>페이지별 열람 통계</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">상대가 어느 페이지에서 가장 오래 머물렀는지를 누적 dwell 시간으로 보여줍니다. 0.8초 미만 짧은 노출은 제외됩니다.</p>
            {pageStats.length === 0 ? (
              <EmptyState
                title="아직 페이지 단위 신호가 없습니다"
                description="공유 링크를 통해 PDF를 열람하면 페이지별 누적 시간이 여기 표시됩니다."
              />
            ) : (
              <div className="page-heatmap">
                {(() => {
                  const max = Math.max(...pageStats.map((p) => p.total_dwell_ms), 1);
                  return pageStats.map((p) => {
                    const seconds = Math.round(p.total_dwell_ms / 1000);
                    const widthPct = Math.max(2, Math.round((p.total_dwell_ms / max) * 100));
                    return (
                      <div key={p.page_number} className="page-heatmap-row">
                        <span className="page-heatmap-page">p.{p.page_number}</span>
                        <div className="page-heatmap-bar">
                          <div className="page-heatmap-bar-fill" style={{ width: `${widthPct}%` }} />
                        </div>
                        <span className="page-heatmap-dwell">
                          {seconds}s · {p.views}회
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>공유 링크 생성</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">링크마다 다른 만료일, 이메일 조건, 비밀번호, 다운로드 정책을 적용할 수 있습니다.</p>
            <form action={createShareLinkAction} className="form-grid link-create-grid">
              <HiddenInput name="fileId" value={file.id} />
              <Input name="label" required label="링크 이름" placeholder="거래처 A용" />
              <DateTimeInput name="expiresAt" label="만료일" />
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
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>링크 목록</CardTitle>
          </CardHeader>
          <CardBody>
            {links.length === 0 ? (
              <EmptyState
                title="생성된 링크가 없습니다"
                description="첫 공유 링크를 만들면 URL과 정책, 통계가 이곳에 표시됩니다."
              />
            ) : (
              <VStack gap={3}>
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
                        <HStack align="center" gap={2} wrap>
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
                        </HStack>
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

                      <LinkPolicySummary link={link} />

                      <details className="link-edit-toggle">
                        <summary>정책 수정</summary>
                        <form action={updateShareLinkAction} className="form-grid compact">
                          <HiddenInput name="linkId" value={link.id} />
                          <HiddenInput name="fileId" value={file.id} />
                          <Input name="label" defaultValue={link.label} required label="이름" />
                          <DateTimeInput name="expiresAt" defaultValue={toDateTimeLocal(link.expires_at)} label="만료일" />
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
              </VStack>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
