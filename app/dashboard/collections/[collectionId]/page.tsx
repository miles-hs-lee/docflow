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
  HStack,
  Input,
  Stack,
  Stat,
  VStack
} from '@polaris/ui';
import Link from 'next/link';
import { headers } from 'next/headers';
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

type CollectionLinksPageProps = {
  params: Promise<{ collectionId: string }>;
};

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

export default async function CollectionLinksPage({ params }: CollectionLinksPageProps) {
  const { collectionId } = await params;
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

  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');
  const protocol = headerStore.get('x-forwarded-proto') ?? 'https';
  const appOrigin = host ? `${protocol}://${host}` : publicEnv.appUrl;
  const redirectPath = `/dashboard/collections/${collection.id}`;

  return (
    <Stack asChild gap={5}>
      <section>
        <Card>
          <CardBody>
            <HStack justify="between" align="start" gap={4}>
              <VStack gap={3}>
                <HStack align="center" gap={2}>
                  <FileIcon type="folder" size={34} />
                  <h2>{collection.name}</h2>
                </HStack>
                <p className="muted">
                  포함 문서 {files.length}개 {collection.description ? `| ${collection.description}` : ''}
                </p>
              </VStack>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard">대시보드로</Link>
              </Button>
            </HStack>
          </CardBody>
        </Card>

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
              <VStack gap={3}>
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
                        <HStack align="center" gap={2} wrap>
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
                        </HStack>
                      </div>

                      <HStack gap={4} wrap>
                        <Stat label="조회수" value={link.view_count} />
                        <Stat label="다운로드" value={link.download_count} />
                        <Stat
                          label="거부"
                          value={link.denied_count}
                          deltaTone={link.denied_count > 0 ? 'negative' : 'neutral'}
                        />
                        <Stat label="생성일" value={formatDateOnly(link.created_at)} />
                      </HStack>

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
                            <Checkbox name="clearPassword" label="비밀번호 제거" containerClassName="check-item" />
                          </div>
                          <Button type="submit">수정 저장</Button>
                        </form>
                      </details>

                      <LinkPolicySummary link={link} />
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
