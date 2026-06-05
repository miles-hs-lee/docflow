import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@polaris/ui';
import { ChevronLeftIcon } from '@polaris/ui/icons';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { LocalDate } from '@/components/local-date';
import { requireOwner } from '@/lib/auth';
import { getFileRequest, listRequestUploads } from '@/lib/data';
import { publicEnv } from '@/lib/env-public';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type RequestDetailPageProps = {
  params: Promise<{ requestId: string }>;
};

export default async function RequestDetailPage({ params }: RequestDetailPageProps) {
  const { requestId } = await params;
  const { supabase } = await requireOwner();

  const request = await getFileRequest(supabase, requestId);
  if (!request) {
    notFound();
  }

  const uploads = await listRequestUploads(supabase, requestId);
  const url = `${publicEnv.appUrl}/r/${request.token}`;

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          eyebrow={<span className="muted small">파일 요청 · 받은 파일 {uploads.length}</span>}
          title={request.title}
          description={request.instructions ?? undefined}
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/requests">
                <ChevronLeftIcon size={14} aria-hidden />
                파일 요청
              </Link>
            </Button>
          }
        />

        <Card>
          <CardHeader>
            <CardTitle>받은 파일</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">
              공개 링크: <span className="mono">{url}</span>
            </p>
            {uploads.length === 0 ? (
              <EmptyState title="아직 받은 파일이 없습니다" description="이 요청으로 업로드된 파일이 여기에 표시됩니다." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>파일명</TableHead>
                    <TableHead>업로더</TableHead>
                    <TableHead>크기</TableHead>
                    <TableHead>받은 시각</TableHead>
                    <TableHead>다운로드</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.map((upload) => (
                    <TableRow key={upload.id}>
                      <TableCell>{upload.original_name}</TableCell>
                      <TableCell>{upload.uploader_email ?? '익명'}</TableCell>
                      <TableCell>{formatBytes(upload.size_bytes)}</TableCell>
                      <TableCell>
                        <LocalDate value={upload.created_at} mode="datetime" />
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="secondary">
                          <a href={`/api/owner/request-uploads/${upload.id}`}>다운로드</a>
                        </Button>
                      </TableCell>
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
