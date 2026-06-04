# DocFlow

정책형 PDF 공유 + 페이지 단위 열람 분석 SaaS.
Polaris Design System 기반의 owner 대시보드와, 토큰만으로 접근하는 viewer 페이지를 제공합니다.

인증은 **Supabase Auth (이메일/비밀번호)** 만 사용합니다 — M365 / SSO 연결 없음.

---

## 무엇을 할 수 있나요

### Owner (로그인 사용자)

- **업로드**: PDF만 (최대 50MB), XHR 진행률 표시
- **링크 발급**: 파일 단위 또는 문서 묶음(컬렉션) 단위
- **링크 정책** (링크별):
  - 활성/비활성, 만료일, 최대 조회수, 1회성
  - 이메일 입력 요구, 허용 도메인 화이트리스트, 비밀번호
  - 다운로드 허용/차단, 워터마크 표시/숨김
- **링크 라이프사이클**: 수정 / 소프트 삭제 / 휴지통 복구 / 영구 삭제
- **분석**:
  - 링크별 view / unique(세션 기준) / download / denied
  - denied 사유 집계
  - **페이지별 dwell heatmap** (page-view 이벤트 기반)
  - 이벤트 로그 (최근 100건)
- **자동화**:
  - MCP API 키 발급/비활성화
  - 이벤트 웹훅 구독 + HMAC 서명
- **계정 관리**: 비밀번호 재설정, 자가 계정 삭제 (스토리지 + DB 캐스케이드 정리)

### Viewer (비로그인)

- 공유 링크 접근 → 정책 평가 → PDF 열람
- **페이지 단위 watermark** (이메일/시간/페이지 번호) — 캡처 추적용, 링크별 표시/숨김 토글
- 진행형 로딩 — PDF.js Range 요청 + 페이지 가상화 (±2 페이지만 렌더)
- **페이지별 dwell 추적** (스크롤/이탈 시점 batched POST)
- 다운로드 허용 링크에서만 다운로드 가능

---

## 기술 스택

- **Frontend / Backend**: Next.js 15 (App Router, RSC, TypeScript)
- **UI**: Polaris Design System v0.7.3 (`@polaris/ui`, `@polaris/lint`)
- **Auth / DB / Storage**: Supabase (Postgres + RLS + storage)
- **PDF**: react-pdf 10.x (pdfjs-dist 5.4.296, worker self-hosted)
- **Validation**: zod
- **Deploy**: Vercel (cron 포함)

---

## 빠른 시작 (로컬)

### 1) 의존성 설치

```bash
npm install
```

postinstall 훅이 `react-pdf` 내장 pdfjs worker (`pdf.worker.min.mjs`)를 `/public`으로 복사합니다.
worker 버전은 항상 react-pdf가 import하는 pdfjs와 일치합니다.

### 2) 환경 변수 설정

```bash
cp .env.example .env.local
```

**필수**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (로컬: `http://localhost:3000`)
- `VIEWER_COOKIE_SECRET` (HMAC용 충분히 긴 랜덤 문자열)

**권장**:
- `IP_HASH_SALT` — 분석 로그의 IP 해시 전용 salt. 미설정 시 `VIEWER_COOKIE_SECRET`을 fallback으로 사용. 운영환경에서는 분리해서 회전 가능하게 설정.
- `AUTOMATION_CRON_SECRET` — webhook 디스패처 보호 (미설정 시 자동화 전달만 비활성화, 본 서비스는 정상 동작)

### 3) Supabase 마이그레이션 실행

Supabase SQL Editor에서 `supabase/migrations/`의 SQL을 **001부터 016까지 순서대로** 실행합니다.

