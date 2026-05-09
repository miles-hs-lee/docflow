import { Button, Card, EmptyState, FileIcon, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@polaris/ui';
import Link from 'next/link';

import { CollectionBuilderLazy } from '@/components/collection-builder-lazy';
import { FileBrowser } from '@/components/file-browser';
import { Flash } from '@/components/flash';
import { HiddenInput } from '@/components/hidden-input';
import { UploadForm } from '@/components/upload-form';
import { createCollectionAction, deleteCollectionAction, deleteFileAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listCollections, listFiles } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();
  const [filesResult, collections] = await Promise.all([listFiles(supabase), listCollections(supabase)]);
  const { rows: files, total: filesTotal, limit: filesLimit } = filesResult;

  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <Card className="panel" variant="padded">
        <div className="between">
          <div className="stack-sm">
            <h2>PDF 업로드</h2>
            <p className="muted">PDF 파일만 허용됩니다 (최대 50MB). 업로드 후 파일별로 여러 공유 링크를 만들 수 있습니다.</p>
          </div>
          <FileIcon type="pdf" size={42} />
        </div>
        <UploadForm />
      </Card>

      <Card className="panel" variant="padded">
        <h2>내 파일</h2>
        <FileBrowser
          files={files}
          totalCount={filesTotal}
          fetchedLimit={filesLimit}
          deleteFileAction={deleteFileAction}
        />
      </Card>

      <Card className="panel collapsible" variant="padded">
        <CollectionBuilderLazy files={files} createCollectionAction={createCollectionAction} />
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
                      <FileIcon type="folder" size={24} />
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
