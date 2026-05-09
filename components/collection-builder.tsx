'use client';

import { Badge, Button, Checkbox, EmptyState, FileIcon, Input } from '@polaris/ui';
import { SearchIcon } from '@polaris/ui/icons';
import { useMemo, useState } from 'react';

import type { FileRow } from '@/lib/types';

type CreateAction = (formData: FormData) => void | Promise<void>;

export function CollectionBuilder({
  files,
  createCollectionAction
}: {
  files: FileRow[];
  createCollectionAction: CreateAction;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.original_name.toLowerCase().includes(q));
  }, [files, query]);

  const toggleFile = (id: string, checked: boolean | 'indeterminate') => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked === true) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const f of filtered) next.add(f.id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  if (files.length < 2) {
    return (
      <EmptyState
        title="파일 2개 이상이 필요합니다"
        description="문서 묶음을 만들려면 PDF를 하나 더 업로드해주세요."
      />
    );
  }

  const selectedList = files.filter((f) => selected.has(f.id));

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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="묶음에 추가할 파일 검색"
            aria-label="파일 검색"
            className="file-browser-search-input"
          />
        </div>
        <div className="collection-builder-meta-right">
          <Badge variant="primary" tone={selected.size > 0 ? 'solid' : 'subtle'}>
            선택 {selected.size}개
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectFiltered}
            disabled={filtered.length === 0}
          >
            검색 결과 모두 선택
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSelection}
            disabled={selected.size === 0}
          >
            선택 해제
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="검색 결과가 없습니다"
          description={`"${query}"와 일치하는 파일이 없습니다.`}
        />
      ) : (
        <ul className="collection-builder-list">
          {filtered.map((file) => {
            const isChecked = selected.has(file.id);
            return (
              <li key={file.id} className={`collection-builder-row${isChecked ? ' selected' : ''}`}>
                <label className="collection-builder-row-label">
                  <Checkbox
                    name="fileIds"
                    value={file.id}
                    checked={isChecked}
                    onCheckedChange={(c) => toggleFile(file.id, c)}
                  />
                  <FileIcon type="pdf" size={20} />
                  <span className="collection-builder-row-name">{file.original_name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

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

      <Button type="submit" disabled={selected.size < 2}>
        문서 묶음 생성{selected.size >= 2 ? ` (${selected.size}개)` : ''}
      </Button>
    </form>
  );
}
