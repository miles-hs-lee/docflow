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
  agreement: { short: 'NDA 동의', emoji: '✍️', title: 'NDA에 동의했습니다' },
  // File Request inbound upload — not a link_event (no link analytics page), so
  // it is intentionally absent from OWNER_FEED_EVENT_TYPES below.
  file_uploaded: { short: '파일 수신', emoji: '📥', title: '파일이 업로드되었습니다' },
  // Data room Q&A — a viewer asked a question. Not a link_event either, so it is
  // likewise absent from OWNER_FEED_EVENT_TYPES.
  question_asked: { short: '질문', emoji: '❓', title: '새 질문이 등록되었습니다' },
  // Workspace + content lifecycle events (Phase 2). Workspace-scoped, direct
  // dispatch (not link_events) — absent from OWNER_FEED_EVENT_TYPES below.
  question_answered: { short: '답변', emoji: '💬', title: '질문에 답변했습니다' },
  request_created: { short: '파일 요청', emoji: '📨', title: '파일 요청이 생성되었습니다' },
  member_invited: { short: '멤버 초대', emoji: '✉️', title: '워크스페이스에 멤버를 초대했습니다' },
  member_joined: { short: '멤버 합류', emoji: '🎉', title: '새 멤버가 합류했습니다' },
  member_removed: { short: '멤버 제거', emoji: '👋', title: '멤버가 제거되었습니다' }
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
