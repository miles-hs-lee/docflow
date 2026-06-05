import { formatDateTime } from '@/lib/format';

// Formats a DocFlow link event into a Microsoft Teams message.
//
// Teams (and Power Automate "When a Teams webhook request is received")
// expect an Adaptive Card wrapped in a message envelope — NOT our native
// webhook JSON. The recommended setup is a Power Automate Workflow:
//   trigger: "When a Teams webhook request is received"
//   action:  "Post card in a channel" (card body = trigger body attachments)
// which yields a public HTTPS URL the owner pastes as the subscription's
// webhook_url. The secret URL is the only auth, so we send no HMAC header.
//
// The payload shape here is the message/attachments envelope documented for
// posting Adaptive Cards via incoming webhooks; if a given flow expects a
// bare card it can reference attachments[0].content.

type OutboxPayloadLike = {
  eventId?: number;
  eventType?: string;
  linkId?: string | null;
  viewerEmail?: string | null;
  reason?: string | null;
  createdAt?: string | null;
};

const EVENT_LABELS: Record<string, { emoji: string; title: string; short: string }> = {
  view: { emoji: '📄', title: '문서가 열람되었습니다', short: '열람' },
  download: { emoji: '⬇️', title: '문서가 다운로드되었습니다', short: '다운로드' },
  denied: { emoji: '🚫', title: '접근이 거부되었습니다', short: '거부' },
  email_submitted: { emoji: '✉️', title: '이메일이 제출되었습니다', short: '이메일 제출' },
  password_failed: { emoji: '🔑', title: '비밀번호 인증에 실패했습니다', short: '비밀번호 실패' },
  agreement: { emoji: '✍️', title: 'NDA에 동의했습니다', short: 'NDA 동의' }
};

export function formatTeamsMessage(eventType: string, payload: unknown, appBaseUrl: string) {
  const p = (payload ?? {}) as OutboxPayloadLike;
  const label = EVENT_LABELS[eventType] ?? { emoji: '🔔', title: `이벤트: ${eventType}`, short: eventType };

  const facts: { title: string; value: string }[] = [
    { title: '방문자', value: p.viewerEmail || '익명 방문자' },
    { title: '이벤트', value: `${label.short} (${eventType})` }
  ];
  if (p.reason) {
    facts.push({ title: '사유', value: String(p.reason) });
  }
  if (p.createdAt) {
    facts.push({ title: '시각', value: formatDateTime(p.createdAt) });
  }

  const card: Record<string, unknown> = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: `${label.emoji} ${label.title}` },
      { type: 'TextBlock', text: 'DocFlow 문서 알림', isSubtle: true, spacing: 'None', wrap: true },
      { type: 'FactSet', facts }
    ]
  };

  // Deep-link to the link's analytics page. Only add the action when we
  // have both a link id and an absolute https app URL (a localhost/dev URL
  // would render a dead button inside Teams).
  const base = (appBaseUrl || '').replace(/\/+$/, '');
  if (p.linkId && /^https:\/\//i.test(base)) {
    card.actions = [
      { type: 'Action.OpenUrl', title: '분석 보기', url: `${base}/dashboard/links/${p.linkId}` }
    ];
  }

  return {
    type: 'message',
    attachments: [
      { contentType: 'application/vnd.microsoft.card.adaptive', content: card }
    ]
  };
}
