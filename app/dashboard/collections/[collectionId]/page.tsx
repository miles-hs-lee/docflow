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
  StatGroup,
  Textarea
} from '@polaris/ui';
import { ChevronLeftIcon } from '@polaris/ui/icons';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ExpiryDateField } from '@/components/expiry-date-field';
import { HiddenInput } from '@/components/hidden-input';
import { LinkPolicySummary } from '@/components/link-policy-summary';
import { LocalDate } from '@/components/local-date';
import { SpaceStructure } from '@/components/space-structure';
import {
  createCollectionShareLinkAction,
  softDeleteLinkAction,
  updateShareLinkAction
} from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import {
  getCollection,
  getCollectionUniqueViews,
  listCollectionLinkUniques,
  listLinksForCollection,
  listSpaceContents
} from '@/lib/data';
import { publicEnv } from '@/lib/env-public';
import { linkStatus, statusVariant } from '@/lib/link-status';

type CollectionLinksPageProps = {
  params: Promise<{ collectionId: string }>;
};

export default async function CollectionLinksPage({ params }: CollectionLinksPageProps) {
  const { collectionId } = await params;

  const { supabase } = await requireOwner();
  const [collection, space, links] = await Promise.all([
    getCollection(supabase, collectionId),
    listSpaceContents(supabase, collectionId),
    listLinksForCollection(supabase, collectionId)
  ]);
  const { folders, files } = space;

  if (!collection) {
    notFound();
  }

  // Per-link unique in ONE round trip (migration 021), plus a TRUE room-wide
  // distinct unique — replaces the old N+1 (one RPC per link) and the per-link
  // unique sum that double-counted cross-link visitors.
  const [linkUniques, roomUnique] = await Promise.all([
    listCollectionLinkUniques(collection.owner_id, collection.id),
    getCollectionUniqueViews(collection.owner_id, collection.id)
  ]);
  const metricsMap = new Map(
    links.map((link) => [
      link.id,
      {
        link_id: link.id,
        views: link.open_count ?? link.view_count,
        unique_viewers: linkUniques.get(link.id) ?? 0,
        downloads: link.download_count,
        denied: link.denied_count
      }
    ])
  );

  // Data-room rollup: counters summed from the link rows; unique is the true
  // distinct-session count across the room (not a per-link sum).
  const roomSummary = {
    opens: links.reduce((sum, link) => sum + (link.open_count ?? link.view_count ?? 0), 0),
    unique: roomUnique,
    downloads: links.reduce((sum, link) => sum + (link.download_count ?? 0), 0),
    denied: links.reduce((sum, link) => sum + (link.denied_count ?? 0), 0)
  };

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
              <span className="muted small">데이터룸 · 문서 {files.length} · 폴더 {folders.length}</span>
            </Stack>
          }
          title={collection.name}
          description={collection.description ?? undefined}
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/collections">
                <ChevronLeftIcon size={14} aria-hidden />
                데이터룸
              </Link>
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>데이터룸 요약</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">이 데이터룸의 모든 공유 링크를 합산한 지표입니다.</p>
            <StatGroup cols={4} unwrapped>
              <Stat label="조회수" value={roomSummary.opens} helper="총 열람" />
              <Stat label="유니크" value={roomSummary.unique} helper="세션 기준" />
              <Stat label="다운로드" value={roomSummary.downloads} />
              <Stat
                label="거부"
                value={roomSummary.denied}
                {...(roomSummary.denied > 0 ? { delta: '주의', deltaVariant: 'negative' as const } : {})}
              />
            </StatGroup>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>데이터룸 구성</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">폴더로 문서를 정리하세요. 폴더를 만들고 각 문서를 폴더로 옮길 수 있으며, 이 구조는 공유 링크 뷰어에 그대로 표시됩니다.</p>
            {files.length === 0 ? (
              <EmptyState
                title="데이터룸에 포함된 문서가 없습니다"
                description="데이터룸을 다시 구성해주세요."
              />
            ) : (
              <SpaceStructure collectionId={collection.id} folders={folders} files={files} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>데이터룸 링크 생성</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">데이터룸 링크 하나로 여러 PDF를 보여주고, 링크 정책은 동일하게 적용합니다.</p>
            <form action={createCollectionShareLinkAction} className="form-grid link-create-grid">
              <HiddenInput name="collectionId" value={collection.id} />
              <Input name="label" required label="링크 이름" placeholder="영업 제안 패키지" />
              <ExpiryDateField name="expiresAt" />
              <Input type="number" name="maxViews" min={1} label="최대 조회수" placeholder="미설정" />
              <Input name="allowedDomains" label="허용 도메인" placeholder="company.com,partner.org" />
              <Input name="password" type="password" label="비밀번호" placeholder="필요한 경우만 입력" />
              <Textarea name="agreementText" label="NDA/동의 문구 (선택)" placeholder="동의 요구 시 열람 전에 표시할 약관 문구" rows={3} />
              <div className="check-grid">
                <Checkbox name="isActive" defaultChecked label="활성" containerClassName="check-item" />
                <Checkbox name="requireEmail" label="이메일 요구" containerClassName="check-item" />
                <Checkbox name="allowDownload" label="다운로드 허용" containerClassName="check-item" />
                <Checkbox name="oneTime" label="1회성 링크" containerClassName="check-item" />
                <Checkbox name="watermark" defaultChecked label="워터마크" containerClassName="check-item" />
                <Checkbox name="requireAgreement" label="NDA 동의 요구" containerClassName="check-item" />
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
                description="데이터룸 링크를 만들면 문서 목록, 정책, 통계가 함께 관리됩니다."
              />
            ) : (
              <Stack gap={3}>
                {links.map((link) => {
                  const status = linkStatus(link);
                  const metrics = metricsMap.get(link.id);
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
                        <Stat label="조회수" value={metrics?.views ?? link.open_count} helper="총 열람" />
                        <Stat label="유니크" value={metrics?.unique_viewers ?? 0} helper="세션 기준" />
                        <Stat label="다운로드" value={metrics?.downloads ?? link.download_count} />
                        <Stat
                          label="거부"
                          value={metrics?.denied ?? link.denied_count}
                          {...((metrics?.denied ?? link.denied_count) > 0
                            ? { delta: '주의', deltaVariant: 'negative' as const }
                            : {})}
                        />
                      </StatGroup>
                      <p className="muted small">
                        생성일 <LocalDate value={link.created_at} mode="date" />
                      </p>

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
                          <Textarea name="agreementText" defaultValue={link.agreement_text ?? ''} label="NDA/동의 문구" placeholder="동의 요구 시 표시할 약관 문구" rows={3} />
                          <div className="check-grid">
                            <Checkbox name="isActive" defaultChecked={link.is_active} label="활성" containerClassName="check-item" />
                            <Checkbox name="requireEmail" defaultChecked={link.require_email} label="이메일 요구" containerClassName="check-item" />
                            <Checkbox name="allowDownload" defaultChecked={link.allow_download} label="다운로드 허용" containerClassName="check-item" />
                            <Checkbox name="oneTime" defaultChecked={link.one_time} label="1회성" containerClassName="check-item" />
                            <Checkbox name="watermark" defaultChecked={link.watermark} label="워터마크" containerClassName="check-item" />
                            <Checkbox name="requireAgreement" defaultChecked={link.require_agreement} label="NDA 동의 요구" containerClassName="check-item" />
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