| 번호 | 내용 |
|---|---|
| 001 | 핵심 스키마 (files, share_links, link_events) + RLS |
| 002 | collections / collection_files |
| 003 | MCP automation (api keys, subscriptions, outbox) |
| 004 | page_view 분석 컬럼 (page_number, dwell_ms) |
| 005 | grant cookie fingerprint 잠금 |
| 006 | 원자적 view 클레임 RPC (`claim_view`) |
| 007 | 후속 보안 검토 fix (security definer, FK 정책) |
| 008 | RPC lockdown + 원자적 단건 삭제 |
| 009 | 부모(파일/컬렉션) 원자적 삭제 RPC |
| 010 | 삭제 락 + 스토리지 정리 큐 |
| 011 | 컬렉션 잔여 링크가 있는 파일 삭제 가드 |
| 012 | cross-owner RLS 강화 (WITH CHECK + 부모 소유권 검증) |
| 013 | 성능 RPC (페이지 통계, 뷰어 번들, 이벤트 verify) + composite indexes |
| 014 | `files(owner_id, created_at desc)` index |
| 015 | 파일 검색(pg_trgm)·정렬·이벤트피드 index |
| 016 | 링크별 워터마크 토글 컬럼 (`share_links.watermark`) |

### 4) Supabase Auth

- Authentication > Providers에서 **Email** 활성화
- 빠른 테스트면 **Confirm email** 비활성화 가능 (운영환경은 활성화 권장)

### 5) 개발 서버

```bash
npm run dev
```

---

## Vercel 배포

프로젝트 환경변수에 `.env.local`의 키를 모두 등록 (`GITHUB_TOKEN` 제외 — 로컬 push 전용).

`NEXT_PUBLIC_APP_URL`을 실서비스 도메인으로 설정한 뒤 한 번 재배포해야 OG/리다이렉트 URL이 정확합니다.

### Cron

`vercel.json`에 webhook 디스패처 cron이 등록되어 있습니다:

```json
{ "path": "/api/automation/dispatch", "schedule": "0 9 * * *" }
```

Hobby 플랜 제한 대응으로 **하루 1회 (09:00 UTC)** 입니다. 더 잦은 디스패치가 필요하면 Pro 플랜으로 올린 뒤 schedule을 조정하세요.

---

## 아키텍처 한눈에

```
app/
  page.tsx                       # 정적 랜딩 (force-static, getOwner 호출 없음)
  login|signup|forgot|reset      # 인증 페이지
  dashboard/                     # owner shell (PolarisProvider 여기서만)
    page.tsx                     # 파일 브라우저 (URL 기반 페이지네이션/검색/정렬)
    files/[fileId]               # 파일 상세 + 링크 관리
    collections/[collectionId]   # 컬렉션 상세 + 링크 관리
    links/[linkId]               # 링크 분석 + 페이지 heatmap
    automations                  # MCP 키 + webhook 구독
    settings                     # 비밀번호 변경, 계정 삭제
    trash                        # 휴지통 (복구 / 영구 삭제)
    upload                       # POST 핸들러 (XHR으로 업로드)
  v/[token]/page.tsx             # viewer (정책 평가 → PdfViewer 동적 import)
  api/
    v/[token]/document           # 사이닝된 URL fetch + Range 패스스루 + claim_view
    v/[token]/download           # 사이닝된 URL fetch + download 이벤트 기록
    v/[token]/event              # batched page_view 이벤트 ingest
    owner/files                  # 페이지네이션/검색되는 파일 picker API
    automation/dispatch          # webhook outbox 처리 cron
    mcp                          # MCP JSON-RPC 엔드포인트

middleware.ts                    # /dashboard, /auth, /v 등에만 적용 — 랜딩/asset 제외
                                 # /v/* 는 viewer cookie만 회전, supabase.auth 호출 안 함
```

---

## MCP 사용 방법

1. 대시보드 `자동화` 탭에서 MCP API 키 생성
2. Agent가 `/api/mcp` 호출 시 헤더 추가:

```http
Authorization: Bearer <MCP_API_KEY>
```

지원 RPC: `initialize`, `tools/list`, `tools/call`

주요 Tools:
- `docflow.files.upload` — PDF base64 업로드
- `docflow.files.list`
- `docflow.links.list` / `create` / `update`
- `docflow.analytics.summary` / `events`
- `docflow.automations.subscribe` / `list` / `unsubscribe`

---

## 이벤트 자동화 (Webhook)

- 모든 `link_events` 기록은 `automation_event_outbox`에 큐잉되어 비동기 전달됩니다.
- 디스패처: `/api/automation/dispatch` (Vercel cron)
- `AUTOMATION_CRON_SECRET` 또는 `CRON_SECRET` 설정 시 Bearer 인증 강제
- 시크릿 미설정 시 본 서비스는 정상 동작, **자동화 전달만 비활성화**

