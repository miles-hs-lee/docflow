import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
  Stack
} from '@polaris/ui';

import { DeleteAccountConfirm } from '@/components/delete-account-confirm';
import { requireOwner } from '@/lib/auth';

export default async function SettingsPage() {
  const { user } = await requireOwner();

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader title="설정" description={user.email ?? '계정 설정'} />
        <Card>
          <CardHeader>
            <CardTitle>계정 정보</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">
              현재 로그인된 계정: <strong>{user.email}</strong>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>계정 삭제</CardTitle>
          </CardHeader>
          <CardBody>
            <Alert variant="danger">
              <AlertTitle>되돌릴 수 없는 작업입니다</AlertTitle>
              <AlertDescription>
                계정과 함께 업로드한 모든 PDF, 문서 묶음, 공유 링크, 통계, 발급한 MCP API 키와
                자동화 구독이 영구적으로 삭제됩니다. 외부 공유 링크는 즉시 작동을 멈춥니다.
                확인을 위해 비밀번호를 다시 입력하세요.
              </AlertDescription>
            </Alert>
            <form action="/auth/delete-account" method="post" className="form-grid">
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                label="비밀번호 확인"
              />
              <DeleteAccountConfirm />
            </form>
          </CardBody>
        </Card>
      </section>
    </Stack>
  );
}
