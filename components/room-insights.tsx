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

import { InlineBar } from '@/components/inline-bar';
import { LocalDate } from '@/components/local-date';
import type { CollectionAgreementRow, CollectionFileEngagement, CollectionVisitorCell } from '@/lib/data';
import { EVENT_META } from '@/lib/event-labels';
import { formatDuration } from '@/lib/format';
import type { FileRow, ShareLinkRow } from '@/lib/types';

type RoomInsightsProps = {
  files: FileRow[];
  links: ShareLinkRow[];
  engagement: CollectionFileEngagement[];
  matrix: CollectionVisitorCell[];
  agreements: CollectionAgreementRow[];
  recentEvents: Array<{ id: number; event_type: string; reason: string | null; viewer_email: string | null; created_at: string }>;
};

// Matrix columns are visitors; cap them so a busy room stays readable.
const MATRIX_VISITOR_CAP = 10;

// Compact dwell for matrix cells: '✓' = visited without measurable dwell.
function cellDwell(ms: number): string {
  if (ms < 1000) return '✓';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.round(totalSeconds / 60)}m`;
}

function visitorLabel(cell: { viewer_email: string | null; visitor_key: string }): string {
  return cell.viewer_email ?? `익명 · ${cell.visitor_key.slice(0, 8)}`;
}

// Room-level engagement: per-file hotness, the visitor × document grid, the
// NDA assent log, and a recent-activity feed — the "who saw what" artifacts
// a data room owner reports on. Pure display; all aggregation happens in
// the 041 RPCs / queries.
export function RoomInsights({ files, links, engagement, matrix, agreements, recentEvents }: RoomInsightsProps) {
  const fileName = new Map(files.map((file) => [file.id, file.original_name]));
  const linkLabel = new Map(links.map((link) => [link.id, link.label]));

  const rankedFiles = [...engagement]
    .filter((row) => fileName.has(row.file_id))
    .sort((a, b) => b.viewers - a.viewers || b.total_dwell_ms - a.total_dwell_ms);

  // Pivot matrix cells → rows per file, columns per visitor (most recent first).
  const visitorOrder: string[] = [];
  const visitorMeta = new Map<string, { viewer_email: string | null; visitor_key: string; last: string }>();
  for (const cell of matrix) {
    const existing = visitorMeta.get(cell.visitor_key);
    if (!existing) {
      visitorMeta.set(cell.visitor_key, { viewer_email: cell.viewer_email, visitor_key: cell.visitor_key, last: cell.last_seen });
      visitorOrder.push(cell.visitor_key);
    } else if (cell.last_seen > existing.last) {
      existing.last = cell.last_seen;
      if (cell.viewer_email) existing.viewer_email = cell.viewer_email;
    }
  }
  visitorOrder.sort((a, b) => (visitorMeta.get(b)?.last ?? '').localeCompare(visitorMeta.get(a)?.last ?? ''));
  const visibleVisitors = visitorOrder.slice(0, MATRIX_VISITOR_CAP);
  const hiddenVisitorCount = visitorOrder.length - visibleVisitors.length;
  const cellMap = new Map<string, CollectionVisitorCell>();
  for (const cell of matrix) {
    cellMap.set(`${cell.visitor_key}:${cell.file_id}`, cell);
  }
  const matrixFiles = files.filter((file) =>
    visibleVisitors.some((visitor) => cellMap.has(`${visitor}:${file.id}`))
  );
  // Heat scale for matrix cells — intensity is relative to the busiest cell.
  const maxCellDwell = Math.max(...matrix.map((cell) => cell.total_dwell_ms), 1);
  const cellIntensity = (dwellMs: number) =>
    dwellMs <= 0 ? 8 : Math.max(12, Math.round((dwellMs / maxCellDwell) * 55));

  return (
    <>
      <div>
        <strong className="muted small">문서별 인기</strong>
        {rankedFiles.length === 0 ? (
          <EmptyState
            title="아직 열람 신호가 없습니다"
            description="공유 링크로 문서가 열람되면 문서별 인기와 방문자 매트릭스가 여기 집계됩니다."
          />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>문서</TableHead>
                <TableHead nowrap>열람자</TableHead>
                <TableHead nowrap>총 체류</TableHead>
                <TableHead nowrap>다운로드</TableHead>
                <TableHead nowrap>최근 활동</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankedFiles.map((row) => {
                const maxViewers = rankedFiles[0]?.viewers ?? 0;
                return (
                  <TableRow key={row.file_id}>
                    <TableCell>{fileName.get(row.file_id)}</TableCell>
                    <TableCell nowrap>
                      <InlineBar value={row.viewers} max={maxViewers} />
                    </TableCell>
                    <TableCell nowrap>{formatDuration(row.total_dwell_ms)}</TableCell>
                    <TableCell nowrap>{row.downloads > 0 ? row.downloads : '-'}</TableCell>
                    <TableCell nowrap>{row.last_activity ? <LocalDate value={row.last_activity} /> : '-'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {matrixFiles.length > 0 && visibleVisitors.length > 0 ? (
        <div>
          <strong className="muted small">
            방문자 × 문서 매트릭스
            {hiddenVisitorCount > 0 ? ` (최근 ${MATRIX_VISITOR_CAP}명 표시 · 외 ${hiddenVisitorCount}명)` : ''}
          </strong>
          <div className="room-matrix-scroll">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>문서</TableHead>
                  {visibleVisitors.map((visitor) => {
                    const meta = visitorMeta.get(visitor);
                    return (
                      <TableHead key={visitor} nowrap>
                        {meta ? visitorLabel(meta) : visitor.slice(0, 8)}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {matrixFiles.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell>{file.original_name}</TableCell>
                    {visibleVisitors.map((visitor) => {
                      const cell = cellMap.get(`${visitor}:${file.id}`);
                      return (
                        <TableCell key={visitor} nowrap>
                          {cell ? (
                            <span
                              className="room-matrix-cell"
                              style={{
                                // eslint-disable-next-line -- --primary: app brand accent (globals.css), intensity is computed
                                background: `color-mix(in srgb, var(--primary) ${cellIntensity(cell.total_dwell_ms)}%, transparent)`
                              }}
                              title={`${cell.pages_viewed}p 열람 · ${formatDuration(cell.total_dwell_ms)}`}
                            >
                              {cellDwell(cell.total_dwell_ms)}
                            </span>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="muted small">진할수록 그 문서에 오래 머문 것입니다 (✓ = 열람만 기록).</p>
        </div>
      ) : null}

      {agreements.length > 0 ? (
        <div>
          <strong className="muted small">NDA 서명 기록</strong>
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>서명(이름)</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>링크</TableHead>
                <TableHead nowrap>시각</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agreements.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.agreement_name ?? '-'}</TableCell>
                  <TableCell>{row.viewer_email ?? '익명'}</TableCell>
                  <TableCell>{row.link_id ? (linkLabel.get(row.link_id) ?? '-') : '-'}</TableCell>
                  <TableCell nowrap>
                    <LocalDate value={row.created_at} mode="datetime" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <div>
        <strong className="muted small">최근 활동</strong>
        {recentEvents.length === 0 ? (
          <p className="muted">아직 활동이 없습니다.</p>
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead nowrap>시간</TableHead>
                <TableHead>이벤트</TableHead>
                <TableHead>방문자</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentEvents.map((event) => (
                <TableRow key={event.id}>
                  <TableCell nowrap>
                    <LocalDate value={event.created_at} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="neutral" tone="subtle">
                      {EVENT_META[event.event_type]?.short ?? event.event_type}
                    </Badge>
                    {event.reason ? <span className="muted small"> · {event.reason}</span> : null}
                  </TableCell>
                  <TableCell>{event.viewer_email ?? '익명'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
