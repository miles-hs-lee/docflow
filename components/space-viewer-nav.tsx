'use client';

import { useMemo, useState } from 'react';

import { buildDdIndex } from '@/lib/dd-index';
import type { FolderRow, SpaceFile } from '@/lib/types';

type SpaceViewerNavProps = {
  token: string;
  folders: FolderRow[];
  files: SpaceFile[];
  activeFileId: string;
  // Extra query string (no leading '?') appended to every file link — carries
  // the owner-preview token across file switches so preview mode survives
  // data-room navigation.
  extraQuery?: string | null;
};

// Viewer-side folder tree for a space (collection) link. Collapsible folders
// (open by default) with file links; root files render at the top level.
// Adds the two things recipients of a real data room expect:
//   - DD index numbers (1, 1.1, …) matching the visible order, and
//   - a name filter, because a 40-document room is unscannable without one.
// File links keep the existing ?fileId= switch so the per-file fetch / claim /
// page-event flow is unchanged.
export function SpaceViewerNav({ token, folders, files, activeFileId, extraQuery }: SpaceViewerNavProps) {
  const [query, setQuery] = useState('');

  const ddIndex = useMemo(() => buildDdIndex(folders, files), [folders, files]);

  const folderIds = useMemo(() => new Set(folders.map((folder) => folder.id)), [folders]);
  // A file/folder whose parent reference points at a folder not in this set
  // (orphaned / cross-collection) falls back to the root, so it is never
  // silently dropped from the tree.
  const fileParent = (file: SpaceFile) => (file.folder_id && folderIds.has(file.folder_id) ? file.folder_id : null);
  const folderParent = (folder: FolderRow) =>
    folder.parent_folder_id && folderIds.has(folder.parent_folder_id) ? folder.parent_folder_id : null;
  const childFolders = (parentId: string | null) => folders.filter((folder) => folderParent(folder) === parentId);
  const folderFiles = (folderId: string | null) => files.filter((file) => fileParent(file) === folderId);

  const fileLink = (file: SpaceFile) => (
    <a
      key={file.id}
      href={`/v/${token}?fileId=${encodeURIComponent(file.id)}${extraQuery ? `&${extraQuery}` : ''}`}
      className={`viewer-file-link${file.id === activeFileId ? ' active' : ''}`}
    >
      <span className="viewer-dd-number">{ddIndex.fileNumbers.get(file.id)}</span>
      {file.original_name}
    </a>
  );

  const renderFolder = (folder: FolderRow) => (
    <details key={folder.id} className="viewer-folder" open>
      <summary className="viewer-folder-label">
        <span className="viewer-dd-number">{ddIndex.folderNumbers.get(folder.id)}</span>
        {folder.name}
      </summary>
      <div className="viewer-folder-children">
        {folderFiles(folder.id).map(fileLink)}
        {childFolders(folder.id).map(renderFolder)}
      </div>
    </details>
  );

  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery
    ? files.filter((file) => file.original_name.toLowerCase().includes(normalizedQuery))
    : null;

  return (
    <nav className="viewer-tree">
      {files.length > 5 ? (
        <input
          type="search"
          className="viewer-tree-search"
          placeholder="문서 검색"
          aria-label="문서 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {matches ? (
        matches.length === 0 ? (
          <p className="viewer-tree-empty">‘{query.trim()}’와 일치하는 문서가 없습니다.</p>
        ) : (
          matches.map(fileLink)
        )
      ) : (
        <>
          {childFolders(null).map(renderFolder)}
          {folderFiles(null).map(fileLink)}
        </>
      )}
    </nav>
  );
}
