import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  PageHeader,
  Stack
} from '@polaris/ui';
import { ChevronLeftIcon } from '@polaris/ui/icons';
import Link from 'next/link';

import { HiddenInput } from '@/components/hidden-input';
import { hardDeleteLinkAction, restoreLinkAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listTrashLinks } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

export default async function TrashPage() {
  const { supabase } = await requireOwner();
  const links = await listTrashLinks(supabase);

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          title="휴지통"
          description="소프트 삭제된 링크는 여기서 복구하거나 영구 삭제할 수 있습니다."
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard">
                <ChevronLeftIcon size={14} aria-hidden />
                파일 목록
              </Link>
            </Button>
          }
        />
        <Card>
          <CardBody>
            {links.length === 0 ? (
              <EmptyState
                title="휴지통이 비어 있습니다"
                description="삭제한 공유 링크가 이곳에 표시됩니다."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/dashboard">파일 목록으로</Link>
                  </Button>
                }
              />
            ) : (
              <Stack gap={4}>
                {links.map((link) => (
                  <Card key={link.id} className="trash-item" variant="padded">
                    <Stack gap={3}>
                      <p>
                        <strong>{link.label}</strong>
                      </p>
                      <p className="muted">
                        대상:{' '}
                        {link.collection
                          ? `데이터룸 - ${link.collection.name}`
                          : link.file?.original_name ?? link.file_id}{' '}
                        | 삭제일: {formatDateTime(link.deleted_at)}
                      </p>
                    </Stack>

                    <Stack direction="row" align="center" gap={2} wrap>
                      <form action={restoreLinkAction}>
                        <HiddenInput name="linkId" value={link.id} />
                        <Button type="submit">복구</Button>
                      </form>

                      <form action={hardDeleteLinkAction} className="inline-form">
                        <HiddenInput name="linkId" value={link.id} />
                        <Input
                          name="confirmation"
                          label="확인 문구"
                          placeholder="DELETE"
                          required
                          containerClassName="hard-delete-field"
                        />
                        <Button type="submit" variant="danger">
                          영구 삭제
                        </Button>
                      </form>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
