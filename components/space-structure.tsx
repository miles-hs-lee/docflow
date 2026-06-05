import { Button, FileIcon, Input } from '@polaris/ui';

import { HiddenInput } from '@/components/hidden-input';
import {
  createFolderAction,
  deleteFolderAction,
  moveFileToFolderAction,
  renameFolderAction
} from '@/lib/actions/owner';
import type { FolderRow, SpaceFile } from '@/lib/types';

type SpaceStructureProps = {
  collectionId: string;
  folders: FolderRow[];
  files: SpaceFile[];
};

// Owner-side space (data room) structure editor: a folder tree with create /
// rename / delete folder and move-file-to-folder. Server-component forms post
// to the folder actions; native <select> posts the move target.
export function SpaceStructure({ collectionId, folders, files }: SpaceStructureProps) {
  const childFolders = (parentId: string | null) =>
    folders.filter((folder) => (folder.parent_folder_id ?? null) === parentId);
  const folderFiles = (folderId: string | null) =>
    files.filter((file) => (file.folder_id ?? null) === folderId);

  const renderFile = (file: SpaceFile) => (
    <div key={file.id} className="space-node space-file">
      <span className="space-node-label">
        <FileIcon type="pdf" size={18} />
        <span className="space-node-name">{file.original_name}</span>
      </span>
      <form action={moveFileToFolderAction} className="space-row-actions">
        <HiddenInput name="collectionId" value={collectionId} />
        <HiddenInput name="fileId" value={file.id} />
        <select
          name="folderId"
          defaultValue={file.folder_id ?? 'root'}
          aria-label="폴더로 이동"
          className="space-select"
        >
          <option value="root">최상위</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="ghost">
          이동
        </Button>
      </form>
    </div>
  );

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
        {folderFiles(folder.id).map(renderFile)}
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
        {folderFiles(null).map(renderFile)}
      </div>
    </div>
  );
}
