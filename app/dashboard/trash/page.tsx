import { Button, Card, EmptyState, Input } from '@polaris/ui';
import Link from 'next/link';

import { Flash } from '@/components/flash';
import { HiddenInput } from '@/components/hidden-input';
import { hardDeleteLinkAction, restoreLinkAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listTrashLinks } from '@/lib/data';
import { formatDateTime } from '@/lib/format';

type TrashPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TrashPage({ searchParams }: TrashPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();
  const links = await listTrashLinks(supabase);

  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <Card className="panel" variant="padded">
        <div className="between">
          <div className="stack-sm">
            <h2>휴지통 링크</h2>
            <p className="muted">소프트 삭제된 링크는 여기서 복구하거나 영구 삭제할 수 있습니다.</p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard">파일 목록</Link>
          </Button>
        </div>

        {links.length === 0 ? (
          <EmptyState title="휴지통이 비어 있습니다" description="삭제한 공유 링크가 이곳에 표시됩니다." />
        ) : (
          <div className="stack-md">
            {links.map((link) => (
              <Card key={link.id} className="trash-item" variant="padded">
                <div className="stack-sm">
                  <p>
                    <strong>{link.label}</strong>
                  </p>
                  <p className="muted">
                    대상: {link.collection ? `문서 묶음 - ${link.collection.name}` : link.file?.original_name ?? link.file_id} | 삭제일:{' '}
                    {formatDateTime(link.deleted_at)}
                  </p>
                </div>

                <div className="row-actions">
                  <form action={restoreLinkAction}>
                    <HiddenInput name="linkId" value={link.id} />
                    <Button type="submit">복구</Button>
                  </form>

                  <form action={hardDeleteLinkAction} className="inline-form">
                    <HiddenInput name="linkId" value={link.id} />
                    <Input name="confirmation" label="확인 문구" placeholder="DELETE" required containerClassName="hard-delete-field" />
                    <Button type="submit" variant="danger">
                      영구 삭제
                    </Button>
                  </form>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
