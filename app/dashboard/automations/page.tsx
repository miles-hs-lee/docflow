import { Flash } from '@/components/flash';
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
  const newKey = typeof params.newKey === 'string' ? params.newKey : null;

  return (
    <section className="stack-lg">
      <Flash success={success} error={error} />

      {newKey ? (
        <article className="panel">
          <h2>새 MCP API 키</h2>
          <p className="muted">
            아래 키는 지금 한 번만 표시됩니다. 복사해서 안전한 비밀 저장소에 보관하세요.
          </p>
          <pre className="mono-wrap">{newKey}</pre>
        </article>
      ) : null}

      <article className="panel">
        <h2>MCP API 키 생성</h2>
        <p className="muted">AI Agent는 이 키를 사용해 `/api/mcp`를 호출합니다.</p>
        <form action={createMcpApiKeyAction} className="form-grid">
          <label>
            키 이름
            <input name="label" required placeholder="예: CRM Agent Production" />
          </label>
          <fieldset className="form-fieldset">
            <legend>권한 스코프</legend>
            <div className="check-grid">
              {scopeOptions.map((scope) => (
                <label key={scope.value} className="check-item">
                  <input type="checkbox" name="scopes" value={scope.value} defaultChecked />
                  <span className="mono">{scope.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="button button-primary">
            API 키 생성
          </button>
        </form>
      </article>

      <article className="panel">
        <h2>API 키 목록</h2>
        {apiKeys.length === 0 ? (
          <p className="muted">생성된 API 키가 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>Prefix</th>
                  <th>스코프</th>
                  <th>최근 사용</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id}>
                    <td>{key.label}</td>
                    <td className="mono">{key.key_prefix}</td>
                    <td className="mono">{key.scopes.join(', ')}</td>
                    <td>{formatDateTime(key.last_used_at)}</td>
                    <td>{key.revoked_at ? '비활성' : '활성'}</td>
                    <td>
                      {key.revoked_at ? (
                        <span className="muted small">-</span>
                      ) : (
                        <form action={revokeMcpApiKeyAction}>
                          <input type="hidden" name="keyId" value={key.id} />
                          <button type="submit" className="button button-danger">
                            비활성화
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="panel">
        <h2>이벤트 자동화 구독</h2>
        <p className="muted">지정한 이벤트가 발생하면 웹훅으로 payload를 전달합니다.</p>
        <form action={createAutomationSubscriptionAction} className="form-grid">
          <label>
            구독 이름
            <input name="name" required placeholder="예: 영업팀 Slack 알림" />
          </label>
          <label>
            Webhook URL
            <input type="url" name="webhookUrl" required placeholder="https://example.com/webhooks/docflow" />
          </label>
          <label>
            서명 시크릿 (선택)
            <input name="signingSecret" placeholder="HMAC 검증용 비밀값" />
          </label>
          <label className="check-inline">
            <input type="checkbox" name="isActive" defaultChecked />
            <span>즉시 활성화</span>
          </label>
          <fieldset className="form-fieldset">
            <legend>구독 이벤트</legend>
            <div className="check-grid">
              {eventTypeOptions.map((eventType) => (
                <label key={eventType.value} className="check-item">
                  <input type="checkbox" name="eventTypes" value={eventType.value} defaultChecked />
                  <span>{eventType.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="button button-primary">
            구독 추가
          </button>
        </form>
      </article>

      <article className="panel">
        <h2>구독 목록</h2>
        {subscriptions.length === 0 ? (
          <p className="muted">등록된 구독이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>Webhook</th>
                  <th>이벤트</th>
                  <th>최근 전달</th>
                  <th>최근 오류</th>
                  <th>상태</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((subscription) => (
                  <tr key={subscription.id}>
                    <td>{subscription.name}</td>
                    <td className="mono">{subscription.webhook_url}</td>
                    <td className="mono">{subscription.event_types.join(', ')}</td>
                    <td>{formatDateTime(subscription.last_delivery_at)}</td>
                    <td>{subscription.last_error ?? '-'}</td>
                    <td>{subscription.is_active ? '활성' : '비활성'}</td>
                    <td>
                      <div className="row-actions">
                        <form action={toggleAutomationSubscriptionAction}>
                          <input type="hidden" name="subscriptionId" value={subscription.id} />
                          <input type="hidden" name="nextValue" value={subscription.is_active ? 'false' : 'true'} />
                          <button type="submit" className="button button-ghost">
                            {subscription.is_active ? '비활성화' : '활성화'}
                          </button>
                        </form>
                        <form action={deleteAutomationSubscriptionAction}>
                          <input type="hidden" name="subscriptionId" value={subscription.id} />
                          <button type="submit" className="button button-danger">
                            삭제
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
