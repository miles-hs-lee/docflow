import {
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
import Link from 'next/link';

import { GettingStarted } from '@/components/getting-started';
import { LocalDate } from '@/components/local-date';
import { requireWorkspace } from '@/lib/auth';
import { getWorkspaceOverview, listRecentEvents, listWorkspaceTopDocuments } from '@/lib/data';
import { EVENT_META } from '@/lib/event-labels';

export default async function OverviewPage() {
  const { supabase, workspace } = await requireWorkspace();
  const [overview, topDocs, recent, filesCount, linksCount] = await Promise.all([
    getWorkspaceOverview(workspace.id),
    listWorkspaceTopDocuments(workspace.id, 5),
    listRecentEvents(supabase, workspace.id, 12),
    // Head-only counts power the first-run checklist; ~free under RLS.
    supabase
      .from('files')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .then((res) => res.count ?? 0),
    supabase
      .from('share_links')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspace.id)
      .is('deleted_at', null)
      .then((res) => res.count ?? 0)
  ]);

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader title="대시보드" description="계정 전체의 문서 열람 현황을 한눈에 봅니다." />

        <GettingStarted filesCount={filesCount} linksCount={linksCount} opens={overview.opens} />

        <Card>
          <CardHeader>
            <CardTitle>전체 통계</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">활성 공유 링크 전체를 합산한 지표입니다.</p>
            <StatGroup cols={4} unwrapped>
              <Stat label="총 조회수" value={overview.opens} helper="총 열람" />
              <Stat label="유니크 방문자" value={overview.unique_viewers} helper="계정 전체" />
              <Stat label="다운로드" value={overview.downloads} />
              <Stat
                label="거부"
                value={overview.denied}
                {...(overview.denied > 0 ? { delta: '주의', deltaVariant: 'negative' as const } : {})}
              />
            </StatGroup>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>인기 문서</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">최근 30일 동안 가장 많이 열람된 문서입니다.</p>
            {topDocs.length === 0 ? (
              <EmptyState
                title="최근 30일간 열람된 문서가 없습니다"
                description="문서를 공유하고 열람되면 가장 많이 본 문서가 여기 표시됩니다."
              />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>문서</TableHead>
                    <TableHead nowrap>열람자</TableHead>
                    <TableHead nowrap>열람 수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topDocs.map((doc) => (
                    <TableRow key={doc.file_id}>
                      <TableCell>
                        <Link href={`/dashboard/files/${doc.file_id}`}>{doc.original_name}</Link>
                      </TableCell>
                      <TableCell nowrap>{doc.viewers}</TableCell>
                      <TableCell nowrap>{doc.views}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>최근 활동</CardTitle>
          </CardHeader>
          <CardBody>
            {recent.length === 0 ? (
              <EmptyState
                title="최근 활동이 없습니다"
                description="열람·다운로드·거부 등 이벤트가 발생하면 여기 표시됩니다."
              />
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
                  {recent.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell nowrap>
                        <LocalDate value={event.created_at} />
                      </TableCell>
                      <TableCell>
                        {EVENT_META[event.event_type]?.short ?? event.event_type}
                        {event.reason ? ` · ${event.reason}` : ''}
                      </TableCell>
                      <TableCell>{event.viewer_email ?? '익명'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
