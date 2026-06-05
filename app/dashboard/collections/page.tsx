import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  FileIcon,
  PageHeader,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@polaris/ui';
import Link from 'next/link';

import { CollectionBuilderLazy } from '@/components/collection-builder-lazy';
import { HiddenInput } from '@/components/hidden-input';
import { createCollectionAction, deleteCollectionAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listCollections } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

export default async function DataRoomsPage() {
  const { supabase } = await requireOwner();
  const collections = await listCollections(supabase);

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          title="데이터룸"
          description="여러 PDF를 폴더 구조의 한 공간으로 묶어 공유하고, 룸 단위로 통계를 봅니다."
        />

        <Card className="collapsible">
          <CollectionBuilderLazy createCollectionAction={createCollectionAction} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>데이터룸 목록</CardTitle>
          </CardHeader>
          <CardBody>
            {collections.length === 0 ? (
              <EmptyState
                title="생성된 데이터룸이 없습니다"
                description="여러 PDF를 하나의 공유 경험으로 묶을 수 있습니다."
              />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>데이터룸명</TableHead>
                    <TableHead>포함 문서 수</TableHead>
                    <TableHead>생성일</TableHead>
                    <TableHead>작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {collections.map((collection) => (
                    <TableRow key={collection.id}>
                      <TableCell>
                        <Stack direction="row" asChild align="center" gap={2}>
                          <span>
                            <FileIcon type="folder" size={24} />
                            <strong>{collection.name}</strong>
                          </span>
                        </Stack>
                      </TableCell>
                      <TableCell>{collection.file_count}</TableCell>
                      <TableCell>{formatDateTime(collection.created_at)}</TableCell>
                      <TableCell>
                        <Stack direction="row" align="center" gap={2} wrap>
                          <Button asChild variant="secondary" size="sm">
                            <Link href={`/dashboard/collections/${collection.id}`}>관리</Link>
                          </Button>
                          <form action={deleteCollectionAction}>
                            <HiddenInput name="collectionId" value={collection.id} />
                            <Button type="submit" variant="danger" size="sm">
                              데이터룸 삭제
                            </Button>
                          </form>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
