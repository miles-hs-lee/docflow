import Link from 'next/link';

import { Flash } from '@/components/flash';
import { deleteFileAction, uploadPdfAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listFiles } from '@/lib/data';
import { formatBytes, formatDateTime } from '@/lib/format';

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();
  const files = await listFiles(supabase);

  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <article className="panel">
        <h2>PDF 업로드</h2>
        <p className="muted">PDF 파일만 허용됩니다. 업로드 후 파일별로 여러 공유 링크를 만들 수 있습니다.</p>
        <form action={uploadPdfAction} className="inline-form" encType="multipart/form-data">
          <input type="file" name="pdf" accept="application/pdf,.pdf" required />
          <button type="submit" className="button button-primary">
            업로드
          </button>
        </form>
      </article>

      <article className="panel">
        <h2>내 파일</h2>
        {files.length === 0 ? (
          <p className="muted">업로드된 파일이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>파일명</th>
                  <th>업로드일</th>
                  <th>크기</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>{file.original_name}</td>
                    <td>{formatDateTime(file.created_at)}</td>
                    <td>{formatBytes(file.size_bytes)}</td>
                    <td>
                      <div className="row-actions">
                        <Link href={`/dashboard/files/${file.id}`} className="button button-ghost">
                          링크 관리
                        </Link>
                        <form action={deleteFileAction}>
                          <input type="hidden" name="fileId" value={file.id} />
                          <button type="submit" className="button button-danger">
                            파일 삭제
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}
