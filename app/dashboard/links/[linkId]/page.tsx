import { Button, Card, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@polaris/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOwner } from '@/lib/auth';
import { getDeniedBreakdown, getLink, getMetricsForLink } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

type LinkDetailPageProps = {
  params: Promise<{ linkId: string }>;
};

type LinkEventRow = {
  id: number;
  event_type: string;
  reason: string | null;
  viewer_email: string | null;
  created_at: string;
  session_id: string | null;
};

export default async function LinkDetailPage({ params }: LinkDetailPageProps) {
  const { linkId } = await params;
  const { supabase } = await requireOwner();

  const link = await getLink(supabase, linkId);
  if (!link) {
    notFound();
  }

  // Run metrics call in the same Promise.all batch — previously it ran
  // serially after the parent batch and added one round trip to TTFB.
  const [fileResult, collectionResult, deniedBreakdown, eventsResult, metrics] = await Promise.all([
    link.file_id
      ? supabase.from('files').select('id, original_name').eq('id', link.file_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    link.collection_id
      ? supabase.from('collections').select('id, name').eq('id', link.collection_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getDeniedBreakdown(supabase, link.id),
    supabase
      .from('link_events')
      .select('id, event_type, reason, viewer_email, created_at, session_id')
      .eq('link_id', link.id)
      .order('created_at', { ascending: false })
      .limit(100),
    getMetricsForLink(supabase, link)
  ]);

  const fileName = ((fileResult.data as { original_name?: string } | null)?.original_name) || null;
  const collectionName = ((collectionResult.data as { name?: string } | null)?.name) || null;
  const events = (eventsResult.data ?? []) as LinkEventRow[];
  const backPath = link.collection_id ? `/dashboard/collections/${link.collection_id}` : `/dashboard/files/${link.file_id}`;

  return (
    <section className="stack-lg">
      <Card className="panel" variant="padded">
        <div className="between">
          <div className="stack-sm">
            <h2>{link.label}</h2>
            <p className="muted">
              대상: {collectionName ? `문서 묶음 - ${collectionName}` : fileName ?? 'Unknown'}
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href={backPath}>링크 목록으로</Link>
          </Button>
        </div>
      </Card>

      <Card className="panel" variant="padded">
        <h3>요약 지표</h3>
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
      </Card>

      <Card className="panel" variant="padded">
        <h3>거부 사유 집계</h3>
        {deniedBreakdown.length === 0 ? (
          <EmptyState title="거부 이벤트가 없습니다" description="정책 불충족 이벤트가 발생하면 이곳에 집계됩니다." />
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
      </Card>

      <Card className="panel" variant="padded">
        <h3>이벤트 로그 (최근 100건)</h3>
        {events.length === 0 ? (
          <EmptyState title="이벤트가 없습니다" description="열람, 다운로드, 거부, 입력 이벤트가 발생하면 기록됩니다." />
        ) : (
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
                  <TableCell>{formatDateTime(event.created_at)}</TableCell>
                  <TableCell>{event.event_type}</TableCell>
                  <TableCell>{event.reason ?? '-'}</TableCell>
                  <TableCell>{event.viewer_email ?? '-'}</TableCell>
                  <TableCell className="mono">{event.session_id ?? '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </section>
  );
}
