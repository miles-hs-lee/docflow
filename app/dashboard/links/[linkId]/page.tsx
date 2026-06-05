import {
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
import { LocalDate } from '@/components/local-date';
import { PageHeatmap } from '@/components/page-heatmap';
import { VisitorList } from '@/components/visitor-list';
import { requireOwner } from '@/lib/auth';
import {
  getDeniedBreakdown,
  getLink,
  getMetricsForLink,
  listFilesForCollection,
  listLinkDailyViews,
  listLinkVisitors,
  listPerPageStats
} from '@/lib/data';
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

type PageSection = { key: string; name: string; stats: PerPageStat[] };

const EVENTS_PAGE = 100;

export default async function LinkDetailPage({ params, searchParams }: LinkDetailPageProps) {
  const { linkId } = await params;
  const { before } = await searchParams;
  const beforeId = before && /^\d+$/.test(before) ? Number(before) : undefined;

  const { supabase } = await requireOwner();

  const link = await getLink(supabase, linkId);
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

  const [fileResult, collectionResult, deniedBreakdown, eventsResult, metrics, dailyViews, collectionFiles, visitors] =
    await Promise.all([
      link.file_id
        ? supabase.from('files').select('id, original_name').eq('id', link.file_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      link.collection_id
        ? supabase.from('collections').select('id, name').eq('id', link.collection_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      getDeniedBreakdown(supabase, link.id),
      eventsQuery,
      getMetricsForLink(supabase, link),
      listLinkDailyViews({ ownerId: link.owner_id, linkId: link.id, days: 30 }),
      link.collection_id ? listFilesForCollection(supabase, link.collection_id) : Promise.resolve([]),
      listLinkVisitors({ ownerId: link.owner_id, linkId: link.id })
    ]);

  const fileName = ((fileResult.data as { original_name?: string } | null)?.original_name) || null;
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
        stats: await listPerPageStats({ ownerId: link.owner_id, fileId: link.file_id, linkId: link.id })
      }
    ];
  } else if (link.collection_id) {
    pageSections = await Promise.all(
      collectionFiles.map(async (file) => ({
        key: file.id,
        name: file.original_name,
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
            <Button asChild variant="secondary" size="sm">
              <Link href={backPath}>
                <ChevronLeftIcon size={14} aria-hidden />
                링크 목록
              </Link>
            </Button>
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
            <CardTitle>방문자</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">이 링크를 열람한 방문자별 활동입니다. 이메일을 수집한 경우 같은 사람의 여러 방문이 한 행으로 합쳐집니다.</p>
            <VisitorList visitors={visitors} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>최근 30일 열람 추세</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">막대 높이는 그 날 활동한 세션 수입니다(열람·페이지 신호 기준).</p>
            <DailyViewsChart data={dailyViews} />
          </CardBody>
        </Card>

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
                    <PageHeatmap stats={section.stats} />
                  </div>
                ))}
              </Stack>
            ) : (
              <PageHeatmap stats={sectionsWithData[0].stats} />
            )}
          </CardBody>
        </Card>

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
