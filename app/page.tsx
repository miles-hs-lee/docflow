import { Badge, Button, Card, FileIcon } from '@polaris/ui';
import { NovaLogo, PolarisLogo } from '@polaris/ui/logos';
import Image from 'next/image';
import Link from 'next/link';

import { getOwner } from '@/lib/auth';

export default async function HomePage() {
  const { user } = await getOwner();
  const primaryHref = user ? '/dashboard' : '/signup';
  const primaryLabel = user ? '대시보드' : '무료로 시작';

  return (
    <main className="landing-home-layout">
      <section className="landing-shell">
        <header className="landing-topbar">
          <div className="landing-brand">
            <Image src="/brand/docflow-logo.svg" alt="DocFlow" width={196} height={52} priority />
            <span className="landing-brand-meta">
              <PolarisLogo variant="symbol" size={14} aria-hidden />
              A Polaris Office service
            </span>
          </div>
          <div className="landing-nav">
            {user ? (
              <Button asChild size="sm">
                <Link href={primaryHref}>{primaryLabel}</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/login">로그인</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href={primaryHref}>{primaryLabel}</Link>
                </Button>
              </>
            )}
          </div>
        </header>

        <section className="landing-hero">
          <div className="landing-hero-copy">
            <Badge variant="primary" tone="subtle">B2A Document Operations</Badge>
            <h1>외부 문서 공유를 운영 가능한 흐름으로</h1>
            <p className="landing-lede">
              제안서 · 온보딩 자료 · 계약 문서를 링크 한 줄로 통제하고,
              누가 어디서 막혔는지 보고 다음 행동을 결정합니다.
            </p>
            <div className="landing-cta-row">
              <Button asChild size="xl">
                <Link href={primaryHref}>{primaryLabel}</Link>
              </Button>
              {user ? null : (
                <Button asChild variant="secondary" size="xl">
                  <Link href="/login">로그인</Link>
                </Button>
              )}
            </div>
          </div>
          <div className="landing-hero-visual" aria-hidden>
            <Image
              src="/landing/docflow-b2a-hero.svg"
              alt=""
              width={1200}
              height={760}
              priority
            />
          </div>
        </section>

        <section className="landing-section">
          <header className="landing-section-head">
            <Badge variant="neutral" tone="subtle">Why DocFlow</Badge>
            <h2>외부에 보낸 문서는 그 순간부터 운영 영역 밖이었습니다</h2>
          </header>
          <div className="landing-need-grid">
            <article className="landing-need">
              <p className="landing-need-num">01</p>
              <h3>통제 불가능한 확산</h3>
              <p>이메일 첨부와 단순 클라우드 공유로는 만료 · 다운로드 · 도메인 제어가 안 됩니다.</p>
            </article>
            <article className="landing-need">
              <p className="landing-need-num">02</p>
              <h3>보이지 않는 반응</h3>
              <p>상대가 열었는지, 어디서 멈췄는지 알 수 없으니 후속 액션은 추측에 의존합니다.</p>
            </article>
            <article className="landing-need">
              <p className="landing-need-num">03</p>
              <h3>자동화 단절</h3>
              <p>CRM · 영업 · 고객 응대 도구와 분리돼 매번 수기로 공유하고 수기로 추적합니다.</p>
            </article>
          </div>
        </section>

        <section className="landing-section">
          <header className="landing-section-head">
            <Badge variant="primary" tone="subtle">What&apos;s inside</Badge>
            <h2>한 링크에 정책 · 신호 · 자동화를 묶었습니다</h2>
          </header>
          <div className="landing-feature-grid">
            <Card className="landing-feature" variant="padded">
              <FileIcon type="pdf" size={36} />
              <h3>Link Policy</h3>
              <p>만료, 비밀번호, 이메일 도메인, 최대 조회수, 다운로드 차단을 링크별로 적용합니다.</p>
            </Card>
            <Card className="landing-feature" variant="padded">
              <FileIcon type="folder" size={36} />
              <h3>Document Bundles</h3>
              <p>제안서 · 약관 · 소개서를 하나의 묶음 링크로 전달하고 파일 단위 통계를 분리해 봅니다.</p>
            </Card>
            <Card className="landing-feature" variant="padded">
              <Badge variant="info" tone="subtle">Live</Badge>
              <h3>Signals &amp; Stats</h3>
              <p>열람, 다운로드, 거부 사유, 비밀번호 실패를 링크 · 파일 · 파트너 축으로 집계합니다.</p>
            </Card>
            <Card className="landing-feature landing-feature-nova" variant="padded">
              <NovaLogo size={32} aria-hidden />
              <h3>MCP Automation</h3>
              <p>업로드, 링크 발급, 통계 조회를 MCP API 키 한 줄로 AI Agent · 자동화 워크플로우에 연결합니다.</p>
            </Card>
          </div>
        </section>

        <section className="landing-section">
          <header className="landing-section-head">
            <Badge variant="success" tone="subtle">Outcomes</Badge>
            <h2>같은 자료를 보내도 운영 결과가 달라집니다</h2>
          </header>
          <div className="landing-outcome-grid">
            <article className="landing-outcome">
              <h3>외부 유출 위험 축소</h3>
              <p>다운로드 · 도메인 · 만료 정책이 기본값으로 강제돼 무차별 확산을 막습니다.</p>
            </article>
            <article className="landing-outcome">
              <h3>후속 액션 정확화</h3>
              <p>열람 신호를 기준으로 콜 · 미팅 · 알림 우선순위를 정해 추측을 줄입니다.</p>
            </article>
            <article className="landing-outcome">
              <h3>운영 자동화</h3>
              <p>MCP를 통해 매번 사람이 들여다볼 필요 없는 루틴은 AI 에이전트에 위임합니다.</p>
            </article>
          </div>
        </section>

        <Card className="landing-cta-card" variant="padded">
          <Badge variant="primary" tone="subtle">Get started</Badge>
          <h2>다음 제안서부터 다르게 보내보세요</h2>
          <p className="landing-lede">계정 생성에 1분, 첫 PDF 링크 발급까지 3분이면 충분합니다.</p>
          <div className="landing-cta-row">
            <Button asChild size="xl">
              <Link href={primaryHref}>{primaryLabel}</Link>
            </Button>
            {user ? null : (
              <Button asChild variant="secondary" size="xl">
                <Link href="/login">로그인</Link>
              </Button>
            )}
          </div>
        </Card>

        <footer className="landing-attribution">
          <PolarisLogo variant="symbol" size={20} aria-hidden />
          <span>DocFlow · A Polaris Office service · © {new Date().getFullYear()} Polaris Office</span>
        </footer>
      </section>
    </main>
  );
}
