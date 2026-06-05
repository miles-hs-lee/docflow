'use client';

import {
  Button,
  FileIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@polaris/ui';
import { ChevronDownIcon, ChevronUpIcon } from '@polaris/ui/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { HiddenInput } from '@/components/hidden-input';
import {
  moveFileToFolderAction,
  removeFileFromCollectionAction,
  reorderCollectionFilesAction
} from '@/lib/actions/owner';
import type { FolderRow, SpaceFile } from '@/lib/types';

type SpaceFileListProps = {
  collectionId: string;
  /** The container these files live in: a folder id, or null for the root. */
  folderId: string | null;
  /** Files of THIS container, already in sort order. */
  files: SpaceFile[];
  /** All folders in the room — the move-to-folder target list. */
  folders: FolderRow[];
};

// Owner-side, reorderable file list for ONE data-room container (root or a
// folder). Reordering is optimistic: drag from the grip handle (or use the ▲▼
// buttons for keyboard/click) updates local order immediately, then persists via
// reorderCollectionFilesAction. The move-to-folder + remove forms post the
// existing server actions unchanged.
export function SpaceFileList({ collectionId, folderId, files, folders }: SpaceFileListProps) {
  const router = useRouter();
  const [items, setItems] = useState<SpaceFile[]>(files);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  // Latest order, readable in the dragEnd handler without stale closures.
  const itemsRef = useRef<SpaceFile[]>(files);
  itemsRef.current = items;
  // Drag may only start from the grip handle, never from the row body / forms.
  const grabbed = useRef(false);

  // Re-sync from the server when the file set/order changes (add, move, remove,
  // or a persisted reorder). The parent is a server component, so `files` keeps
  // a stable reference across client re-renders and only changes on a server
  // re-render — local optimistic drags never trip this.
  useEffect(() => {
    setItems(files);
  }, [files]);

  const persist = (ordered: SpaceFile[]) => {
    const formData = new FormData();
    formData.set('collectionId', collectionId);
    formData.set('folderId', folderId ?? 'root');
    ordered.forEach((file) => formData.append('fileIds', file.id));
    startTransition(async () => {
      await reorderCollectionFilesAction(formData);
      router.refresh();
    });
  };

  const reorder = (from: number, to: number): SpaceFile[] | null => {
    if (to < 0 || to >= items.length || from === to) return null;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setItems(next);
    return next;
  };

  // ▲▼ buttons (accessible / reliable): reorder + persist in one step.
  const nudge = (from: number, to: number) => {
    const next = reorder(from, to);
    if (next) persist(next);
  };

  if (items.length === 0) return null;

  return (
    <ul className="space-file-list">
      {items.map((file, index) => (
        <li
          key={file.id}
          className={`space-node space-file${dragIndex === index ? ' space-file-dragging' : ''}`}
          draggable
          onDragStart={(event) => {
            if (!grabbed.current) {
              // Drag didn't originate from the handle — cancel it so clicks on
              // the move/remove controls keep working.
              event.preventDefault();
              return;
            }
            setDragIndex(index);
          }}
          onDragEnter={() => {
            if (dragIndex === null || dragIndex === index) return;
            if (reorder(dragIndex, index)) setDragIndex(index);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragEnd={() => {
            if (dragIndex !== null) persist(itemsRef.current);
            setDragIndex(null);
            grabbed.current = false;
          }}
        >
          <span
            className="space-drag-handle"
            aria-hidden
            title="드래그하여 순서 변경"
            onPointerDown={() => {
              grabbed.current = true;
            }}
            onPointerUp={() => {
              grabbed.current = false;
            }}
          >
            ⠿
          </span>
          <span className="space-node-label">
            <FileIcon type="pdf" size={18} />
            <span className="space-node-name">{file.original_name}</span>
          </span>
          <div className="space-reorder-buttons">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="위로 이동"
              disabled={index === 0}
              onClick={() => nudge(index, index - 1)}
            >
              <ChevronUpIcon size={14} aria-hidden />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="아래로 이동"
              disabled={index === items.length - 1}
              onClick={() => nudge(index, index + 1)}
            >
              <ChevronDownIcon size={14} aria-hidden />
            </Button>
          </div>
          <form action={moveFileToFolderAction} className="space-row-actions">
            <HiddenInput name="collectionId" value={collectionId} />
            <HiddenInput name="fileId" value={file.id} />
            <Select name="folderId" defaultValue={folderId ?? 'root'}>
              <SelectTrigger aria-label="폴더로 이동" className="space-move-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">최상위</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" variant="ghost">
              이동
            </Button>
          </form>
          <form action={removeFileFromCollectionAction} className="space-row-actions">
            <HiddenInput name="collectionId" value={collectionId} />
            <HiddenInput name="fileId" value={file.id} />
            <Button type="submit" size="sm" variant="danger">
              제거
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
