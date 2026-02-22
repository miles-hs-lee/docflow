import type { DeniedReason, ShareLinkRow, ViewerGrantPayload } from '@/lib/types';
import { getEmailDomain } from '@/lib/security';

type PolicyInput = {
  link: ShareLinkRow;
  grant: ViewerGrantPayload | null;
};

export function evaluateBasePolicy({ link }: PolicyInput): DeniedReason | null {
  if (link.deleted_at) {
    return 'deleted';
  }

  if (!link.is_active) {
    return 'inactive';
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return 'expired';
  }

  const effectiveMaxViews = link.one_time ? 1 : link.max_views;
  if (effectiveMaxViews && link.view_count >= effectiveMaxViews) {
    return 'max_views_reached';
  }

  return null;
}

export function evaluateGrantPolicy({ link, grant }: PolicyInput): DeniedReason | null {
  const requiresEmail = link.require_email || link.allowed_domains.length > 0;

  if (!requiresEmail && !link.password_hash) {
    return null;
  }

  if (!grant || grant.linkId !== link.id) {
    return 'access_not_granted';
  }

  if (requiresEmail) {
    if (!grant.email) {
      return 'email_required';
    }

    const emailDomain = getEmailDomain(grant.email);
    if (link.allowed_domains.length > 0 && (!emailDomain || !link.allowed_domains.includes(emailDomain))) {
      return 'domain_not_allowed';
    }
  }

  if (link.password_hash && !grant.grantedAt) {
    return 'password_required';
  }

  return null;
}

export function deniedMessage(reason: DeniedReason) {
  switch (reason) {
    case 'expired':
      return '이 링크는 만료되어 접근할 수 없습니다.';
    case 'inactive':
    case 'deleted':
      return '현재 이 링크로는 접근할 수 없습니다.';
    case 'max_views_reached':
      return '접근 가능한 조회 횟수를 초과했습니다.';
    case 'domain_not_allowed':
    case 'wrong_password':
    case 'email_required':
    case 'password_required':
    case 'access_not_granted':
      return '입력한 접근 조건이 올바르지 않습니다.';
    case 'file_missing':
      return '요청한 문서를 찾을 수 없습니다.';
    default:
      return '접근할 수 없습니다.';
  }
}
