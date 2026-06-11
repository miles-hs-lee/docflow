import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@polaris/ui';

import { LocalDate } from '@/components/local-date';
import { formatDuration } from '@/lib/format';
import type { LinkVisitor } from '@/lib/types';
import { classifyDevice } from '@/lib/ua';

type VisitorListProps = {
  visitors: LinkVisitor[];
  // Total pages of the linked document (file links only). Enables the
  // per-visitor completion column; data-room links pass null (pages span
  // multiple files, so a single denominator would mislead).
  pageCount?: number | null;
};

const DEVICE_LABELS: Record<string, string> = {
  mobile: '모바일',
  tablet: '태블릿',
  desktop: '데스크톱'
};

// Visitor-centric view of a link's analytics: one row per person (email
// when collected, else an anonymous session). Complements the chronological
// event log with a "who engaged, and how much" rollup. Device and country
// are derived from data already on the events (UA / geo header) — display
// only, no extra collection.
export function VisitorList({ visitors, pageCount }: VisitorListProps) {
  if (visitors.length === 0) {
    return (
      <EmptyState
        title="아직 방문자가 없습니다"
        description="누군가 이 링크로 문서를 열람하면 방문자별 활동이 여기 집계됩니다."
      />
    );
  }

  const showCompletion = Boolean(pageCount && pageCount > 0);

  return (
    <Table density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>방문자</TableHead>
          <TableHead nowrap>최근 방문</TableHead>
          <TableHead nowrap>방문 수</TableHead>
          {showCompletion ? <TableHead nowrap>완독률</TableHead> : <TableHead nowrap>열람 페이지</TableHead>}
          <TableHead nowrap>체류 시간</TableHead>
          <TableHead nowrap>환경</TableHead>
          <TableHead nowrap>다운로드</TableHead>
          <TableHead nowrap>NDA</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {visitors.map((visitor) => {
          const identified = Boolean(visitor.viewer_email);
          const label = identified
            ? visitor.viewer_email
            : `익명 · ${visitor.visitor_key.slice(0, 8)}`;
          const device = classifyDevice(visitor.last_user_agent);
          const environment = [device ? DEVICE_LABELS[device] : null, visitor.country]
            .filter(Boolean)
            .join(' · ');
          const completionPct = showCompletion
            ? Math.min(100, Math.round((visitor.pages_viewed / (pageCount as number)) * 100))
            : null;
          return (
            <TableRow key={visitor.visitor_key}>
              <TableCell className={identified ? undefined : 'mono'}>{label}</TableCell>
              <TableCell nowrap>
                <LocalDate value={visitor.last_seen} />
              </TableCell>
              <TableCell nowrap>{visitor.sessions}</TableCell>
              {completionPct !== null ? (
                <TableCell nowrap>
                  {completionPct}%{' '}
                  <span className="muted small">
                    ({visitor.pages_viewed}/{pageCount}p)
                  </span>
                </TableCell>
              ) : (
                <TableCell nowrap>{visitor.pages_viewed}</TableCell>
              )}
              <TableCell nowrap>{formatDuration(visitor.total_dwell_ms)}</TableCell>
              <TableCell nowrap>{environment || '-'}</TableCell>
              <TableCell nowrap>{visitor.downloads > 0 ? visitor.downloads : '-'}</TableCell>
              <TableCell nowrap>
                {visitor.agreed ? (
                  <Badge variant="success" tone="subtle">
                    동의
                  </Badge>
                ) : (
                  '-'
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
