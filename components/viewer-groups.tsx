import { Button, Card, Checkbox, Input, Stack } from '@polaris/ui';

import { HiddenInput } from '@/components/hidden-input';
import {
  createViewerGroupAction,
  deleteViewerGroupAction,
  renameViewerGroupAction,
  setViewerGroupFoldersAction
} from '@/lib/actions/owner';
import type { FolderRow, ViewerGroupWithFolders } from '@/lib/types';

type ViewerGroupsProps = {
  collectionId: string;
  folders: FolderRow[];
  groups: ViewerGroupWithFolders[];
};

// Flatten the folder tree into render order (parent before children) with a
// display depth. An orphaned parent reference falls back to the root, matching
// how the viewer renders the tree.
function orderFolders(folders: FolderRow[]): Array<{ folder: FolderRow; depth: number }> {
  const ids = new Set(folders.map((folder) => folder.id));
  const byParent = new Map<string | null, FolderRow[]>();
  for (const folder of folders) {
    const key = folder.parent_folder_id && ids.has(folder.parent_folder_id) ? folder.parent_folder_id : null;
    const list = byParent.get(key) ?? [];
    list.push(folder);
    byParent.set(key, list);
  }

  const out: Array<{ folder: FolderRow; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// Owner-side viewer-group editor: create/rename/delete groups and toggle which
// folders each group exposes (+ whether root files are included). Server-component
// forms post to the group actions. A link is later assigned to a group in the
// link create/edit form; that link then shows viewers only the group's folders.
export function ViewerGroups({ collectionId, folders, groups }: ViewerGroupsProps) {
  const ordered = orderFolders(folders);

  return (
    <Stack gap={4}>
      <p className="muted">
        뷰어 그룹은 데이터룸의 일부 폴더만 공개하는 권한 묶음입니다. 그룹에 폴더를 지정한 뒤 아래
        “데이터룸 링크 생성”에서 링크를 그룹에 연결하면, 그 링크로 들어온 방문자는 지정한 폴더만 보게 됩니다.
        폴더를 선택하면 하위 폴더도 함께 공개됩니다.
      </p>

      <form action={createViewerGroupAction} className="space-row-actions space-new-folder">
        <HiddenInput name="collectionId" value={collectionId} />
        <Input name="name" placeholder="새 그룹 이름 (예: 투자자)" aria-label="새 그룹 이름" />
        <Button type="submit" size="sm">
          그룹 추가
        </Button>
      </form>

      {groups.length > 0 ? (
        <Stack gap={3}>
          {groups.map((group) => (
            <Card key={group.id} variant="padded" className="viewer-group-card">
              <div className="link-card-head">
                <form action={renameViewerGroupAction} className="space-row-actions">
                  <HiddenInput name="groupId" value={group.id} />
                  <HiddenInput name="collectionId" value={collectionId} />
                  <Input name="name" defaultValue={group.name} aria-label="그룹 이름" />
                  <Button type="submit" size="sm" variant="secondary">
                    이름변경
                  </Button>
                </form>
                <form action={deleteViewerGroupAction}>
                  <HiddenInput name="groupId" value={group.id} />
                  <HiddenInput name="collectionId" value={collectionId} />
                  <Button type="submit" size="sm" variant="danger">
                    그룹 삭제
                  </Button>
                </form>
              </div>

              <form action={setViewerGroupFoldersAction}>
                <HiddenInput name="groupId" value={group.id} />
                <HiddenInput name="collectionId" value={collectionId} />
                {ordered.length === 0 ? (
                  <p className="muted small">폴더를 먼저 만들면 그룹에 폴더 권한을 부여할 수 있습니다.</p>
                ) : (
                  <div className="check-grid">
                    {ordered.map(({ folder, depth }) => (
                      <Checkbox
                        key={folder.id}
                        name="folderIds"
                        value={folder.id}
                        defaultChecked={group.folder_ids.includes(folder.id)}
                        label={`${'  '.repeat(depth)}${depth > 0 ? '└ ' : ''}${folder.name}`}
                        containerClassName="check-item"
                      />
                    ))}
                  </div>
                )}
                <Stack direction="row" align="center" gap={3} wrap>
                  <Checkbox
                    name="includeRoot"
                    defaultChecked={group.include_root}
                    label="최상위(폴더 밖) 문서도 공개"
                    containerClassName="check-item"
                  />
                  <Button type="submit" size="sm">
                    권한 저장
                  </Button>
                </Stack>
              </form>
            </Card>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
