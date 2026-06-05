import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  FileIcon,
  PageHeader,
  Stack
} from '@polaris/ui';

import { FileBrowser } from '@/components/file-browser';
import { UploadForm } from '@/components/upload-form';
import { deleteFileAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import {
  FILES_PAGE_SIZE_DEFAULT,
  FILES_PAGE_SIZE_MAX,
  listFiles,
  type FilesSortDir,
  type FilesSortKey
} from '@/lib/data';

type ContentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SORT_KEYS: ReadonlyArray<FilesSortKey> = ['created_at', 'original_name', 'size_bytes'];
const SORT_DIRS: ReadonlyArray<FilesSortDir> = ['asc', 'desc'];

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function ContentPage({ searchParams }: ContentPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();

  // URL contract: fp = page, fz = size, fq = search, fs = sort key, fd = dir.
  const search = pickString(params.fq)?.trim() ?? '';
  const sizeRaw = Number(pickString(params.fz) ?? '');
  const pageSize =
    Number.isFinite(sizeRaw) && sizeRaw > 0 ? Math.min(sizeRaw, FILES_PAGE_SIZE_MAX) : FILES_PAGE_SIZE_DEFAULT;
  const pageRaw = Number(pickString(params.fp) ?? '1');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const sortKeyParam = pickString(params.fs) as FilesSortKey | undefined;
  const sortDirParam = pickString(params.fd) as FilesSortDir | undefined;
  const sortKey: FilesSortKey = sortKeyParam && SORT_KEYS.includes(sortKeyParam) ? sortKeyParam : 'created_at';
  const sortDir: FilesSortDir =
    sortDirParam && SORT_DIRS.includes(sortDirParam) ? sortDirParam : sortKey === 'original_name' ? 'asc' : 'desc';

  const { rows: files, total: filesTotal } = await listFiles(supabase, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    search,
    sortKey,
    sortDir
  });

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader title="콘텐츠" description="PDF를 업로드하고, 파일별로 공유 링크와 열람 통계를 관리합니다." />

        <Card>
          <CardHeader>
            <Stack direction="row" justify="between" align="start" gap={4}>
              <Stack gap={2}>
                <CardTitle>PDF 업로드</CardTitle>
                <p className="muted">PDF 파일만 허용됩니다 (최대 50MB). 업로드 후 파일별로 여러 공유 링크를 만들 수 있습니다.</p>
              </Stack>
              <FileIcon type="pdf" size={42} />
            </Stack>
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
      </section>
    </Stack>
  );
}
