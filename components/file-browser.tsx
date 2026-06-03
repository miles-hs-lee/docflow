'use client';

import {
  Badge,
  Button,
  EmptyState,
  FileCard,
  PaginationFooter,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSearchInput,
  type TableSortDirection
} from '@polaris/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition, type MouseEvent } from 'react';

import { HiddenInput } from '@/components/hidden-input';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { FileRow } from '@/lib/types';

type SortKey = 'created_at' | 'original_name' | 'size_bytes';
type SortDir = 'asc' | 'desc';
type DeleteAction = (formData: FormData) => void | Promise<void>;

const SEARCH_DEBOUNCE_MS = 300;

// PaginationFooter anchor mode renders each page item as `linkAs`. Plain
// next/link would (a) scroll the viewport to the top on every page click
// and (b) eagerly prefetch every visible page-number link on viewport
// entry — re-firing whenever the search/sort querystring changes. This
// wrapper preserves scroll position and disables prefetch (pagination
// targets are rarely the next click), keeping navigation to a single
// router fetch on actual click.
function PaginationLink({ href, children, ...rest }: React.ComponentProps<typeof Link>) {
  return (
    <Link href={href} scroll={false} prefetch={false} {...rest}>
      {children}
    </Link>
  );
}

export function FileBrowser({
  files,
  totalCount,
  page,
  pageSize,
  search,
  sortKey,
  sortDir,
  deleteFileAction
}: {
  files: FileRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  deleteFileAction: DeleteAction;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const buildHref = useCallback(
    (overrides: Partial<{ fp: number; fz: number; fq: string; fs: SortKey | null; fd: SortDir | null }>) => {
      const next = new URLSearchParams(searchParams.toString());
      const set = (key: string, value: string | number | undefined | null) => {
        if (value === undefined || value === '' || value === null) next.delete(key);
        else next.set(key, String(value));
      };
      if ('fp' in overrides) set('fp', overrides.fp === 1 ? undefined : overrides.fp);
      if ('fz' in overrides) set('fz', overrides.fz);
      if ('fq' in overrides) set('fq', overrides.fq?.trim() || undefined);
      if ('fs' in overrides) set('fs', overrides.fs);
      if ('fd' in overrides) set('fd', overrides.fd);
      const qs = next.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams]
  );

  const navigate = useCallback(
    (overrides: Parameters<typeof buildHref>[0]) => {
      const href = buildHref(overrides);
      startTransition(() => router.push(href, { scroll: false }));
    },
    [buildHref, router]
  );

  // Polaris TableHead sortable: each column tracks its own direction
  // (null when not the active sort). On change we push a new URL with
  // (fs, fd) updated. The cycle null→asc→desc→null is built in.
  const directionFor = (key: SortKey): TableSortDirection => (sortKey === key ? sortDir : null);

  const handleSortChange = (key: SortKey) => (next: TableSortDirection) => {
    if (next === null) {
      // Reverting to default — sort by created_at desc.
      navigate({ fs: 'created_at', fd: 'desc', fp: 1 });
    } else {
      navigate({ fs: key, fd: next, fp: 1 });
    }
  };

  if (totalCount === 0 && search === '') {
    return (
      <EmptyState
        title="업로드된 파일이 없습니다"
        description="첫 PDF를 업로드하면 링크 정책과 통계를 관리할 수 있습니다."
        action={
          <Button asChild>
            <Link href="#upload">PDF 업로드</Link>
          </Button>
        }
      />
    );
  }

  return (
    <Stack gap={4}>
      <Stack direction="row" justify="between" align="center" gap={4} wrap>
        <TableSearchInput
          value={search}
          onValueChange={(next) => navigate({ fq: next, fp: 1 })}
          debounceMs={SEARCH_DEBOUNCE_MS}
          placeholder="파일명 검색"
          aria-label="파일명 검색"
        />
        <Badge variant="neutral" tone="subtle">
          {search ? `${totalCount}개 일치` : `전체 ${totalCount}개`}
        </Badge>
      </Stack>

      {files.length === 0 ? (
        <EmptyState
          title="검색 결과가 없습니다"
          description={`"${search}"와 일치하는 파일이 없습니다. 다른 키워드로 시도해보세요.`}
          action={
            <Button variant="ghost" onClick={() => navigate({ fq: '', fp: 1 })}>
              검색 초기화
            </Button>
          }
        />
      ) : (
        <Table density="compact">
          <TableHeader>
            <TableRow>
              <TableHead
                sortable
                sortDirection={directionFor('original_name')}
                onSortChange={handleSortChange('original_name')}
              >
                파일명
              </TableHead>
              <TableHead
                sortable
                sortDirection={directionFor('created_at')}
                onSortChange={handleSortChange('created_at')}
              >
                업로드일
              </TableHead>
              <TableHead
                sortable
                sortDirection={directionFor('size_bytes')}
                onSortChange={handleSortChange('size_bytes')}
              >
                크기
              </TableHead>
              <TableHead>작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => {
              const detailHref = `/dashboard/files/${file.id}`;
              const handleRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
                // Polaris already swallows clicks on interactive descendants
                // (buttons, anchors, form controls), but guard against
                // future regressions for our custom HiddenInput etc.
                const target = event.target as HTMLElement;
                if (target.closest('button, a, form, input, [role="menu"]')) return;
                router.push(detailHref);
              };
              return (
                <TableRow
                  key={file.id}
                  clickable
                  onClick={handleRowClick}
                  aria-label={`${file.original_name} 링크 관리로 이동`}
                >
                  <TableCell>
                    <FileCard
                      type="pdf"
                      name={file.original_name}
                      meta={`${formatBytes(file.size_bytes)} · ${formatDateTime(file.created_at)}`}
                    />
                  </TableCell>
                  <TableCell>{formatDateTime(file.created_at)}</TableCell>
                  <TableCell>{formatBytes(file.size_bytes)}</TableCell>
                  <TableCell>
                    <Stack direction="row" align="center" gap={2} wrap>
                      <Button asChild variant="secondary" size="sm">
                        <Link href={detailHref}>링크 관리</Link>
                      </Button>
                      <form action={deleteFileAction}>
                        <HiddenInput name="fileId" value={file.id} />
                        <Button type="submit" variant="danger" size="sm">
                          파일 삭제
                        </Button>
                      </form>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {totalCount > pageSize ? (
        // v0.8-rc.8 anchor mode: each page item is a real <a> (PaginationLink),
        // so right-click "open in new tab" works and the URL stays shareable.
        // PaginationLink sets scroll={false} (preserve list position, matching
        // the imperative navigate() path) and prefetch={false} (avoid
        // prefetching every visible page link on viewport entry).
        // onPageChange is omitted (the href drives navigation); page-size is
        // imperative since it's a control, not a navigation target.
        <PaginationFooter
          page={page}
          total={totalCount}
          pageSize={pageSize}
          buildHref={(next) => buildHref({ fp: next })}
          linkAs={PaginationLink}
          onPageSizeChange={(size) => navigate({ fz: size, fp: 1 })}
        />
      ) : null}
    </Stack>
  );
}
