import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  CopyButton,
  EmptyState,
  Input,
  PageHeader,
  Stack,
  Textarea
} from '@polaris/ui';
import Link from 'next/link';

import { ExpiryDateField } from '@/components/expiry-date-field';
import { HiddenInput } from '@/components/hidden-input';
import { LocalDate } from '@/components/local-date';
import { createFileRequestAction, deleteFileRequestAction, toggleFileRequestAction } from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listFileRequests } from '@/lib/data';
import { publicEnv } from '@/lib/env-public';

export default async function FileRequestsPage() {
  const { supabase } = await requireOwner();
  const requests = await listFileRequests(supabase);
  const appOrigin = publicEnv.appUrl;

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          title="파일 요청"
          description="외부 방문자가 파일을 업로드할 수 있는 요청 링크를 만들고, 받은 파일을 관리하세요."
        />

        <Card>
          <CardHeader>
            <CardTitle>새 파일 요청</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">요청 링크를 공유하면 외부 사용자가 파일을 업로드할 수 있습니다. 업로드되면 자동화 구독으로 알림을 받을 수 있습니다.</p>
            <form action={createFileRequestAction} className="form-grid">
              <Input name="title" required label="요청 제목" placeholder="예: 계약서 사본을 보내주세요" />
              <Textarea name="instructions" label="안내 문구 (선택)" placeholder="업로드할 파일에 대한 안내를 적어주세요" rows={3} />
              <ExpiryDateField name="expiresAt" />
              <Input type="number" name="maxUploads" min={1} label="최대 업로드 수 (선택)" placeholder="미설정" />
              <div className="check-grid">
                <Checkbox name="isActive" defaultChecked label="활성" containerClassName="check-item" />
                <Checkbox name="requireEmail" label="이메일 요구" containerClassName="check-item" />
              </div>
              <Button type="submit">요청 생성</Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>요청 목록</CardTitle>
          </CardHeader>
          <CardBody>
            {requests.length === 0 ? (
              <EmptyState title="아직 파일 요청이 없습니다" description="위에서 첫 요청을 만들어 보세요." />
            ) : (
              <Stack gap={3}>
                {requests.map((req) => {
                  const url = `${appOrigin}/r/${req.token}`;
                  const expired = req.expires_at ? new Date(req.expires_at) < new Date() : false;
                  const status = !req.is_active ? '비활성' : expired ? '만료' : '활성';
                  const statusVar = !req.is_active ? 'secondary' : expired ? 'warning' : 'success';

                  return (
                    <Card key={req.id} variant="padded" className="link-card compact">
                      <div className="link-card-head">
                        <div className="link-card-title">
                          <strong>{req.title}</strong>
                          <p className="mono">{url}</p>
                        </div>
                        <Stack direction="row" align="center" gap={2} wrap>
                          <Badge variant={statusVar} tone="subtle">
                            {status}
                          </Badge>
                          <CopyButton text={url} size="sm" variant="secondary" />
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/dashboard/requests/${req.id}`}>받은 파일 {req.upload_count}</Link>
                          </Button>
                          <form action={toggleFileRequestAction}>
                            <HiddenInput name="requestId" value={req.id} />
                            <Button type="submit" variant="secondary" size="sm">
                              {req.is_active ? '비활성화' : '활성화'}
                            </Button>
                          </form>
                          <form action={deleteFileRequestAction}>
                            <HiddenInput name="requestId" value={req.id} />
                            <Button type="submit" variant="danger" size="sm">
                              삭제
                            </Button>
                          </form>
                        </Stack>
                      </div>
                      <p className="muted small">
                        생성일 <LocalDate value={req.created_at} mode="date" />
                        {req.max_uploads !== null ? ` · 한도 ${req.upload_count}/${req.max_uploads}` : ''}
                        {req.require_email ? ' · 이메일 필요' : ''}
                      </p>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
