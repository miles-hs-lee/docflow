'use client';

import {
  Badge,
  Button,
  EmptyState,
  FileCard,
  HStack,
  Input,
  PAGE_ELLIPSIS,
  Pagination,
  PaginationItem,
  PaginationNext,
  PaginationPrev,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  pageNumberItems
} from '@polaris/ui';
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from '@polaris/ui/icons';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { HiddenInput } from '@/components/hidden-input';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { FileRow } from '@/lib/types';

type SortKey = 'created_at' | 'original_name' | 'size_bytes';
type SortDir = 'asc' | 'desc';
type DeleteAction = (formData: FormData) => void | Promise<void>;

const PAGE_SIZE_OPTIONS = ['10', '25', '50', '100'] as const;
const SEARCH_DEBOUNCE_MS = 300;

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
  const [draftSearch, setDraftSearch] = useState(search);
  const debounceRef = useRef<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);

  const buildHref = useCallback(
    (overrides: Partial<{ fp: number; fz: number; fq: string; fs: SortKey; fd: SortDir }>) => {
      const next = new URLSearchParams(searchParams.toString());
      const set = (key: string, value: string | number | undefined) => {
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

  // Debounce free-text search → URL push. The server re-renders with the
  // new query and Next streams the updated table back in via transition.
  useEffect(() => {
    setDraftSearch(search);
  }, [search]);

  useEffect(() => {
    if (draftSearch === search) return;
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      navigate({ fq: draftSearch, fp: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [draftSearch, search, navigate]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      navigate({ fd: sortDir === 'asc' ? 'desc' : 'asc', fp: 1 });
    } else {
      const nextDir: SortDir = key === 'original_name' ? 'asc' : 'desc';
      navigate({ fs: key, fd: nextDir, fp: 1 });
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? (
      <ArrowUpIcon size={12} aria-hidden />
    ) : (
      <ArrowDownIcon size={12} aria-hidden />
    );
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
      <HStack justify="between" align="center" gap={4} wrap>
        <div className="file-browser-search">
          <SearchIcon size={16} aria-hidden />
          <Input
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            placeholder="파일명 검색"
            aria-label="파일명 검색"
            className="file-browser-search-input"
          />
        </div>
        <HStack align="center" gap={2}>
          <Badge variant="neutral" tone="subtle">
            {search ? `${totalCount}개 일치` : `전체 ${totalCount}개`}
          </Badge>
          <span className="muted small">페이지당</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => navigate({ fz: Number(value), fp: 1 })}
          >
            <SelectTrigger className="file-browser-pagesize" aria-label="페이지당 행 수">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </HStack>
      </HStack>

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
              <TableHead>
                <button type="button" className="sort-th" onClick={() => toggleSort('original_name')}>
                  파일명 {sortIndicator('original_name')}
                </button>
              </TableHead>
              <TableHead>
                <button type="button" className="sort-th" onClick={() => toggleSort('created_at')}>
                  업로드일 {sortIndicator('created_at')}
                </button>
              </TableHead>
              <TableHead>
                <button type="button" className="sort-th" onClick={() => toggleSort('size_bytes')}>
                  크기 {sortIndicator('size_bytes')}
                </button>
              </TableHead>
              <TableHead>작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id}>
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
                  <HStack align="center" gap={2} wrap>
                    <Button asChild variant="secondary" size="sm">
                      <Link href={`/dashboard/files/${file.id}`}>링크 관리</Link>
                    </Button>
                    <form action={deleteFileAction}>
                      <HiddenInput name="fileId" value={file.id} />
                      <Button type="submit" variant="danger" size="sm">
                        파일 삭제
                      </Button>
                    </form>
                  </HStack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {totalPages > 1 ? (
        <Pagination className="file-browser-pagination">
          <PaginationPrev disabled={safePage <= 1} onClick={() => navigate({ fp: safePage - 1 })}>
            이전
          </PaginationPrev>
          {pageNumberItems(safePage, totalPages).map((item, idx) =>
            item === PAGE_ELLIPSIS ? (
              <span key={`e-${idx}`} className="muted small">…</span>
            ) : (
              <PaginationItem
                key={item}
                active={item === safePage}
                aria-current={item === safePage ? 'page' : undefined}
                onClick={() => navigate({ fp: item })}
              >
                {item}
              </PaginationItem>
            )
          )}
          <PaginationNext
            disabled={safePage >= totalPages}
            onClick={() => navigate({ fp: safePage + 1 })}
          >
            다음
          </PaginationNext>
        </Pagination>
      ) : null}
    </Stack>
  );
}
