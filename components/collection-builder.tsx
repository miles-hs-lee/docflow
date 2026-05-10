'use client';

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  FileIcon,
  Input,
  PaginationFooter,
  TableSkeleton
} from '@polaris/ui';
import { SearchIcon } from '@polaris/ui/icons';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { FileRow } from '@/lib/types';

type CreateAction = (formData: FormData) => void | Promise<void>;

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type FetchState = {
  rows: FileRow[];
  total: number;
  loading: boolean;
  error: string | null;
};

export function CollectionBuilder({
  createCollectionAction
}: {
  createCollectionAction: CreateAction;
}) {
  // Server-driven file picker — fetches from /api/owner/files with the
  // current search/page so we never need every file in client memory.
  const [draftQuery, setDraftQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<FetchState>({ rows: [], total: 0, loading: true, error: null });
  // Track the selected file IDs separately from the current page so the
  // selection survives pagination + search.
  const [selectedMap, setSelectedMap] = useState<Map<string, FileRow>>(new Map());
  const debounceRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setAppliedQuery(draftQuery);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [draftQuery]);

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((s) => ({ ...s, loading: true, error: null }));

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE)
    });
    if (appliedQuery.trim()) params.set('q', appliedQuery.trim());

    fetch(`/api/owner/files?${params.toString()}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('failed');
        const json = (await res.json()) as { rows: FileRow[]; total: number };
        setState({ rows: json.rows, total: json.total, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return;
        setState({ rows: [], total: 0, loading: false, error: '파일 목록을 불러오지 못했습니다.' });
      });

    return () => controller.abort();
  }, [appliedQuery, page]);

  const toggleFile = useCallback((file: FileRow, checked: boolean | 'indeterminate') => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (checked === true) next.set(file.id, file);
      else next.delete(file.id);
      return next;
    });
  }, []);

  const selectVisible = useCallback(() => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      for (const file of state.rows) next.set(file.id, file);
      return next;
    });
  }, [state.rows]);

  const clearSelection = useCallback(() => setSelectedMap(new Map()), []);

  const selectedList = Array.from(selectedMap.values());

  return (
    <form action={createCollectionAction} className="collection-builder">
      <div className="collection-builder-meta">
        <Input name="name" required label="묶음 이름" placeholder="예: 2026 제안서 세트" />
        <Input name="description" label="설명 (선택)" placeholder="외부 공유용 기본 자료 묶음" />
      </div>

      <div className="collection-builder-toolbar">
        <div className="file-browser-search">
          <SearchIcon size={16} aria-hidden />
          <Input
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder="묶음에 추가할 파일 검색"
            aria-label="파일 검색"
            className="file-browser-search-input"
          />
        </div>
        <div className="collection-builder-meta-right">
          <Badge variant="primary" tone={selectedMap.size > 0 ? 'solid' : 'subtle'}>
            선택 {selectedMap.size}개
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectVisible}
            disabled={state.rows.length === 0}
          >
            현재 페이지 모두 선택
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            disabled={selectedMap.size === 0}
          >
            선택 해제
          </Button>
        </div>
      </div>

      {state.error ? (
        <EmptyState title="불러오기 실패" description={state.error} />
      ) : state.loading && state.rows.length === 0 ? (
        <TableSkeleton rows={5} columns={2} showHeader={false} />
      ) : state.rows.length === 0 ? (
        <EmptyState
          title={appliedQuery ? '검색 결과가 없습니다' : '업로드된 파일이 없습니다'}
          description={
            appliedQuery
              ? `"${appliedQuery}"와 일치하는 파일이 없습니다.`
              : '문서 묶음을 만들려면 PDF를 먼저 업로드해주세요.'
          }
        />
      ) : (
        <ul className="collection-builder-list">
          {state.rows.map((file) => {
            const isChecked = selectedMap.has(file.id);
            return (
              <li key={file.id} className={`collection-builder-row${isChecked ? ' selected' : ''}`}>
                <label className="collection-builder-row-label">
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(c) => toggleFile(file, c)}
                  />
                  <FileIcon type="pdf" size={20} />
                  <span className="collection-builder-row-name">{file.original_name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {state.total > PAGE_SIZE ? (
        <PaginationFooter
          page={page}
          total={state.total}
          pageSize={PAGE_SIZE}
          showPageSize={false}
          onPageChange={setPage}
        />
      ) : null}

      {selectedList.length > 0 ? (
        <div className="collection-builder-summary">
          <span className="muted small">선택된 파일</span>
          <ul className="collection-builder-chip-list">
            {selectedList.map((file) => (
              <li key={file.id} className="collection-file-chip">
                <FileIcon type="pdf" size={14} />
                {file.original_name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Submit the selection as fileIds — invisible inputs so the form action picks them up */}
      {selectedList.map((file) => (
        <input key={file.id} type="hidden" name="fileIds" value={file.id} />
      ))}

      <Button type="submit" disabled={selectedMap.size < 2}>
        문서 묶음 생성{selectedMap.size >= 2 ? ` (${selectedMap.size}개)` : ''}
      </Button>
    </form>
  );
}
