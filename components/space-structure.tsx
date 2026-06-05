import { Button, FileIcon, Input } from '@polaris/ui';

import { HiddenInput } from '@/components/hidden-input';
import { SpaceFileList } from '@/components/space-file-list';
import { createFolderAction, deleteFolderAction, renameFolderAction } from '@/lib/actions/owner';
import type { FolderRow, SpaceFile } from '@/lib/types';

type SpaceStructureProps = {
  collectionId: string;
  folders: FolderRow[];
  files: SpaceFile[];
};

// Owner-side space (data room) structure editor: a folder tree with create /
// rename / delete folder. Each container's files render through the client-side
// <SpaceFileList>, which adds drag-and-drop reorder + move-to-folder + remove.
export function SpaceStructure({ collectionId, folders, files }: SpaceStructureProps) {
  const folderIds = new Set(folders.map((folder) => folder.id));
  // Orphaned / cross-collection parent references fall back to the root so a
  // file or subfolder is never silently dropped from the editor.
  const fileParent = (file: SpaceFile) => (file.folder_id && folderIds.has(file.folder_id) ? file.folder_id : null);
  const folderParent = (folder: FolderRow) =>
    folder.parent_folder_id && folderIds.has(folder.parent_folder_id) ? folder.parent_folder_id : null;
  const childFolders = (parentId: string | null) => folders.filter((folder) => folderParent(folder) === parentId);
  const folderFiles = (folderId: string | null) => files.filter((file) => fileParent(file) === folderId);

  const renderFolder = (folder: FolderRow, depth: number) => (
    <div key={folder.id} className="space-folder">
      <div className="space-node space-folder-head">
        <span className="space-node-label">
          <FileIcon type="folder" size={18} />
          <strong className="space-node-name">{folder.name}</strong>
        </span>
        <details className="space-folder-manage">
          <summary>관리</summary>
          <div className="space-manage-forms">
            <form action={renameFolderAction} className="space-row-actions">
              <HiddenInput name="folderId" value={folder.id} />
              <HiddenInput name="collectionId" value={collectionId} />
              <Input name="name" defaultValue={folder.name} aria-label="폴더 이름" />
              <Button type="submit" size="sm" variant="secondary">
                이름변경
              </Button>
            </form>
            <form action={createFolderAction} className="space-row-actions">
              <HiddenInput name="collectionId" value={collectionId} />
              <HiddenInput name="parentFolderId" value={folder.id} />
              <Input name="name" placeholder="하위 폴더 이름" aria-label="하위 폴더 이름" />
              <Button type="submit" size="sm" variant="secondary">
                + 하위 폴더
              </Button>
            </form>
            <form action={deleteFolderAction} className="space-row-actions">
              <HiddenInput name="folderId" value={folder.id} />
              <HiddenInput name="collectionId" value={collectionId} />
              <Button type="submit" size="sm" variant="danger">
                폴더 삭제
              </Button>
            </form>
          </div>
        </details>
      </div>
      <div className="space-folder-children">
        <SpaceFileList
          collectionId={collectionId}
          folderId={folder.id}
          files={folderFiles(folder.id)}
          folders={folders}
        />
        {childFolders(folder.id).map((sub) => renderFolder(sub, depth + 1))}
      </div>
    </div>
  );

  return (
    <div className="space-structure">
      <form action={createFolderAction} className="space-row-actions space-new-folder">
        <HiddenInput name="collectionId" value={collectionId} />
        <Input name="name" placeholder="새 폴더 이름" aria-label="새 폴더 이름" />
        <Button type="submit" size="sm">
          새 폴더
        </Button>
      </form>

      <div className="space-tree">
        {childFolders(null).map((folder) => renderFolder(folder, 0))}
        <SpaceFileList collectionId={collectionId} folderId={null} files={folderFiles(null)} folders={folders} />
      </div>
    </div>
  );
}