각 webhook 페이로드에는 HMAC 서명 헤더가 포함되어 수신 측에서 검증 가능합니다.

---

## 데이터베이스 요약

**테이블**:
- `files`, `share_links`, `link_events`
- `collections`, `collection_files`
- `mcp_api_keys`
- `automation_subscriptions`, `automation_event_outbox`, `automation_deliveries`
- `pending_storage_deletions` (스토리지 정리 큐)

**핵심 RPC** (security definer, service_role 전용):
- `claim_view` — 원자적 view 카운트 + dedup (session 기준)
- `delete_file_cascade` / `delete_collection_cascade` / `hard_delete_link`
- `get_viewer_link_bundle` — 토큰 → 링크+파일/컬렉션 한 번에
- `get_link_for_event` — page_view 검증용 경량 RPC
- `get_per_page_stats` / `get_link_unique_views` — DB 쪽 집계
- `claim_event_outbox_jobs` — webhook 디스패처용 atomic claim

**핵심 Index**:
- `idx_share_links_file_active`, `idx_share_links_collection_active`
- `idx_link_events_link_created`, `idx_link_events_owner_file_page_view`
- `idx_files_owner_created`

**보장**:
- Owner 기준 RLS 멀티테넌시 격리 (cross-owner 부모 소유권 검증 포함)
- 이벤트 카운터는 트리거가 아닌 RPC에서 원자적으로 처리
- 부모(파일/컬렉션) 삭제는 자식 활성 링크가 없을 때만 허용

---

## 보안 / 프라이버시

- **공유 토큰**: 32-byte 랜덤 (base64url)
- **PDF 원본**: private bucket, 서명된 URL을 짧은 TTL로 발급해 viewer 라우트가 fetch + stream
- **Grant cookie / Recovery cookie**: HMAC-SHA256 서명, `policy_version`/`user.id` fingerprint로 정책 변경 시 자동 무효화
- **IP**: HMAC(`IP_HASH_SALT`) 해시로만 저장
- **이메일**: 정책이 요구할 때만 viewer로부터 수집
- **다이내믹 watermark**: viewer 화면에 이메일/시간/페이지 번호 타일링 (스크린샷 추적용)

---

## 성능 특성

- `/v/[token]` 초기 표시: PDF.js가 trailer만 Range 요청으로 받고 페이지별 progressive 로딩
- viewer 라우트는 supabase storage `download()` 대신 사이닝된 URL `fetch()`로 streaming — Node 메모리에 전체 PDF를 적재하지 않음
- 페이지 dwell 이벤트는 8개 단위 또는 8초 간격으로 batched POST
- 대시보드 파일 목록은 서버 페이지네이션 + ILIKE 검색 (URL state)
- 미들웨어는 `/dashboard`, `/auth`, `/v`, 인증 페이지에만 매칭 — 랜딩과 정적 자산은 우회
- 랜딩 페이지는 `force-static` (per-request 세션 조회 없음)
- `PolarisProvider`는 dashboard layout 내부로 스코프 (랜딩/뷰어/인증은 client provider 비포함)
- PdfViewer는 `next/dynamic` + `ssr:false`, ±2 페이지 윈도우 가상화

---

## MVP 한계

- 다운로드 차단은 UI/API 레벨 — OS/브라우저 캡처/스크린레코더까지 완전 차단 불가
- Rate limiting / WAF / 고급 봇 방어는 인프라 계층에서 별도 구성 필요
- 이메일 발송 (비밀번호 재설정, 계정 확인)은 Supabase Auth 내장 메일러 사용 — 커스텀 SMTP 필요 시 Supabase 프로젝트 설정에서 구성

---

## 개발 노트

- `npm run lint` — Next.js ESLint
- `npm run lint:polaris` — Polaris Design 토큰/컴포넌트 사용 검증 (warning 0 강제)
- `npm run check:supabase-auth` — Supabase Auth 환경변수 sanity check
- 신규 RPC 추가 시 `lib/supabase/database.types.ts`의 `Functions` 블록도 함께 갱신
