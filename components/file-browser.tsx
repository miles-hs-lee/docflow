'use client';

import {
  Badge,
  Button,
  EmptyState,
  FileIcon,
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
import { useMemo, useState } from 'react';

import { HiddenInput } from '@/components/hidden-input';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { FileRow } from '@/lib/types';

type SortKey = 'created_at' | 'original_name' | 'size_bytes';
type SortDir = 'asc' | 'desc';
type DeleteAction = (formData: FormData) => void | Promise<void>;

const PAGE_SIZE_OPTIONS = ['10', '25', '50', '100'] as const;

export function FileBrowser({
  files,
  deleteFileAction
}: {
  files: FileRow[];
  deleteFileAction: DeleteAction;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.original_name.toLowerCase().includes(q));
  }, [files, query]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'original_name') return a.original_name.localeCompare(b.original_name) * dir;
      if (sortKey === 'size_bytes') return (a.size_bytes - b.size_bytes) * dir;
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visible = sorted.slice(start, start + pageSize);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'original_name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc'
      ? <ArrowUpIcon size={12} aria-hidden />
      : <ArrowDownIcon size={12} aria-hidden />;
  };

  const handleQuery = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setPage(1);
  };

  const handlePageSize = (value: string) => {
    setPageSize(Number(value));
    setPage(1);
  };

  if (files.length === 0) {
    return (
      <EmptyState
        title="업로드된 파일이 없습니다"
        description="첫 PDF를 업로드하면 링크 정책과 통계를 관리할 수 있습니다."
      />
    );
  }

  return (
    <div className="file-browser">
      <div className="file-browser-toolbar">
        <div className="file-browser-search">
          <SearchIcon size={16} aria-hidden />
          <Input
            value={query}
            onChange={handleQuery}
            placeholder="파일명 검색"
            aria-label="파일명 검색"
            className="file-browser-search-input"
          />
        </div>
        <div className="file-browser-meta">
          <Badge variant="neutral" tone="subtle">
            {filtered.length === files.length
              ? `${files.length}개`
              : `${filtered.length} / ${files.length}개`}
          </Badge>
          <span className="muted small">페이지당</span>
          <Select value={String(pageSize)} onValueChange={handlePageSize}>
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
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="검색 결과가 없습니다"
          description={`"${query}"와 일치하는 파일이 없습니다. 다른 키워드로 시도해보세요.`}
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
            {visible.map((file) => (
              <TableRow key={file.id}>
                <TableCell>
                  <span className="row-actions">
                    <FileIcon type="pdf" size={24} />
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

      {totalPages > 1 ? (
        <Pagination className="file-browser-pagination">
          <PaginationPrev disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
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
                onClick={() => setPage(item)}
              >
                {item}
              </PaginationItem>
            )
          )}
          <PaginationNext
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            다음
          </PaginationNext>
        </Pagination>
      ) : null}
    </div>
  );
}
