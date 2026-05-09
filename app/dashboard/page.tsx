import { Button, Card, Checkbox, EmptyState, FileIcon, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@polaris/ui';
import Link from 'next/link';

import { Flash } from '@/components/flash';
import { HiddenInput } from '@/components/hidden-input';
import { createCollectionAction, deleteCollectionAction, deleteFileAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listCollections, listFiles } from '@/lib/data';
import { formatBytes, formatDateTime } from '@/lib/format';

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();
  const [files, collections] = await Promise.all([listFiles(supabase), listCollections(supabase)]);

  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <Card className="panel" variant="padded">
        <div className="between">
          <div className="stack-sm">
            <h2>PDF 업로드</h2>
            <p className="muted">PDF 파일만 허용됩니다. 업로드 후 파일별로 여러 공유 링크를 만들 수 있습니다.</p>
          </div>
          <FileIcon type="pdf" size={42} />
        </div>
        <form action="/dashboard/upload" method="post" className="inline-form" encType="multipart/form-data">
          <Input type="file" name="pdf" accept="application/pdf,.pdf" required label="PDF 파일" />
          <Button type="submit">업로드</Button>
        </form>
      </Card>

      <Card className="panel" variant="padded">
        <h2>내 파일</h2>
        {files.length === 0 ? (
          <EmptyState title="업로드된 파일이 없습니다" description="첫 PDF를 업로드하면 링크 정책과 통계를 관리할 수 있습니다." />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>파일명</TableHead>
                <TableHead>업로드일</TableHead>
                <TableHead>크기</TableHead>
                <TableHead>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell>
                    <span className="row-actions">
                      <FileIcon type="pdf" size={28} />
                      <strong>{file.original_name}</strong>
                    </span>
                  </TableCell>
                  <TableCell>{formatDateTime(file.created_at)}</TableCell>
                  <TableCell>{formatBytes(file.size_bytes)}</TableCell>
                  <TableCell>
                    <div className="row-actions">
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/dashboard/files/${file.id}`}>링크 관리</Link>
                      </Button>
                      <form action={deleteFileAction}>
                        <HiddenInput name="fileId" value={file.id} />
                        <Button type="submit" variant="danger" size="sm">
                          파일 삭제
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="panel" variant="padded">
        <h2>문서 묶음 생성</h2>
        <p className="muted">여러 문서를 하나의 링크로 공유할 수 있는 묶음을 만듭니다.</p>
        {files.length < 2 ? (
          <EmptyState title="파일 2개 이상이 필요합니다" description="문서 묶음을 만들려면 PDF를 하나 더 업로드해주세요." />
        ) : (
          <form action={createCollectionAction} className="form-grid">
            <Input name="name" required label="묶음 이름" placeholder="예: 2026 제안서 세트" />
            <Input name="description" label="설명 (선택)" placeholder="외부 공유용 기본 자료 묶음" />
            <div className="collection-file-picker">
              {files.map((file) => (
                <Checkbox key={file.id} name="fileIds" value={file.id} label={file.original_name} containerClassName="check-item" />
              ))}
            </div>
            <Button type="submit">문서 묶음 생성</Button>
          </form>
        )}
      </Card>

      <Card className="panel" variant="padded">
        <h2>문서 묶음 목록</h2>
        {collections.length === 0 ? (
          <EmptyState title="생성된 문서 묶음이 없습니다" description="여러 PDF를 하나의 공유 경험으로 묶을 수 있습니다." />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>묶음명</TableHead>
                <TableHead>포함 문서 수</TableHead>
                <TableHead>생성일</TableHead>
                <TableHead>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collections.map((collection) => (
                <TableRow key={collection.id}>
                  <TableCell>
                    <span className="row-actions">
                      <FileIcon type="folder" size={28} />
                      <strong>{collection.name}</strong>
                    </span>
                  </TableCell>
                  <TableCell>{collection.file_count}</TableCell>
                  <TableCell>{formatDateTime(collection.created_at)}</TableCell>
                  <TableCell>
                    <div className="row-actions">
                      <Button asChild variant="secondary" size="sm">
                        <Link href={`/dashboard/collections/${collection.id}`}>링크 관리</Link>
                      </Button>
                      <form action={deleteCollectionAction}>
                        <HiddenInput name="collectionId" value={collection.id} />
                        <Button type="submit" variant="danger" size="sm">
                          묶음 삭제
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </section>
  );
}
