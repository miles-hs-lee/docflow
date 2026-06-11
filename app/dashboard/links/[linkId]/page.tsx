import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stack,
  Stat,
  StatGroup,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@polaris/ui';
import { ChevronLeftIcon, DownloadIcon } from '@polaris/ui/icons';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DailyViewsChart } from '@/components/daily-views-chart';
import { GateFunnelChart } from '@/components/gate-funnel';
import { CountryBars, DeviceDonut } from '@/components/geo-device-charts';
import { LocalDate } from '@/components/local-date';
import { PageHeatmap } from '@/components/page-heatmap';
import { Punchcard } from '@/components/punchcard';
import { ReachCurve } from '@/components/reach-curve';
import { VisitorList } from '@/components/visitor-list';
import { requireWorkspace } from '@/lib/auth';
import {
  getDeniedBreakdown,
  getLink,
  getLinkEngagement,
  getLinkGateFunnel,
  getLinkPunchcard,
  getMetricsForLink,
  listFilesForCollection,
  listLinkCountryBreakdown,
  listLinkDailyViews,
  listLinkVisitors,
  listPerPageStats
} from '@/lib/data';
import { formatDuration } from '@/lib/format';
import type { PerPageStat } from '@/lib/types';

type LinkDetailPageProps = {
  params: Promise<{ linkId: string }>;
  searchParams: Promise<{ before?: string }>;
};

type LinkEventRow = {
  id: number;
  event_type: string;
  reason: string | null;
  viewer_email: string | null;
  created_at: string;
  session_id: string | null;
};

type PageSection = { key: string; name: string; pageCount: number | null; stats: PerPageStat[] };

const EVENTS_PAGE = 100;

