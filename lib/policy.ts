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

  // max_views / one_time are evaluated atomically inside claim_view (with
  // session dedup so collection viewers can walk through multiple files in
  // the same session without each file consuming a slot). Checking here
  // would short-circuit before claim_view runs and break the dedup contract
  // — a viewer who already opened file #1 would be blocked at file #2's
  // page.tsx render even though their session already holds the view slot.
  return null;
}

export function evaluateGrantPolicy({ link, grant }: PolicyInput): DeniedReason | null {
  const requiresEmail = link.require_email || link.allowed_domains.length > 0;
  const requiresAgreement = link.require_agreement;

  if (!requiresEmail && !link.password_hash && !requiresAgreement) {
    return null;
  }

  if (!grant || grant.linkId !== link.id) {
    return 'access_not_granted';
  }

  // Grant cookies are pinned to the policy snapshot at issue time. If the
  // owner changed any policy field afterward (e.g. added a password), the
  // bumped policy_version invalidates this grant and forces re-auth.
  if (grant.policyVersion !== link.policy_version) {
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

  // Clickwrap NDA gate. A grant issued before the owner enabled
  // require_agreement (or one that simply hasn't accepted yet) has no
  // agreedAt, so the viewer is re-gated until they accept.
  if (requiresAgreement && !grant.agreedAt) {
    return 'agreement_required';
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
    case 'too_many_attempts':
      return '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
    case 'agreement_required':
      return '문서를 열람하려면 동의가 필요합니다. 약관을 확인하고 이름 입력 후 동의해주세요.';
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
