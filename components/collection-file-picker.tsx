'use client';

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  FileIcon,
  PaginationFooter,
  TableSearchInput,
  TableSkeleton
} from '@polaris/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HiddenInput } from '@/components/hidden-input';
import type { FileRow } from '@/lib/types';

type AddAction = (formData: FormData) => void | Promise<void>;

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type FetchState = {
  rows: FileRow[];
  total: number;
  loading: boolean;
  error: string | null;
};

// Server-driven picker for ADDING library files to an existing data room.
// Files already in the room are shown disabled with a "포함됨" badge. Submits
// the selection as `fileIds` to addFilesToCollectionAction.
export function CollectionFilePicker({
  collectionId,
  action,
  existingFileIds
}: {
  collectionId: string;
  action: AddAction;
  existingFileIds: string[];
}) {
  const existingIds = useMemo(() => new Set(existingFileIds), [existingFileIds]);
  const [draftQuery, setDraftQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState<FetchState>({ rows: [], total: 0, loading: true, error: null });
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
      for (const file of state.rows) {
        if (!existingIds.has(file.id)) next.set(file.id, file);
      }
      return next;
    });
  }, [state.rows, existingIds]);

  const clearSelection = useCallback(() => setSelectedMap(new Map()), []);

  const selectedList = Array.from(selectedMap.values());
  const addableVisible = state.rows.filter((file) => !existingIds.has(file.id));

  return (
    <form action={action} className="collection-builder">
      <HiddenInput name="collectionId" value={collectionId} />

      <div className="collection-builder-toolbar">
        <TableSearchInput
          value={draftQuery}
          onValueChange={setDraftQuery}
          placeholder="추가할 파일 검색"
          aria-label="파일 검색"
        />
        <div className="collection-builder-meta-right">
          <Badge variant="primary" tone={selectedMap.size > 0 ? 'solid' : 'subtle'}>
            선택 {selectedMap.size}개
          </Badge>
          <Button type="button" variant="ghost" size="sm" onClick={selectVisible} disabled={addableVisible.length === 0}>
            현재 페이지 모두 선택
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={selectedMap.size === 0}>
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
            appliedQuery ? `"${appliedQuery}"와 일치하는 파일이 없습니다.` : '먼저 콘텐츠 탭에서 PDF를 업로드해주세요.'
          }
        />
      ) : (
        <ul className="collection-builder-list">
          {state.rows.map((file) => {
            const alreadyIn = existingIds.has(file.id);
            const isChecked = alreadyIn || selectedMap.has(file.id);
            return (
              <li key={file.id} className={`collection-builder-row${isChecked ? ' selected' : ''}`}>
                <label className="collection-builder-row-label">
                  <Checkbox
                    checked={isChecked}
                    disabled={alreadyIn}
                    onCheckedChange={(c) => toggleFile(file, c)}
                  />
                  <FileIcon type="pdf" size={20} />
                  <span className="collection-builder-row-name">{file.original_name}</span>
                  {alreadyIn ? (
                    <Badge variant="neutral" tone="subtle">
                      포함됨
                    </Badge>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {state.total > PAGE_SIZE ? (
        <PaginationFooter page={page} total={state.total} pageSize={PAGE_SIZE} showPageSize={false} onPageChange={setPage} />
      ) : null}

      {selectedList.map((file) => (
        <HiddenInput key={file.id} name="fileIds" value={file.id} />
      ))}

      <Button type="submit" disabled={selectedMap.size === 0}>
        데이터룸에 추가{selectedMap.size > 0 ? ` (${selectedMap.size}개)` : ''}
      </Button>
    </form>
  );
}
