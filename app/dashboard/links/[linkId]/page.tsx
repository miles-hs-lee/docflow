import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireOwner } from '@/lib/auth';
import { getDeniedBreakdown, getLink, getMetricsForFile } from '@/lib/data';
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

  const [fileResult, collectionResult, deniedBreakdown, eventsResult] = await Promise.all([
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
      .limit(100)
  ]);

  const metricsMap = link.file_id ? await getMetricsForFile(supabase, link.file_id) : new Map();
  const fileName = ((fileResult.data as { original_name?: string } | null)?.original_name) || null;
  const collectionName = ((collectionResult.data as { name?: string } | null)?.name) || null;
  const metrics = metricsMap.get(link.id);
  const events = (eventsResult.data ?? []) as LinkEventRow[];
  const backPath = link.collection_id ? `/dashboard/collections/${link.collection_id}` : `/dashboard/files/${link.file_id}`;

  return (
    <section className="stack-lg">
      <article className="panel">
        <div className="between">
          <div>
            <h2>{link.label}</h2>
            <p className="muted">
              대상: {collectionName ? `문서 묶음 - ${collectionName}` : fileName ?? 'Unknown'}
            </p>
          </div>
          <Link href={backPath} className="button button-ghost">
            링크 목록으로
          </Link>
        </div>
      </article>

      <article className="panel">
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
      </article>

      <article className="panel">
        <h3>거부 사유 집계</h3>
        {deniedBreakdown.length === 0 ? (
          <p className="muted">거부 이벤트가 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>사유</th>
                  <th>건수</th>
                </tr>
              </thead>
              <tbody>
                {deniedBreakdown.map((item) => (
                  <tr key={item.reason}>
                    <td>{item.reason}</td>
                    <td>{item.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="panel">
        <h3>이벤트 로그 (최근 100건)</h3>
        {events.length === 0 ? (
          <p className="muted">이벤트가 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>시간</th>
                  <th>이벤트</th>
                  <th>사유</th>
                  <th>이메일</th>
                  <th>세션</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.created_at)}</td>
                    <td>{event.event_type}</td>
                    <td>{event.reason ?? '-'}</td>
                    <td>{event.viewer_email ?? '-'}</td>
                    <td className="mono">{event.session_id ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
