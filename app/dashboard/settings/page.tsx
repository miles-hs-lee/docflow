import { Alert, AlertDescription, AlertTitle, Button, Card, Input } from '@polaris/ui';

import { Flash } from '@/components/flash';
import { requireOwner } from '@/lib/auth';

type SettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const params = await searchParams;
  const { user } = await requireOwner();

  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <Card className="panel" variant="padded">
        <h2>계정 정보</h2>
        <p className="muted">현재 로그인된 계정: <strong>{user.email}</strong></p>
      </Card>

      <Card className="panel" variant="padded">
        <h2>계정 삭제</h2>
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
          <Button type="submit" variant="danger">
            계정과 모든 데이터 영구 삭제
          </Button>
        </form>
      </Card>
    </section>
  );
}
