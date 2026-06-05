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
  const childFolders = (parentId: string | null) =>
    folders.filter((folder) => (folder.parent_folder_id ?? null) === parentId);
  const folderFiles = (folderId: string | null) =>
    files.filter((file) => (file.folder_id ?? null) === folderId);

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
