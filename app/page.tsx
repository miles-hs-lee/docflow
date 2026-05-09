import { Badge, Button, Card, FileIcon } from '@polaris/ui';
import { NovaLogo, PolarisLogo } from '@polaris/ui/logos';
import Image from 'next/image';
import Link from 'next/link';

import { getOwner } from '@/lib/auth';

export default async function HomePage() {
  const { user } = await getOwner();
  const primaryHref = user ? '/dashboard' : '/login';
  const primaryLabel = user ? '대시보드로 이동' : '로그인';
  const ctaLabel = user ? '대시보드로 이동' : '시작하기';

  return (
    <main className="landing-home-layout landing-home-layout-b2a">
      <section className="landing-showcase-shell">
        <header className="landing-topbar">
          <div className="landing-brand-wrap">
            <Image src="/brand/docflow-logo.svg" alt="DocFlow" width={238} height={62} className="landing-logo" priority />
            <Badge variant="info" tone="subtle">
              Polaris Design 0.7.3
            </Badge>
            <p className="landing-brand-copy">B2A Document Operations</p>
          </div>
          <div className="landing-top-actions">
            <Button asChild variant="ghost" size="sm">
              <Link href={primaryHref}>{primaryLabel}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">무료로 시작</Link>
            </Button>
          </div>
        </header>

        <section className="landing-hero-grid">
          <Card className="landing-hero-copy" variant="padded">
            <Badge variant="primary" tone="subtle">
              For Sales, Partnerships, BizOps
            </Badge>
            <h1>문서 공유를 운영 가능한 흐름으로</h1>
            <p className="landing-subtitle">
              DocFlow는 외부 파트너에게 보낸 PDF와 문서묶음을 링크 단위로 통제하고, 열람 반응을 바로 확인하는 B2A 문서 운영 서비스입니다.
            </p>
            <div className="landing-cta-row">
              <Button asChild size="xl">
                <Link href={primaryHref}>{ctaLabel}</Link>
              </Button>
              <Button asChild variant="secondary" size="xl">
                <Link href="/signup">계정 만들기</Link>
              </Button>
            </div>
            <div className="landing-kpi-strip">
              <article>
                <p className="kpi-label">Policy</p>
                <p className="kpi-value">파트너별 링크 제어</p>
              </article>
              <article>
                <p className="kpi-label">Signals</p>
                <p className="kpi-value">열람/거부/다운로드 추적</p>
              </article>
              <article className="kpi-nova">
                <div className="kpi-label-row">
                  <NovaLogo size={18} aria-hidden />
                  <p className="kpi-label">Agent-ready</p>
                </div>
                <p className="kpi-value">MCP + 이벤트 자동화</p>
              </article>
            </div>
          </Card>

          <Card className="landing-hero-panel" variant="padded">
            <div className="landing-panel-kicker">Live Link Operations</div>
            <h2>제안서, 온보딩 자료, 계약 전 문서를 한 링크 흐름으로 관리</h2>
            <div className="landing-panel-visual">
              <Image
                src="/landing/docflow-b2a-hero.svg"
                alt="DocFlow 링크 정책과 통계 대시보드 미리보기"
                width={1200}
                height={760}
                priority
              />
            </div>
            <div className="landing-panel-list">
              <article>
                <FileIcon type="pdf" size={32} />
                <strong>정책 제어</strong>
                <p>만료, 비밀번호, 도메인 제한, 최대 조회수</p>
              </article>
              <article>
                <FileIcon type="xlsx" size={32} />
                <strong>성과 추적</strong>
                <p>열람 성공, 거부 사유, 다운로드를 링크별 집계</p>
              </article>
              <article>
                <FileIcon type="folder" size={32} />
                <strong>문서묶음 공유</strong>
                <p>여러 PDF를 하나의 링크로 묶어 전달</p>
              </article>
            </div>
          </Card>
        </section>

        <Card className="landing-value-wrap" variant="padded">
          <h2>왜 B2A 팀에 맞나요?</h2>
          <div className="landing-value-grid">
            <article className="landing-point">
              <h3>거래처별 링크 전략</h3>
              <p>같은 제안서도 파트너별 정책을 다르게 적용해 대응력을 높입니다.</p>
            </article>
            <article className="landing-point">
              <h3>외부 공유 리스크 축소</h3>
              <p>유효기간과 다운로드 통제로 문서 확산을 운영 기준에 맞게 관리합니다.</p>
            </article>
            <article className="landing-point">
              <h3>후속 액션 우선순위</h3>
              <p>누가 읽었는지, 어디서 막혔는지 보고 다음 미팅/콜 순서를 정합니다.</p>
            </article>
            <article className="landing-point landing-point-nova">
              <Badge variant="secondary" tone="subtle">NOVA</Badge>
              <h3>에이전트 기반 운영</h3>
              <p>MCP 도구로 업로드, 링크 생성, 통계 조회를 자동화 파이프라인에 연결합니다.</p>
            </article>
          </div>
        </Card>

        <Card className="landing-process-wrap" variant="padded">
          <h2>3단계 운영 플로우</h2>
          <div className="landing-process-grid">
            <article className="landing-process-item">
              <p className="process-step">01</p>
              <h3>문서 업로드</h3>
              <p>제안서/가이드 PDF를 올리고 파일 또는 문서묶음을 구성합니다.</p>
            </article>
            <article className="landing-process-item">
              <p className="process-step">02</p>
              <h3>링크 정책 설정</h3>
              <p>파트너별 만료일, 비밀번호, 이메일 조건을 적용해 공유합니다.</p>
            </article>
            <article className="landing-process-item">
              <p className="process-step">03</p>
              <h3>반응 확인 및 자동화</h3>
              <p>통계와 이벤트를 확인하고 필요한 후속 작업을 자동으로 실행합니다.</p>
            </article>
          </div>
        </Card>

        <Card className="landing-scenario-wrap" variant="padded">
          <h2>대표 활용 시나리오</h2>
          <div className="landing-scenario-grid">
            <article className="landing-scenario-item">
              <h3>제안/입찰 자료 전달</h3>
              <p>열람 신호를 기준으로 후속 미팅 타이밍을 정밀하게 조정합니다.</p>
            </article>
            <article className="landing-scenario-item">
              <h3>파트너 온보딩 자료 배포</h3>
              <p>문서묶음 링크 하나로 자료를 배포하고 접근 정책을 즉시 업데이트합니다.</p>
            </article>
            <article className="landing-scenario-item">
              <h3>대외 협업 문서 관리</h3>
              <p>프로젝트 단계별로 다른 권한 정책을 적용해 협업과 보안을 함께 유지합니다.</p>
            </article>
          </div>
        </Card>

        <p className="landing-footnote">DocFlow는 문서를 보내는 순간이 아니라, 보낸 이후의 실행까지 관리하도록 설계되었습니다.</p>

        <footer className="landing-attribution">
          <PolarisLogo variant="symbol" size={20} aria-hidden />
          <span>Designed with Polaris Office Design System v0.7.3</span>
        </footer>
      </section>
    </main>
  );
}
