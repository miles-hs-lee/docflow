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

type VisitorListProps = {
  visitors: LinkVisitor[];
};

// Visitor-centric view of a link's analytics: one row per person (email
// when collected, else an anonymous session). Complements the chronological
// event log with a "who engaged, and how much" rollup.
export function VisitorList({ visitors }: VisitorListProps) {
  if (visitors.length === 0) {
    return (
      <EmptyState
        title="아직 방문자가 없습니다"
        description="누군가 이 링크로 문서를 열람하면 방문자별 활동이 여기 집계됩니다."
      />
    );
  }

  return (
    <Table density="compact">
      <TableHeader>
        <TableRow>
          <TableHead>방문자</TableHead>
          <TableHead nowrap>최근 방문</TableHead>
          <TableHead nowrap>방문 수</TableHead>
          <TableHead nowrap>열람 페이지</TableHead>
          <TableHead nowrap>체류 시간</TableHead>
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
          return (
            <TableRow key={visitor.visitor_key}>
              <TableCell className={identified ? undefined : 'mono'}>{label}</TableCell>
              <TableCell nowrap>
                <LocalDate value={visitor.last_seen} />
              </TableCell>
              <TableCell nowrap>{visitor.sessions}</TableCell>
              <TableCell nowrap>{visitor.pages_viewed}</TableCell>
              <TableCell nowrap>{formatDuration(visitor.total_dwell_ms)}</TableCell>
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