export default async function LinkDetailPage({ params, searchParams }: LinkDetailPageProps) {
  const { linkId } = await params;
  const { before } = await searchParams;
  const beforeId = before && /^\d+$/.test(before) ? Number(before) : undefined;

  const { supabase, workspace } = await requireWorkspace();

  const link = await getLink(supabase, workspace.id, linkId);
  if (!link) {
    notFound();
  }

  // Event log paginates on the bigserial id (monotonic with insertion):
  // fetch one extra row to know whether a "다음" page exists. id-desc keeps
  // newest-first; `before` is the cursor from the previous page's tail.
  let eventsQuery = supabase
    .from('link_events')
    .select('id, event_type, reason, viewer_email, created_at, session_id')
    .eq('link_id', link.id)
    .order('id', { ascending: false })
    .limit(EVENTS_PAGE + 1);
  if (typeof beforeId === 'number') {
    eventsQuery = eventsQuery.lt('id', beforeId);
  }

  const [
    fileResult,
    collectionResult,
    deniedBreakdown,
    eventsResult,
    metrics,
    dailyViews,
    collectionFiles,
    visitors,
    engagement,
    countries
  ] = await Promise.all([
    link.file_id
      ? supabase.from('files').select('id, original_name, page_count').eq('id', link.file_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    link.collection_id
      ? supabase.from('collections').select('id, name').eq('id', link.collection_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getDeniedBreakdown(supabase, link.id),
    eventsQuery,
    getMetricsForLink(supabase, link),
    listLinkDailyViews({ ownerId: link.owner_id, linkId: link.id, days: 30 }),
    link.collection_id ? listFilesForCollection(supabase, link.collection_id) : Promise.resolve([]),
    listLinkVisitors({ ownerId: link.owner_id, linkId: link.id }),
    getLinkEngagement({ ownerId: link.owner_id, linkId: link.id }),
    listLinkCountryBreakdown({ ownerId: link.owner_id, linkId: link.id })
  ]);
  const [funnel, punchcard] = await Promise.all([
    getLinkGateFunnel(link.owner_id, link.id),
    getLinkPunchcard(link.owner_id, link.id)
  ]);

  const linkedFile = fileResult.data as { original_name?: string; page_count?: number | null } | null;
  const fileName = linkedFile?.original_name || null;
  // File links only — a data room spans files, so a single page-count
  // denominator would mislead (VisitorList then shows raw pages instead).
  const filePageCount = link.file_id ? (linkedFile?.page_count ?? null) : null;
  const collectionName = ((collectionResult.data as { name?: string } | null)?.name) || null;

  const rawEvents = (eventsResult.data ?? []) as LinkEventRow[];
  const hasMore = rawEvents.length > EVENTS_PAGE;
  const events = hasMore ? rawEvents.slice(0, EVENTS_PAGE) : rawEvents;
  const nextCursor = hasMore ? events[events.length - 1].id : null;

  // #4: per-link page heatmap. File links → one section; collection links →
  // one section per contained file (page_view rows are file_id-scoped, so
  // numbers never collide across files). All scoped to THIS link.
  let pageSections: PageSection[] = [];
  if (link.file_id) {
    pageSections = [
      {
        key: link.file_id,
        name: fileName ?? '문서',
        pageCount: filePageCount,
        stats: await listPerPageStats({ ownerId: link.owner_id, fileId: link.file_id, linkId: link.id })
      }
    ];
  } else if (link.collection_id) {
    pageSections = await Promise.all(
      collectionFiles.map(async (file) => ({
        key: file.id,
        name: file.original_name,
        pageCount: file.page_count,
        stats: await listPerPageStats({ ownerId: link.owner_id, fileId: file.id, linkId: link.id })
      }))
    );
  }
  const sectionsWithData = pageSections.filter((section) => section.stats.length > 0);

  const backPath = link.collection_id ? `/dashboard/collections/${link.collection_id}` : `/dashboard/files/${link.file_id}`;
  const basePath = `/dashboard/links/${link.id}`;

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          eyebrow={
            <span className="muted small">
              공유 링크 · {collectionName ? `데이터룸 — ${collectionName}` : fileName ?? 'Unknown'}
            </span>
          }
          title={link.label}
          actions={
            <Stack direction="row" gap={2}>
              <Button asChild variant="secondary" size="sm">
                {/* Signed 15-min preview: gates bypassed, nothing counted. */}
                <a href={`/dashboard/links/${link.id}/preview`} target="_blank" rel="noreferrer">
                  미리보기
                </a>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link href={backPath}>
                  <ChevronLeftIcon size={14} aria-hidden />
                  링크 목록
                </Link>
              </Button>
            </Stack>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>요약 지표</CardTitle>
          </CardHeader>
          <CardBody>
            <StatGroup cols={4} unwrapped>
              <Stat label="조회수" value={metrics?.views ?? link.open_count} helper="총 열람" />
              <Stat label="유니크" value={metrics?.unique_viewers ?? 0} helper="세션 기준" />
              <Stat
                label="평균 체류"
                value={formatDuration(engagement.avg_dwell_ms)}
                helper={engagement.dwell_sessions > 0 ? `${engagement.dwell_sessions}세션 기준` : '신호 없음'}
              />
              <Stat label="다운로드" value={metrics?.downloads ?? link.download_count} />
              <Stat
                label="거부"
                value={metrics?.denied ?? link.denied_count}
                {...((metrics?.denied ?? link.denied_count) > 0
                  ? { delta: '주의', deltaVariant: 'negative' as const }
                  : {})}
              />
            </StatGroup>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>적용 중인 정책</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">
              이 링크에 지금 적용된 접근 정책입니다. 변경은 {collectionName ? '데이터룸' : '파일'} 페이지의 링크
              수정에서 할 수 있고, 정책을 바꾸면 발급된 접근 권한(쿠키)이 즉시 무효화됩니다.
            </p>
            <Stack direction="row" gap={2} className="policy-badge-row">
              <Badge variant={link.is_active ? 'success' : 'warning'} tone="subtle">
                {link.is_active ? '활성' : '비활성'}
              </Badge>
              {link.expires_at ? (
                <Badge variant="neutral" tone="subtle">
                  만료 <LocalDate value={link.expires_at} />
                </Badge>
              ) : null}
              {link.one_time ? (
                <Badge variant="warning" tone="subtle">1회성</Badge>
              ) : link.max_views ? (
                <Badge variant="neutral" tone="subtle">
                  조회 제한 {link.view_count}/{link.max_views}
                </Badge>
              ) : null}
              {link.require_email ? <Badge variant="info" tone="subtle">이메일 요구</Badge> : null}
              {link.allowed_domains.length > 0 ? (
                <Badge variant="info" tone="subtle">도메인: {link.allowed_domains.join(', ')}</Badge>
              ) : null}
              {link.password_hash ? <Badge variant="info" tone="subtle">비밀번호</Badge> : null}
              {link.require_agreement ? <Badge variant="info" tone="subtle">NDA 동의</Badge> : null}
              <Badge variant={link.allow_download ? 'success' : 'neutral'} tone="subtle">
                {link.allow_download ? '다운로드 허용' : '다운로드 차단'}
              </Badge>
              {link.watermark ? <Badge variant="neutral" tone="subtle">워터마크</Badge> : null}
              {link.viewer_group_id ? <Badge variant="secondary" tone="subtle">뷰어 그룹 제한</Badge> : null}
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>방문자</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">이 링크를 열람한 방문자별 활동입니다. 이메일을 수집한 경우 같은 사람의 여러 방문이 한 행으로 합쳐집니다.</p>
            <VisitorList visitors={visitors} pageCount={filePageCount} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>최근 30일 열람 추세</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">막대 높이는 그 날 활동한 세션 수입니다 — 진한 부분이 신규, 옅은 부분이 재방문(재열람 = 검토 심화 신호)입니다.</p>
            <DailyViewsChart data={dailyViews} />
          </CardBody>
        </Card>

        {funnel && funnel.visits > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>접근 퍼널</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="muted">
                방문 세션이 각 게이트를 얼마나 통과해 열람·다운로드까지 도달했는지입니다. 게이트 단계에서 폭이
                크게 줄면 정책이 이탈을 만들고 있다는 신호입니다.
              </p>
              <GateFunnelChart
                funnel={funnel}
                requireEmail={link.require_email || link.allowed_domains.length > 0}
                requireAgreement={link.require_agreement}
                allowDownload={link.allow_download}
              />
            </CardBody>
          </Card>
        ) : null}

        {punchcard.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>열람 시간대</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="muted">상대가 실제로 읽는 요일·시간입니다. 팔로업 메시지를 보낼 타이밍의 근거가 됩니다.</p>
              <Punchcard cells={punchcard} />
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>페이지별 열람 통계</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">이 링크로 열람된 페이지별 누적 dwell 시간과 열람자 수입니다. 0.8초 미만 짧은 노출은 제외됩니다.</p>
            {sectionsWithData.length === 0 ? (
              <PageHeatmap stats={[]} />
            ) : link.collection_id ? (
              <Stack gap={4}>
                {sectionsWithData.map((section) => (
                  <div key={section.key}>
                    <strong className="muted small">{section.name}</strong>
                    <ReachCurve stats={section.stats} pageCount={section.pageCount} />
                    <PageHeatmap stats={section.stats} pageCount={section.pageCount} />
                  </div>
                ))}
              </Stack>
            ) : (
              <>
                <ReachCurve stats={sectionsWithData[0].stats} pageCount={sectionsWithData[0].pageCount} />
                <PageHeatmap stats={sectionsWithData[0].stats} pageCount={sectionsWithData[0].pageCount} />
              </>
            )}
          </CardBody>
        </Card>

        {countries.length > 0 || visitors.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>국가 · 디바이스</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="muted">유니크 방문자(세션)의 접속 국가와 사용 기기입니다. 원본 IP는 저장하지 않습니다.</p>
              <div className="geo-device-grid">
                <CountryBars countries={countries} />
                <DeviceDonut visitors={visitors} />
              </div>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>거부 사유 집계</CardTitle>
          </CardHeader>
          <CardBody>
            {deniedBreakdown.length === 0 ? (
              <EmptyState
                title="거부 이벤트가 없습니다"
                description="정책 불충족 이벤트가 발생하면 이곳에 집계됩니다."
              />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>사유</TableHead>
                    <TableHead>건수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deniedBreakdown.map((item) => (
                    <TableRow key={item.reason}>
                      <TableCell>{item.reason}</TableCell>
                      <TableCell>{item.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>이벤트 로그</CardTitle>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/owner/links/${link.id}/events.csv`} download>
                <DownloadIcon size={14} aria-hidden />
                CSV 내보내기
              </a>
            </Button>
          </CardHeader>
          <CardBody>
            {events.length === 0 ? (
              <EmptyState
                title="이벤트가 없습니다"
                description="열람, 다운로드, 거부, 입력 이벤트가 발생하면 기록됩니다."
              />
            ) : (
              <>
                <Table density="compact">
                  <TableHeader>
                    <TableRow>
                      <TableHead>시간</TableHead>
                      <TableHead>이벤트</TableHead>
                      <TableHead>사유</TableHead>
                      <TableHead>이메일</TableHead>
                      <TableHead>세션</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>
                          <LocalDate value={event.created_at} />
                        </TableCell>
                        <TableCell>{event.event_type}</TableCell>
                        <TableCell>{event.reason ?? '-'}</TableCell>
                        <TableCell>{event.viewer_email ?? '-'}</TableCell>
                        <TableCell className="mono">{event.session_id ?? '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Stack direction="row" gap={2} className="event-log-pager">
                  {beforeId ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link href={basePath}>처음으로</Link>
                    </Button>
                  ) : null}
                  {nextCursor ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`${basePath}?before=${nextCursor}`}>다음 {EVENTS_PAGE}건</Link>
                    </Button>
                  ) : null}
                </Stack>
              </>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
