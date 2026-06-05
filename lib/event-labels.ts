import type { LinkEventType } from '@/lib/types';

// Single source of truth for owner-facing link-event labels — consumed by the
// dashboard activity feed, the Teams notification formatter, and the recent-
// events query. Keeps the Korean labels from drifting across surfaces.
export const EVENT_META: Record<string, { short: string; emoji: string; title: string }> = {
  view: { short: '열람', emoji: '📄', title: '문서가 열람되었습니다' },
  download: { short: '다운로드', emoji: '⬇️', title: '문서가 다운로드되었습니다' },
  denied: { short: '접근 거부', emoji: '🚫', title: '접근이 거부되었습니다' },
  email_submitted: { short: '이메일 제출', emoji: '✉️', title: '이메일이 제출되었습니다' },
  password_failed: { short: '비밀번호 실패', emoji: '🔑', title: '비밀번호 인증에 실패했습니다' },
  agreement: { short: 'NDA 동의', emoji: '✍️', title: 'NDA에 동의했습니다' }
};

// Meaningful events for the owner activity feed (page_view excluded — too noisy).
export const OWNER_FEED_EVENT_TYPES: LinkEventType[] = [
  'view',
  'download',
  'denied',
  'email_submitted',
  'password_failed',
  'agreement'
];
