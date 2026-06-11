import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Stack } from '@polaris/ui';
import Link from 'next/link';

type GettingStartedProps = {
  filesCount: number;
  linksCount: number;
  opens: number;
};

type Step = {
  key: string;
  title: string;
  description: string;
  done: boolean;
  cta: { href: string; label: string };
};

// First-run checklist on the dashboard overview: upload → share → track.
// Renders nothing once the workspace has real activity — it's onboarding,
// not furniture. Steps deep-link straight into the screen that completes them.
export function GettingStarted({ filesCount, linksCount, opens }: GettingStartedProps) {
  const steps: Step[] = [
    {
      key: 'upload',
      title: 'PDF 업로드',
      description: '제안서·IR·계약 문서를 올립니다. 여러 개를 한 번에 선택할 수 있습니다.',
      done: filesCount > 0,
      cta: { href: '/dashboard/files', label: '콘텐츠로 이동' }
    },
    {
      key: 'link',
      title: '공유 링크 만들기',
      description: '만료·비밀번호·이메일/도메인·NDA·워터마크 정책을 링크마다 다르게 적용합니다.',
      done: linksCount > 0,
      cta: { href: '/dashboard/files', label: '파일에서 링크 발급' }
    },
    {
      key: 'share',
      title: '미리보고, 보내기',
      description:
        '링크 통계 페이지의 ‘미리보기’로 받는 사람이 볼 화면을 확인하세요 — 미리보기는 통계에 집계되지 않습니다. 확인했으면 링크를 복사해 전달합니다.',
      done: opens > 0,
      cta: { href: '/dashboard/files', label: '링크 복사하러 가기' }
    },
    {
      key: 'track',
      title: '반응 확인',
      description: '누가, 몇 페이지까지(완독률), 얼마나 머물렀는지(평균 체류), 어느 나라에서 열었는지 확인합니다.',
      done: opens > 0,
      cta: { href: '/dashboard', label: '대시보드 새로고침' }
    }
  ];

  if (steps.every((step) => step.done)) {
    return null;
  }

  const doneCount = steps.filter((step) => step.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>시작하기</CardTitle>
        <Badge variant={doneCount > 0 ? 'info' : 'neutral'} tone="subtle">
          {doneCount}/{steps.length} 완료
        </Badge>
      </CardHeader>
      <CardBody>
        <p className="muted">3분이면 첫 문서를 보내고 반응까지 볼 수 있습니다.</p>
        <Stack gap={3}>
          {steps.map((step, index) => (
            <div key={step.key} className="getting-started-step">
              <span className={`getting-started-marker${step.done ? ' done' : ''}`} aria-hidden>
                {step.done ? '✓' : index + 1}
              </span>
              <div className="getting-started-body">
                <strong className={step.done ? 'getting-started-done-title' : undefined}>{step.title}</strong>
                <p className="muted small">{step.description}</p>
              </div>
              {!step.done ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={step.cta.href}>{step.cta.label}</Link>
                </Button>
              ) : null}
            </div>
          ))}
        </Stack>
        <p className="muted small getting-started-more">
          더 해볼 것: <Link href="/dashboard/collections">데이터룸 만들기</Link> ·{' '}
          <Link href="/dashboard/team">팀원 초대</Link> · <Link href="/dashboard/automations">API 키·웹훅 연결</Link>
        </p>
      </CardBody>
    </Card>
  );
}
