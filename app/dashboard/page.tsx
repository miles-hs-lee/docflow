import Link from 'next/link';

import { Flash } from '@/components/flash';
import { createCollectionAction, deleteCollectionAction, deleteFileAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listCollections, listFiles } from '@/lib/data';
import { formatBytes, formatDateTime } from '@/lib/format';

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();
  const [files, collections] = await Promise.all([listFiles(supabase), listCollections(supabase)]);

  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <article className="panel">
        <h2>PDF 업로드</h2>
        <p className="muted">PDF 파일만 허용됩니다. 업로드 후 파일별로 여러 공유 링크를 만들 수 있습니다.</p>
        <form action="/dashboard/upload" method="post" className="inline-form" encType="multipart/form-data">
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

      <article className="panel">
        <h2>문서 묶음 생성</h2>
        <p className="muted">여러 문서를 하나의 링크로 공유할 수 있는 묶음을 만듭니다.</p>
        {files.length < 2 ? (
          <p className="muted small">문서 묶음을 만들려면 파일 2개 이상이 필요합니다.</p>
        ) : (
          <form action={createCollectionAction} className="form-grid">
            <label>
              묶음 이름
              <input name="name" required placeholder="예: 2026 제안서 세트" />
            </label>
            <label>
              설명 (선택)
              <input name="description" placeholder="외부 공유용 기본 자료 묶음" />
            </label>
            <div className="collection-file-picker">
              {files.map((file) => (
                <label key={file.id} className="check-item">
                  <input type="checkbox" name="fileIds" value={file.id} />
                  <span>{file.original_name}</span>
                </label>
              ))}
            </div>
            <button type="submit" className="button button-primary">
              문서 묶음 생성
            </button>
          </form>
        )}
      </article>

      <article className="panel">
        <h2>문서 묶음 목록</h2>
        {collections.length === 0 ? (
          <p className="muted">생성된 문서 묶음이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>묶음명</th>
                  <th>포함 문서 수</th>
                  <th>생성일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {collections.map((collection) => (
                  <tr key={collection.id}>
                    <td>{collection.name}</td>
                    <td>{collection.file_count}</td>
                    <td>{formatDateTime(collection.created_at)}</td>
                    <td>
                      <div className="row-actions">
                        <Link href={`/dashboard/collections/${collection.id}`} className="button button-ghost">
                          링크 관리
                        </Link>
                        <form action={deleteCollectionAction}>
                          <input type="hidden" name="collectionId" value={collection.id} />
                          <button type="submit" className="button button-danger">
                            묶음 삭제
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
