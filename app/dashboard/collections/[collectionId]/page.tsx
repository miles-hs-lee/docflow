import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  CopyButton,
  EmptyState,
  FileIcon,
  Input,
  PageHeader,
  Stack,
  Stat,
  StatGroup
} from '@polaris/ui';
import { ChevronLeftIcon } from '@polaris/ui/icons';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExpiryDateField } from '@/components/expiry-date-field';
import { HiddenInput } from '@/components/hidden-input';
import { LinkPolicySummary } from '@/components/link-policy-summary';
import {
  createCollectionShareLinkAction,
  softDeleteLinkAction,
  updateShareLinkAction
} from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { getCollection, listFilesForCollection, listLinksForCollection } from '@/lib/data';
import { publicEnv } from '@/lib/env-public';
import { formatDateOnly } from '@/lib/format';
import { linkStatus, statusVariant } from '@/lib/link-status';

type CollectionLinksPageProps = {
  params: Promise<{ collectionId: string }>;
};

export default async function CollectionLinksPage({ params }: CollectionLinksPageProps) {
  const { collectionId } = await params;

  const { supabase } = await requireOwner();
  const [collection, files, links] = await Promise.all([
    getCollection(supabase, collectionId),
    listFilesForCollection(supabase, collectionId),
    listLinksForCollection(supabase, collectionId)
  ]);

  if (!collection) {
    notFound();
  }

  // Configured app URL, not the request host (avoids X-Forwarded-Host
  // spoofing → phishing share URLs, and proxy/preview host leakage).
  const appOrigin = publicEnv.appUrl;
  const redirectPath = `/dashboard/collections/${collection.id}`;

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          eyebrow={
            <Stack direction="row" align="center" gap={2}>
              <FileIcon type="folder" size={20} />
              <span className="muted small">문서 묶음 · {files.length}개 포함</span>
            </Stack>
          }
          title={collection.name}
          description={collection.description ?? undefined}
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard">
                <ChevronLeftIcon size={14} aria-hidden />
                대시보드
              </Link>
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>포함 문서</CardTitle>
          </CardHeader>
          <CardBody>
            {files.length === 0 ? (
              <EmptyState
                title="묶음에 포함된 문서가 없습니다"
                description="문서 묶음을 다시 구성해주세요."
              />
            ) : (
              <div className="collection-file-list">
                {files.map((file) => (
                  <span key={file.id} className="collection-file-chip">
                    <FileIcon type="pdf" size={20} />
                    {file.original_name}
                  </span>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>문서 묶음 링크 생성</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">묶음 링크 하나로 여러 PDF를 보여주고, 링크 정책은 동일하게 적용합니다.</p>
            <form action={createCollectionShareLinkAction} className="form-grid link-create-grid">
              <HiddenInput name="collectionId" value={collection.id} />
              <Input name="label" required label="링크 이름" placeholder="영업 제안 패키지" />
              <ExpiryDateField name="expiresAt" />
              <Input type="number" name="maxViews" min={1} label="최대 조회수" placeholder="미설정" />
              <Input name="allowedDomains" label="허용 도메인" placeholder="company.com,partner.org" />
              <Input name="password" type="password" label="비밀번호" placeholder="필요한 경우만 입력" />
              <div className="check-grid">
                <Checkbox name="isActive" defaultChecked label="활성" containerClassName="check-item" />
                <Checkbox name="requireEmail" label="이메일 요구" containerClassName="check-item" />
                <Checkbox name="allowDownload" label="다운로드 허용" containerClassName="check-item" />
                <Checkbox name="oneTime" label="1회성 링크" containerClassName="check-item" />
                <Checkbox name="watermark" defaultChecked label="워터마크" containerClassName="check-item" />
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
                description="묶음 링크를 만들면 문서 목록, 정책, 통계가 함께 관리됩니다."
              />
            ) : (
              <Stack gap={3}>
                {links.map((link) => {
                  const status = linkStatus(link);
                  const url = `${appOrigin}/v/${link.token}`;

                  return (
                    <Card className="link-card compact" variant="padded" key={link.id}>
                      <div className="link-card-head">
                        <div className="link-card-title">
                          <strong>{link.label}</strong>
                          <p className="mono">{url}</p>
                        </div>
                        <Stack direction="row" align="center" gap={2} wrap>
                          <Badge variant={statusVariant(status)} tone="subtle">
                            {status}
                          </Badge>
                          <CopyButton text={url} size="sm" variant="secondary" />
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/dashboard/links/${link.id}`}>통계</Link>
                          </Button>
                          <form action={softDeleteLinkAction}>
                            <HiddenInput name="linkId" value={link.id} />
                            <HiddenInput name="redirectTo" value={redirectPath} />
                            <Button type="submit" variant="danger" size="sm">
                              삭제
                            </Button>
                          </form>
                        </Stack>
                      </div>

                      <StatGroup cols={4} unwrapped>
                        <Stat label="조회수" value={link.view_count} />
                        <Stat label="다운로드" value={link.download_count} />
                        <Stat
                          label="거부"
                          value={link.denied_count}
                          {...(link.denied_count > 0
                            ? { delta: '주의', deltaVariant: 'negative' as const }
                            : {})}
                        />
                        <Stat label="생성일" value={formatDateOnly(link.created_at)} />
                      </StatGroup>

                      <details className="link-edit-toggle">
                        <summary>정책 수정</summary>
                        <form action={updateShareLinkAction} className="form-grid compact">
                          <HiddenInput name="linkId" value={link.id} />
                          <HiddenInput name="redirectTo" value={redirectPath} />
                          <Input name="label" defaultValue={link.label} required label="이름" />
                          <ExpiryDateField name="expiresAt" defaultValue={link.expires_at} />
                          <Input type="number" min={1} name="maxViews" defaultValue={link.max_views ?? undefined} label="최대 조회수" />
                          <Input name="allowedDomains" defaultValue={link.allowed_domains.join(',')} label="허용 도메인" />
                          <Input type="password" name="newPassword" label="새 비밀번호" placeholder="변경 시 입력" />
                          <div className="check-grid">
                            <Checkbox name="isActive" defaultChecked={link.is_active} label="활성" containerClassName="check-item" />
                            <Checkbox name="requireEmail" defaultChecked={link.require_email} label="이메일 요구" containerClassName="check-item" />
                            <Checkbox name="allowDownload" defaultChecked={link.allow_download} label="다운로드 허용" containerClassName="check-item" />
                            <Checkbox name="oneTime" defaultChecked={link.one_time} label="1회성" containerClassName="check-item" />
                            <Checkbox name="watermark" defaultChecked={link.watermark} label="워터마크" containerClassName="check-item" />
                            <Checkbox name="clearPassword" label="비밀번호 제거" containerClassName="check-item" />
                          </div>
                          <Button type="submit">수정 저장</Button>
                        </form>
                      </details>

                      <LinkPolicySummary link={link} />
                    </Card>
                  );
                })}
              </Stack>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
