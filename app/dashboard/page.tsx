import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  FileIcon,
  HStack,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  VStack
} from '@polaris/ui';
import Link from 'next/link';

import { CollectionBuilderLazy } from '@/components/collection-builder-lazy';
import { FileBrowser } from '@/components/file-browser';
import { HiddenInput } from '@/components/hidden-input';
import { UploadForm } from '@/components/upload-form';
import { createCollectionAction, deleteCollectionAction, deleteFileAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import {
  FILES_PAGE_SIZE_DEFAULT,
  FILES_PAGE_SIZE_MAX,
  listCollections,
  listFiles,
  type FilesSortDir,
  type FilesSortKey
} from '@/lib/data';
import { formatDateTime } from '@/lib/format';

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SORT_KEYS: ReadonlyArray<FilesSortKey> = ['created_at', 'original_name', 'size_bytes'];
const SORT_DIRS: ReadonlyArray<FilesSortDir> = ['asc', 'desc'];

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();

  // URL contract for the file browser:
  //   fp = page (1-based)   fz = page size       fq = search query
  //   fs = sort key         fd = sort direction
  const search = pickString(params.fq)?.trim() ?? '';
  const sizeRaw = Number(pickString(params.fz) ?? '');
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw > 0
    ? Math.min(sizeRaw, FILES_PAGE_SIZE_MAX)
    : FILES_PAGE_SIZE_DEFAULT;
  const pageRaw = Number(pickString(params.fp) ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const sortKeyParam = pickString(params.fs) as FilesSortKey | undefined;
  const sortDirParam = pickString(params.fd) as FilesSortDir | undefined;
  const sortKey: FilesSortKey = sortKeyParam && SORT_KEYS.includes(sortKeyParam) ? sortKeyParam : 'created_at';
  const sortDir: FilesSortDir = sortDirParam && SORT_DIRS.includes(sortDirParam)
    ? sortDirParam
    : sortKey === 'original_name'
      ? 'asc'
      : 'desc';

  const [filesResult, collections] = await Promise.all([
    listFiles(supabase, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search,
      sortKey,
      sortDir
    }),
    listCollections(supabase)
  ]);
  const { rows: files, total: filesTotal } = filesResult;

  return (
    <Stack asChild gap={5}>
      <section>
        <Card>
          <CardHeader>
            <HStack justify="between" align="start" gap={4}>
              <VStack gap={2}>
                <CardTitle>PDF 업로드</CardTitle>
                <p className="muted">PDF 파일만 허용됩니다 (최대 50MB). 업로드 후 파일별로 여러 공유 링크를 만들 수 있습니다.</p>
              </VStack>
              <FileIcon type="pdf" size={42} />
            </HStack>
          </CardHeader>
          <CardBody>
            <UploadForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>내 파일</CardTitle>
          </CardHeader>
          <CardBody>
            <FileBrowser
              files={files}
              totalCount={filesTotal}
              page={page}
              pageSize={pageSize}
              search={search}
              sortKey={sortKey}
              sortDir={sortDir}
              deleteFileAction={deleteFileAction}
            />
          </CardBody>
        </Card>

        <Card className="collapsible">
          <CollectionBuilderLazy createCollectionAction={createCollectionAction} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>문서 묶음 목록</CardTitle>
          </CardHeader>
          <CardBody>
            {collections.length === 0 ? (
              <EmptyState
                title="생성된 문서 묶음이 없습니다"
                description="여러 PDF를 하나의 공유 경험으로 묶을 수 있습니다."
              />
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
                        <HStack asChild align="center" gap={2}>
                          <span>
                            <FileIcon type="folder" size={24} />
                            <strong>{collection.name}</strong>
                          </span>
                        </HStack>
                      </TableCell>
                      <TableCell>{collection.file_count}</TableCell>
                      <TableCell>{formatDateTime(collection.created_at)}</TableCell>
                      <TableCell>
                        <HStack align="center" gap={2} wrap>
                          <Button asChild variant="secondary" size="sm">
                            <Link href={`/dashboard/collections/${collection.id}`}>링크 관리</Link>
                          </Button>
                          <form action={deleteCollectionAction}>
                            <HiddenInput name="collectionId" value={collection.id} />
                            <Button type="submit" variant="danger" size="sm">
                              묶음 삭제
                            </Button>
                          </form>
                        </HStack>
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
