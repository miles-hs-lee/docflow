import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@polaris/ui';

import { LocalDate } from '@/components/local-date';

type LinkPolicySummaryProps = {
  link: {
    created_at: string;
    expires_at: string | null;
    max_views: number | null;
    allow_download: boolean;
    require_email: boolean;
    allowed_domains: string[];
    one_time: boolean;
    watermark: boolean;
    require_agreement: boolean;
  };
};

// Small dl summary of a share-link's policy. Replaces the previous
// "생성일 X | 만료일 Y | 다운로드 Z" inline-pipe text — easier to scan
// when there are 5+ policy fields and DescriptionList auto-stacks on
// narrow viewports so the labels don't squeeze.
export function LinkPolicySummary({ link }: LinkPolicySummaryProps) {
  return (
    <DescriptionList layout="inline" className="link-policy-summary">
      <DescriptionTerm>생성일</DescriptionTerm>
      <DescriptionDetails>
        <LocalDate value={link.created_at} mode="date" />
      </DescriptionDetails>

      <DescriptionTerm>만료</DescriptionTerm>
      <DescriptionDetails>{link.expires_at ? <LocalDate value={link.expires_at} /> : '없음'}</DescriptionDetails>

      <DescriptionTerm>다운로드</DescriptionTerm>
      <DescriptionDetails>{link.allow_download ? '허용' : '차단'}</DescriptionDetails>

      <DescriptionTerm>워터마크</DescriptionTerm>
      <DescriptionDetails>{link.watermark ? '표시' : '없음'}</DescriptionDetails>

      <DescriptionTerm>최대 조회수</DescriptionTerm>
      <DescriptionDetails>{link.max_views ?? '제한 없음'}</DescriptionDetails>

      <DescriptionTerm>이메일 요구</DescriptionTerm>
      <DescriptionDetails>{link.require_email ? '예' : '아니오'}</DescriptionDetails>

      {link.require_agreement ? (
        <>
          <DescriptionTerm>NDA 동의</DescriptionTerm>
          <DescriptionDetails>필요</DescriptionDetails>
        </>
      ) : null}

      {link.allowed_domains.length > 0 ? (
        <>
          <DescriptionTerm>허용 도메인</DescriptionTerm>
          <DescriptionDetails className="mono">{link.allowed_domains.join(', ')}</DescriptionDetails>
        </>
      ) : null}

      {link.one_time ? (
        <>
          <DescriptionTerm>1회성</DescriptionTerm>
          <DescriptionDetails>예</DescriptionDetails>
        </>
      ) : null}
    </DescriptionList>
  );
}
