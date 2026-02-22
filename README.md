# DocFlow

정책 기반 PDF 공유 서비스입니다.  
현재 인증 방식은 **이메일/비밀번호(Supabase Auth)** 이며, **M365 로그인은 사용하지 않습니다**.

## 무엇을 할 수 있나요?

### Owner(로그인 사용자)
- PDF 업로드 (PDF가 아니면 업로드 거부)
- 파일별/문서묶음(컬렉션)별 공유 링크 여러 개 생성
- 링크 정책 설정
  - 활성/비활성
  - 만료일
  - 최대 조회수
  - 이메일 입력 요구
  - 허용 도메인 제한
  - 비밀번호
  - 다운로드 허용/차단
  - 1회성 링크
- 링크 관리
  - 수정
  - 소프트 삭제(휴지통)
  - 복구
  - 영구 삭제(DELETE 확인)
- 통계
  - view / unique(세션 기준) / download / denied
  - denied 사유 집계
- 자동화
  - MCP API 키 발급/비활성화
  - 이벤트 웹훅 구독 생성/관리

### Viewer(비로그인 가능)
- 공유 링크 접근
- 정책 통과 시 PDF 열람
- 정책 미충족 시 접근 거부
- 다운로드 허용 링크에서만 다운로드 가능

## 기술 스택

- Frontend/Backend: Next.js (App Router, TypeScript)
- Auth/DB/Storage: Supabase
- Deploy: Vercel

## 빠른 시작 (로컬)

### 1) 의존성 설치

```bash
npm install
```

### 2) 환경 변수 설정

`.env.example`를 복사해서 `.env.local`을 만드세요.

```bash
cp .env.example .env.local
```

필수 값:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (로컬은 `http://localhost:3000`)
- `VIEWER_COOKIE_SECRET` (충분히 긴 랜덤 문자열)

선택 값:
- `AUTOMATION_CRON_SECRET` (이벤트 디스패처 보호용)

### 3) Supabase SQL 실행

Supabase SQL Editor에서 아래 파일을 순서대로 실행하세요.

1. `supabase/migrations/001_init.sql`
2. `supabase/migrations/002_collections.sql`
3. `supabase/migrations/003_mcp_automation.sql`

### 4) Supabase Auth 설정

- Authentication > Providers에서 Email 활성화
- 빠른 테스트가 목적이면 이메일 확인(Confirm email)은 꺼도 됩니다.

### 5) 개발 서버 실행

```bash
npm run dev
```

## Vercel 배포

프로젝트 환경변수:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (실서비스 도메인)
- `VIEWER_COOKIE_SECRET`
- `AUTOMATION_CRON_SECRET` 또는 `CRON_SECRET` (권장)

배포 후 `NEXT_PUBLIC_APP_URL`이 실제 도메인과 다르면 재배포하세요.

## MCP 사용 방법

1. 대시보드 `자동화` 탭에서 MCP API 키 생성  
2. Agent가 `/api/mcp` 호출 시 헤더에 아래를 포함

```http
Authorization: Bearer <MCP_API_KEY>
```

지원 RPC:
- `initialize`
- `tools/list`
- `tools/call`

주요 Tool:
- `docflow.files.upload` (PDF base64 업로드)
- `docflow.files.list`
- `docflow.links.list`
- `docflow.links.create`
- `docflow.links.update`
- `docflow.analytics.summary`
- `docflow.analytics.events`
- `docflow.automations.subscribe`
- `docflow.automations.list`
- `docflow.automations.unsubscribe`

## 이벤트 자동화(Webhook)

- 이벤트는 `link_events`에 기록된 뒤 outbox를 통해 웹훅으로 비동기 전달됩니다.
- 디스패처 엔드포인트: `/api/automation/dispatch`
- `vercel.json` cron은 현재 **하루 1회(09:00 UTC)** 로 설정되어 있습니다.  
  (Vercel Hobby 플랜 제한 대응)

보호:
- `AUTOMATION_CRON_SECRET` 또는 `CRON_SECRET` 설정 시 Bearer 인증 필요

중요:
- 시크릿이 없으면 서비스 본체는 정상 동작하고, **자동화 전달만 비활성화**됩니다.

## 데이터베이스 요약

주요 테이블:
- `files`, `share_links`, `link_events`
- `collections`, `collection_files`
- `mcp_api_keys`
- `automation_subscriptions`, `automation_event_outbox`, `automation_deliveries`

주요 보장:
- Owner 기준 RLS 멀티테넌시 격리
- 이벤트 카운터 트리거(view/download/denied)
- denied 사유 집계 RPC

## 보안/프라이버시

- 공유 토큰: 32-byte 랜덤(base64url)
- PDF 원본 퍼블릭 URL 직접 노출 없음 (private bucket + API 경유)
- IP는 해시(`sha256`) 저장
- 이메일은 정책이 요구될 때만 수집

## 현재 MVP 한계

- 다운로드 차단은 UI/API 레벨 중심이며, OS/브라우저 캡처까지 완전 차단하지는 못합니다.
- Rate limiting, WAF, 고급 bot 방어는 인프라 계층에서 추가 권장입니다.
