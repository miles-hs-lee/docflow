import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  SelectField,
  SelectItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@polaris/ui';
import { NovaLogo } from '@polaris/ui/logos';
import { cookies } from 'next/headers';

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
  { value: 'password_failed', label: '비밀번호 실패(password_failed)' },
  { value: 'agreement', label: 'NDA 동의(agreement)' },
  { value: 'file_uploaded', label: '파일 수신(file_uploaded)' }
];

export default async function AutomationsPage() {
  const { supabase } = await requireOwner();
  const [apiKeys, subscriptions] = await Promise.all([
    listMcpApiKeys(supabase),
    listAutomationSubscriptions(supabase)
  ]);

  // Read once from the short-lived HttpOnly flash cookie. Cookie auto-expires
  // after 120s; we cannot clear it here (server component), and clearing in a
  // route handler would race with the redirect — the short TTL is the safety net.
  const cookieStore = await cookies();
  const newKey = cookieStore.get(MCP_NEW_KEY_COOKIE)?.value ?? null;

  return (
    <Stack asChild gap={5}>
      <section>
        <PageHeader
          eyebrow={<Badge variant="secondary" tone="subtle">NOVA · AI Automation</Badge>}
          title="자동화 & MCP"
          description="DocFlow의 문서 이벤트와 운영 작업을 AI Agent와 MCP 클라이언트에 연결합니다."
          actions={<NovaLogo size={48} aria-hidden />}
        />

        {newKey ? (
          <Card>
            <CardHeader>
              <Badge variant="warning" tone="subtle">한 번만 표시</Badge>
              <CardTitle>새 MCP API 키</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="muted">아래 키는 지금 한 번만 표시됩니다. 복사해서 안전한 비밀 저장소에 보관하세요.</p>
              <pre className="mono-wrap">{newKey}</pre>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>MCP API 키 생성</CardTitle>
          </CardHeader>
          <CardBody>
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
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API 키 목록</CardTitle>
          </CardHeader>
          <CardBody>
            {apiKeys.length === 0 ? (
              <EmptyState
                title="생성된 API 키가 없습니다"
                description="AI Agent 연동을 시작하려면 MCP API 키를 생성하세요."
              />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>스코프</TableHead>
                    <TableHead nowrap>최근 사용</TableHead>
                    <TableHead nowrap>상태</TableHead>
                    <TableHead nowrap>작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>{key.label}</TableCell>
                      <TableCell className="mono">{key.key_prefix}</TableCell>
                      <TableCell className="mono">{key.scopes.join(', ')}</TableCell>
                      <TableCell nowrap>{formatDateTime(key.last_used_at)}</TableCell>
                      <TableCell nowrap>
                        <Badge variant={key.revoked_at ? 'neutral' : 'success'} tone="subtle">
                          {key.revoked_at ? '비활성' : '활성'}
                        </Badge>
                      </TableCell>
                      <TableCell nowrap>
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
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>이벤트 자동화 구독</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="muted">지정한 이벤트가 발생하면 거의 실시간(QStash)으로 웹훅 또는 Microsoft Teams 채널에 알림을 전달합니다.</p>
            <form action={createAutomationSubscriptionAction} className="form-grid">
              <Input name="name" required label="구독 이름" placeholder="예: 영업팀 열람 알림" />
              <SelectField name="destinationType" placeholder="전달 대상" triggerClassName="form-select-trigger">
                <SelectItem value="webhook">웹훅 (Generic JSON)</SelectItem>
                <SelectItem value="teams">Microsoft Teams</SelectItem>
              </SelectField>
              <Input type="url" name="webhookUrl" required label="Webhook URL" placeholder="https://example.com/webhooks/docflow" />
              <Input name="signingSecret" label="서명 시크릿 (선택)" placeholder="HMAC 검증용 비밀값 · Teams에는 사용 안 함" />
              <p className="muted small form-hint">
                <strong>Teams 설정:</strong> Microsoft Teams를 선택하면 Power Automate에서{' '}
                <strong>&quot;When a Teams webhook request is received&quot;</strong> →{' '}
                <strong>&quot;Post card in a channel&quot;</strong> 흐름을 만들고, 생성된 URL을 위 Webhook URL에 붙여넣으세요. DocFlow가 Adaptive Card를 전송합니다.
              </p>
              <fieldset className="form-fieldset">
                <legend>구독 이벤트</legend>
                <div className="check-grid">
                  {eventTypeOptions.map((eventType) => (
                    <Checkbox key={eventType.value} name="eventTypes" value={eventType.value} defaultChecked label={eventType.label} containerClassName="check-item" />
                  ))}
                </div>
              </fieldset>
              <div className="form-footer">
                <Checkbox name="isActive" defaultChecked label="즉시 활성화" containerClassName="check-plain" />
                <Button type="submit">구독 추가</Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>구독 목록</CardTitle>
          </CardHeader>
          <CardBody>
            {subscriptions.length === 0 ? (
              <EmptyState
                title="등록된 구독이 없습니다"
                description="열람, 다운로드, 거부 등 문서 이벤트를 외부 도구로 전달할 수 있습니다."
              />
            ) : (
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead nowrap>대상</TableHead>
                    <TableHead>Webhook</TableHead>
                    <TableHead>이벤트</TableHead>
                    <TableHead nowrap>최근 전달</TableHead>
                    <TableHead nowrap>최근 오류</TableHead>
                    <TableHead nowrap>상태</TableHead>
                    <TableHead nowrap>작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.map((subscription) => (
                    <TableRow key={subscription.id}>
                      <TableCell>{subscription.name}</TableCell>
                      <TableCell nowrap>
                        <Badge variant={subscription.destination_type === 'teams' ? 'secondary' : 'neutral'} tone="subtle">
                          {subscription.destination_type === 'teams' ? 'Teams' : '웹훅'}
                        </Badge>
                      </TableCell>
                      <TableCell className="mono">{subscription.webhook_url}</TableCell>
                      <TableCell className="mono">{subscription.event_types.join(', ')}</TableCell>
                      <TableCell nowrap>{formatDateTime(subscription.last_delivery_at)}</TableCell>
                      <TableCell>{subscription.last_error ?? '-'}</TableCell>
                      <TableCell nowrap>
                        <Badge variant={subscription.is_active ? 'success' : 'warning'} tone="subtle">
                          {subscription.is_active ? '활성' : '비활성'}
                        </Badge>
                      </TableCell>
                      <TableCell nowrap>
                        <Stack direction="row" align="center" gap={2} wrap>
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
