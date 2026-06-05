import type { FolderRow, SpaceFile } from '@/lib/types';

type SpaceViewerNavProps = {
  token: string;
  folders: FolderRow[];
  files: SpaceFile[];
  activeFileId: string;
};

// Viewer-side folder tree for a space (collection) link. Collapsible folders
// (open by default) with file links; root files render at the top level.
// File links keep the existing ?fileId= switch so the per-file fetch / claim /
// page-event flow is unchanged.
export function SpaceViewerNav({ token, folders, files, activeFileId }: SpaceViewerNavProps) {
  const folderIds = new Set(folders.map((folder) => folder.id));
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
      href={`/v/${token}?fileId=${encodeURIComponent(file.id)}`}
      className={`viewer-file-link${file.id === activeFileId ? ' active' : ''}`}
    >
      {file.original_name}
    </a>
  );

  const renderFolder = (folder: FolderRow) => (
    <details key={folder.id} className="viewer-folder" open>
      <summary className="viewer-folder-label">{folder.name}</summary>
      <div className="viewer-folder-children">
        {folderFiles(folder.id).map(fileLink)}
        {childFolders(folder.id).map(renderFolder)}
      </div>
    </details>
  );

  return (
    <nav className="viewer-tree">
      {childFolders(null).map(renderFolder)}
      {folderFiles(null).map(fileLink)}
    </nav>
  );
}
