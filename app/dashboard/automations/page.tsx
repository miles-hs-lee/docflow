import { Badge, Button, Card, Checkbox, EmptyState, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@polaris/ui';
import { NovaLogo } from '@polaris/ui/logos';
import { cookies } from 'next/headers';

import { Flash } from '@/components/flash';
import { HiddenInput } from '@/components/hidden-input';
import {
  createAutomationSubscriptionAction,
  createMcpApiKeyAction,
  deleteAutomationSubscriptionAction,
  revokeMcpApiKeyAction,
  toggleAutomationSubscriptionAction
} from '@/lib/actions/owner';
import { requireOwner } from '@/lib/auth';
import { listAutomationSubscriptions, listMcpApiKeys } from '@/lib/data';
import { formatDateTime } from '@/lib/format';
import { MCP_NEW_KEY_COOKIE } from '@/lib/mcp-key-cookie';

type AutomationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const scopeOptions = [
  { value: 'files:read', label: 'files:read' },
  { value: 'files:write', label: 'files:write' },
  { value: 'links:read', label: 'links:read' },
  { value: 'links:write', label: 'links:write' },
  { value: 'analytics:read', label: 'analytics:read' },
  { value: 'automations:read', label: 'automations:read' },
  { value: 'automations:write', label: 'automations:write' }
];

const eventTypeOptions = [
  { value: 'view', label: '열람 성공(view)' },
  { value: 'download', label: '다운로드(download)' },
  { value: 'denied', label: '접근 거부(denied)' },
  { value: 'email_submitted', label: '이메일 제출(email_submitted)' },
  { value: 'password_failed', label: '비밀번호 실패(password_failed)' }
];

export default async function AutomationsPage({ searchParams }: AutomationsPageProps) {
  const params = await searchParams;
  const { supabase } = await requireOwner();
  const [apiKeys, subscriptions] = await Promise.all([
    listMcpApiKeys(supabase),
    listAutomationSubscriptions(supabase)
  ]);

  const success = typeof params.success === 'string' ? decodeURIComponent(params.success) : undefined;
  const error = typeof params.error === 'string' ? decodeURIComponent(params.error) : undefined;
  // Read once from the short-lived HttpOnly flash cookie. Cookie auto-expires
  // after 120s; we cannot clear it here (server component), and clearing in a
  // route handler would race with the redirect — the short TTL is the safety net.
  const cookieStore = await cookies();
  const newKey = cookieStore.get(MCP_NEW_KEY_COOKIE)?.value ?? null;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      <Card className="panel automations-hero" variant="padded">
        <div className="between">
          <div className="stack-sm">
            <Badge variant="secondary" tone="subtle">NOVA · AI Automation</Badge>
            <h1>자동화 &amp; MCP</h1>
            <p className="muted">DocFlow의 문서 이벤트와 운영 작업을 AI Agent와 MCP 클라이언트에 연결합니다.</p>
          </div>
          <NovaLogo size={56} aria-hidden />
        </div>
      </Card>

      {newKey ? (
        <Card className="panel" variant="padded">
          <Badge variant="warning" tone="subtle">한 번만 표시</Badge>
          <h2>새 MCP API 키</h2>
          <p className="muted">아래 키는 지금 한 번만 표시됩니다. 복사해서 안전한 비밀 저장소에 보관하세요.</p>
          <pre className="mono-wrap">{newKey}</pre>
        </Card>
      ) : null}

      <Card className="panel" variant="padded">
        <h2>MCP API 키 생성</h2>
        <p className="muted">AI Agent는 이 키를 사용해 `/api/mcp`를 호출합니다.</p>
        <form action={createMcpApiKeyAction} className="form-grid">
          <Input name="label" required label="키 이름" placeholder="예: CRM Agent Production" />
          <fieldset className="form-fieldset">
            <legend>권한 스코프</legend>
            <div className="check-grid">
              {scopeOptions.map((scope) => (
                <Checkbox key={scope.value} name="scopes" value={scope.value} defaultChecked label={<span className="mono">{scope.label}</span>} containerClassName="check-item" />
              ))}
            </div>
          </fieldset>
          <Button type="submit">API 키 생성</Button>
        </form>
      </Card>

      <Card className="panel" variant="padded">
        <h2>API 키 목록</h2>
        {apiKeys.length === 0 ? (
          <EmptyState title="생성된 API 키가 없습니다" description="AI Agent 연동을 시작하려면 MCP API 키를 생성하세요." />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>스코프</TableHead>
                <TableHead>최근 사용</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell>{key.label}</TableCell>
                  <TableCell className="mono">{key.key_prefix}</TableCell>
                  <TableCell className="mono">{key.scopes.join(', ')}</TableCell>
                  <TableCell>{formatDateTime(key.last_used_at)}</TableCell>
                  <TableCell>
                    <Badge variant={key.revoked_at ? 'neutral' : 'success'} tone="subtle">
                      {key.revoked_at ? '비활성' : '활성'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {key.revoked_at ? (
                      <span className="muted small">-</span>
                    ) : (
                      <form action={revokeMcpApiKeyAction}>
                        <HiddenInput name="keyId" value={key.id} />
                        <Button type="submit" variant="danger" size="sm">
                          비활성화
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="panel" variant="padded">
        <h2>이벤트 자동화 구독</h2>
        <p className="muted">지정한 이벤트가 발생하면 웹훅으로 payload를 전달합니다.</p>
        <form action={createAutomationSubscriptionAction} className="form-grid">
          <Input name="name" required label="구독 이름" placeholder="예: 영업팀 Slack 알림" />
          <Input type="url" name="webhookUrl" required label="Webhook URL" placeholder="https://example.com/webhooks/docflow" />
          <Input name="signingSecret" label="서명 시크릿 (선택)" placeholder="HMAC 검증용 비밀값" />
          <Checkbox name="isActive" defaultChecked label="즉시 활성화" containerClassName="check-inline" />
          <fieldset className="form-fieldset">
            <legend>구독 이벤트</legend>
            <div className="check-grid">
              {eventTypeOptions.map((eventType) => (
                <Checkbox key={eventType.value} name="eventTypes" value={eventType.value} defaultChecked label={eventType.label} containerClassName="check-item" />
              ))}
            </div>
          </fieldset>
          <Button type="submit">구독 추가</Button>
        </form>
      </Card>

      <Card className="panel" variant="padded">
        <h2>구독 목록</h2>
        {subscriptions.length === 0 ? (
          <EmptyState title="등록된 구독이 없습니다" description="열람, 다운로드, 거부 등 문서 이벤트를 외부 도구로 전달할 수 있습니다." />
        ) : (
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>Webhook</TableHead>
                <TableHead>이벤트</TableHead>
                <TableHead>최근 전달</TableHead>
                <TableHead>최근 오류</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.map((subscription) => (
                <TableRow key={subscription.id}>
                  <TableCell>{subscription.name}</TableCell>
                  <TableCell className="mono">{subscription.webhook_url}</TableCell>
                  <TableCell className="mono">{subscription.event_types.join(', ')}</TableCell>
                  <TableCell>{formatDateTime(subscription.last_delivery_at)}</TableCell>
                  <TableCell>{subscription.last_error ?? '-'}</TableCell>
                  <TableCell>
                    <Badge variant={subscription.is_active ? 'success' : 'warning'} tone="subtle">
                      {subscription.is_active ? '활성' : '비활성'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="row-actions">
                      <form action={toggleAutomationSubscriptionAction}>
                        <HiddenInput name="subscriptionId" value={subscription.id} />
                        <HiddenInput name="nextValue" value={subscription.is_active ? 'false' : 'true'} />
                        <Button type="submit" variant="secondary" size="sm">
                          {subscription.is_active ? '비활성화' : '활성화'}
                        </Button>
                      </form>
                      <form action={deleteAutomationSubscriptionAction}>
                        <HiddenInput name="subscriptionId" value={subscription.id} />
                        <Button type="submit" variant="danger" size="sm">
                          삭제
                        </Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </section>
  );
}
