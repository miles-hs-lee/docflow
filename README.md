# DocFlow

정책 기반 PDF 공유 MVP (`Supabase + Vercel + Microsoft 365 SSO`) 구현본입니다.

## 기능 범위

- Owner
  - Entra ID(Microsoft 365) SSO 로그인
  - PDF 업로드(비-PDF 명확히 거부)
  - 파일별 다중 공유 링크 생성
  - 링크별 독립 정책 설정/수정
    - 활성/비활성
    - 만료일
    - 최대 조회수
    - 이메일 요구
    - 허용 도메인 제한
    - 비밀번호 요구
    - 다운로드 허용/차단
    - 1회성 링크
  - 링크 소프트 삭제(휴지통), 복구, 영구 삭제(DELETE 확인)
  - 링크별 통계 요약/상세
    - view / unique(세션 기준) / download / denied
    - denied 사유 집계

- Viewer
  - 공개 링크 접근
  - 정책 충족 시 브라우저 PDF 열람
  - 정책 불충족 시 접근 거부
  - 다운로드 허용 링크에서만 다운로드 가능

## 기술 스택

- Frontend/Backend: Next.js (App Router, TypeScript)
- Auth/DB/Storage: Supabase
- Deploy: Vercel

## 데이터베이스 구성

`supabase/migrations/001_init.sql`

포함 내용:

- `files`, `share_links`, `link_events` 테이블
- RLS(Owner 멀티테넌시 격리)
- 이벤트 기반 카운터 트리거
- 통계 조회용 RPC
  - `get_owner_link_metrics`
  - `get_denied_reason_breakdown`
- Private bucket `pdf-files`

## 실행 방법

1. 의존성 설치

```bash
npm install
```

2. 환경 변수 설정

`.env.example` 기반으로 `.env.local` 생성

3. Supabase SQL 실행

- Supabase SQL Editor에서 `supabase/migrations/001_init.sql` 실행

4. Supabase Auth에서 Azure(Entra ID) 설정

- Provider: `Azure`
- Redirect URL 등록
  - Local: `http://localhost:3000/auth/callback`
  - Prod: `https://<your-domain>/auth/callback`

5. 개발 서버 실행

```bash
npm run dev
```

## Vercel 배포

- Vercel 프로젝트 생성 후 환경변수 입력
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_APP_URL`
  - `VIEWER_COOKIE_SECRET`
- 배포 후 `NEXT_PUBLIC_APP_URL`을 배포 도메인으로 맞추고 재배포
- Supabase Auth Azure Redirect URL에 배포 도메인 callback 추가

## 보안/프라이버시 구현 포인트

- 공유 토큰: 32-byte 랜덤(base64url)
- 스토리지: private bucket, API에서 정책 검증 후 스트리밍
- 원본 퍼블릭 URL 직접 노출 없음
- Viewer 세션 기반 unique 집계
- IP는 해시 저장(`sha256`)
- 이메일은 정책이 요구될 때만 수집

## 제한 사항 (MVP)

- 다운로드 차단은 UI/API 레벨 차단이며, 브라우저/OS 수준 캡처까지 완전 방지는 아님
- Rate limiting / WAF / bot 방어는 별도 인프라 계층에서 추가 권장

