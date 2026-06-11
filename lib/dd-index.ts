import type { FolderRow, SpaceFile } from '@/lib/types';

// Due-diligence index numbering (1, 1.1, 1.2, 2 …) over a room's folder tree.
// Mirrors the render order used by SpaceViewerNav / SpaceStructure: within a
// container, subfolders first (in sort order), then files; orphaned parent
// references fall back to the root so nothing is silently unnumbered.
//
// Display-only: numbers are derived from the live tree + sort_order, so
// reordering or moving items renumbers automatically — exactly how DD index
// conventions are expected to behave before a room is frozen.

export type DdIndex = {
  folderNumbers: Map<string, string>;
  fileNumbers: Map<string, string>;
};

export function buildDdIndex(folders: FolderRow[], files: SpaceFile[]): DdIndex {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const fileParent = (file: SpaceFile) => (file.folder_id && folderIds.has(file.folder_id) ? file.folder_id : null);
  const folderParent = (folder: FolderRow) =>
    folder.parent_folder_id && folderIds.has(folder.parent_folder_id) ? folder.parent_folder_id : null;
  const childFolders = (parentId: string | null) => folders.filter((folder) => folderParent(folder) === parentId);
  const folderFiles = (folderId: string | null) => files.filter((file) => fileParent(file) === folderId);

  const folderNumbers = new Map<string, string>();
  const fileNumbers = new Map<string, string>();

  // Numbering must match what the viewer SEES: at the root the tree renders
  // folders first, then loose files; INSIDE a folder it renders the folder's
  // files first, then subfolders. Keep that asymmetry here so the numbers
  // count down the page in visual order.
  const walk = (parentId: string | null, prefix: string) => {
    let counter = 0;
    const number = () => (prefix ? `${prefix}.${counter}` : String(counter));
    const visitFolders = () => {
      for (const folder of childFolders(parentId)) {
        counter += 1;
        const n = number();
        folderNumbers.set(folder.id, n);
        walk(folder.id, n);
      }
    };
    const visitFiles = () => {
      for (const file of folderFiles(parentId)) {
        counter += 1;
        fileNumbers.set(file.id, number());
      }
    };
    if (parentId === null) {
      visitFolders();
      visitFiles();
    } else {
      visitFiles();
      visitFolders();
    }
  };

  walk(null, '');
  return { folderNumbers, fileNumbers };
}
