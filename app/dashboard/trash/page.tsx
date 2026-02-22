import Link from 'next/link';

import { Flash } from '@/components/flash';
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

      <article className="panel">
        <div className="between">
          <h2>휴지통 링크</h2>
          <Link href="/dashboard" className="button button-ghost">
            파일 목록
          </Link>
        </div>

        {links.length === 0 ? (
          <p className="muted">휴지통이 비어 있습니다.</p>
        ) : (
          <div className="stack-md">
            {links.map((link) => (
              <div key={link.id} className="trash-item">
                <div>
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
                    <input type="hidden" name="linkId" value={link.id} />
                    <button type="submit" className="button button-primary">
                      복구
                    </button>
                  </form>

                  <form action={hardDeleteLinkAction} className="inline-form">
                    <input type="hidden" name="linkId" value={link.id} />
                    <input name="confirmation" placeholder="DELETE" required />
                    <button type="submit" className="button button-danger">
                      영구 삭제
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
