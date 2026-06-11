# DocFlow

정책형 PDF 공유 + 페이지 단위 열람 분석 SaaS.
Polaris Design System 기반의 owner 대시보드와, 토큰만으로 접근하는 viewer 페이지를 제공합니다.

인증은 **Supabase Auth (이메일/비밀번호)** 만 사용합니다 — M365 / SSO 연결 없음.

---

## 무엇을 할 수 있나요

### Owner (로그인 사용자)

- **팀 / 워크스페이스 + 역할(RBAC)**: 모든 콘텐츠·링크·데이터룸·분석을 **워크스페이스 단위로 공유**. 토큰 **초대 링크**로 멤버 초대(이메일 인프라 불필요) → `owner`/`admin`/`member` 역할, 워크스페이스 전환·생성·이름변경, 멤버 역할 변경·제거·나가기(마지막 소유자 보호). 상단 워크스페이스 표시 + `팀` 탭
- **대시보드 개요**: 전체 열람 · 유니크 · 다운로드 · 거부 집계, 인기 문서, 최근 활동 피드 (워크스페이스 단위 집계)
- **콘텐츠 업로드**: PDF **여러 개 한 번에**(파일당 최대 50MB), XHR 일괄 진행률 표시
- **링크 발급**: 파일 단위 또는 **데이터룸**(여러 문서 묶음) 단위
- **데이터룸**: 폴더 계층으로 정리(**실사 인덱스 번호 1, 1.1… 자동 표시**), **드래그(또는 ▲▼)로 파일 순서 변경**, **뷰어 그룹별 폴더 권한**(그룹마다 보이는 폴더를 다르게 개방), 룸 단위 통계 롤업 + **엔게이지먼트**(문서별 인기 · **방문자×문서 매트릭스** · NDA 서명 기록 · 최근 활동), **접근 일괄 제어**(딜 종료 시 모든 링크 원클릭 차단/해제 — 발급된 접근 쿠키도 즉시 무효화)
- **링크 정책** (링크별): 활성/비활성, 만료일, 최대 조회수, 1회성, 이메일 요구(**서버측 형식 검증**), 허용 도메인, 비밀번호(**4자 이상**), 다운로드 허용/차단, 워터마크, **NDA/동의 게이트**(클릭랩 — 서명 이름·시각을 감사 기록). 링크 상세에 **적용 중인 정책 요약** 표시
- **오너 미리보기**: 링크 상세의 `미리보기` — 15분 서명 토큰으로 뷰어 화면을 그대로 확인하되 **게이트(이메일/비밀번호/NDA) 우회 + 조회수/유니크/체류/이벤트 무집계 + max_views·1회성 슬롯 미소진** (비활성·만료 링크도 미리보기 가능)
- **링크 라이프사이클**: 수정 / 소프트 삭제 / 휴지통 복구 / 영구 삭제
- **파일 요청**: 공개 요청 링크(`/r`)로 외부에서 파일을 **수신**(공유의 역방향), 이메일 요구 · 만료 · 최대 업로드 수, 도착 시 알림
- **커스텀 브랜딩(화이트라벨)**: 로고 · 브랜드 색상 · 회사명 · **커버 이미지**를 계정 전역 + **데이터룸별**로 설정(필드 단위 병합) → 공개 화면에서 DocFlow 표기 숨김
- **데이터룸 Q&A**: 열람자가 남긴 질문을 룸 페이지에서 확인 · 답변 · 삭제 (방문자는 본인 스레드만 비공개로 열람)
- **연락처**: 이메일을 제출한 모든 방문자를 링크 전반에서 롤업
- **분석**: 링크별 view / unique(세션 기준) / **평균 체류 시간** / download / denied, denied 사유 집계, **페이지별 dwell heatmap + 완독률**(첫 열람자가 보고한 `page_count` 기준, 미열람 페이지는 0행으로 표시), 일별 추세(타임존 설정 가능), 방문자별 롤업(**완독률·디바이스·국가** 컬럼), **국가별 열람**(플랫폼 geo 헤더의 2자리 코드만 저장 — 원본 IP 미저장), 이벤트 로그. **봇/링크 프리뷰 크롤러는 조회수·거부 집계에서 제외**, 열람 수는 세션당 30분 윈도우로 dedup
- **자동화**: MCP API 키 발급/비활성화, 이벤트 웹훅 구독 + HMAC 서명, **Microsoft Teams 알림**(Adaptive Card) — 구독 이벤트에 `file_uploaded` · `question_asked` 포함
- **계정 관리**: 비밀번호 재설정, 자가 계정 삭제 (스토리지 + DB 캐스케이드 정리)

### Viewer (비로그인)

- 공유 링크 접근 → 정책 평가 → PDF 열람. **NDA 동의가 필요한 링크는 이름 서명 + 동의 후 열람**
- **데이터룸 링크**: 좌측 폴더 트리(실사 인덱스 번호 + **문서 검색**)로 여러 문서 탐색(그룹 권한에 따라 보이는 폴더 제한), **그 자리에서 질문 남기기**(본인 세션 스레드만 비공개 확인)
- **화이트라벨 화면**: 소유자가 브랜딩을 설정하면 로고 · 색상 · 회사명 · 커버 이미지로 표시(DocFlow 숨김)
- **페이지 단위 watermark** (이메일/시간/페이지 번호) — 캡처 추적용, 링크별 표시/숨김 토글
- 진행형 로딩 — PDF.js Range 요청 + 페이지 가상화 (±2 페이지만 렌더)
- **페이지별 dwell 추적** (스크롤/이탈 시점 batched POST)
- **파일 요청(`/r`)**: 외부 사용자가 파일 업로드 (이메일 요구 시 입력)
- 다운로드 허용 링크에서만 다운로드 가능

---

## 기술 스택

- **Frontend / Backend**: Next.js 15 (App Router, RSC, TypeScript)
- **UI**: Polaris Design System v0.8.0-rc.9 (`@polaris/ui`, `@polaris/lint`)
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
- `ANALYTICS_TIMEZONE` — 일별 열람 추세의 날짜 버킷 기준 IANA 타임존 (예: `Asia/Seoul`). 미설정/잘못된 값이면 UTC.

### 3) Supabase 마이그레이션 실행

Supabase SQL Editor에서 `supabase/migrations/`의 SQL을 **001부터 041까지 순서대로** 실행합니다. (앱은 데이터룸 폴더·뷰어 그룹·NDA 동의·연락처/대시보드 집계·파일 요청·커스텀 브랜딩(계정+데이터룸별·로고+커버)·데이터룸 Q&A·파일/폴더 순서변경 RPC·**팀/워크스페이스(RBAC)** 기능에 018~034를 사용하므로 빠짐없이 적용해야 합니다. 022~034는 앱이 새 테이블·컬럼·RPC·버킷을 조회하므로 코드 배포보다 먼저 적용해야 합니다. **032~034는 워크스페이스 마이그레이션으로, 기존 사용자마다 개인 워크스페이스를 백필하므로 한 번만 안전하게 적용됩니다.**)

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
| 017 | 열람 분석 보강: `share_links.open_count`(총 열람), 페이지별 열람자수(`get_per_page_stats.viewers`), 일별 추세(`get_link_daily_views`) |
| 018 | Teams 알림 대상(`destination_type`), 클릭랩 NDA 게이트(`require_agreement`/`agreement_text`/`agreement` 이벤트), 방문자 분석(`get_link_visitors`) |
| 019 | 데이터룸 폴더 계층(`folders` 트리 + `collection_files.folder_id`) + 뷰어 번들 폴더 반환 |
| 020 | 계정 단위 집계 RPC (`get_owner_overview`/`get_owner_top_documents`/`get_owner_contacts`) |
| 021 | 리뷰 fix: `agreement` 구독 허용, 연락처 index, 지표 보정(방문자 페이지·연락처 문서수), 룸 distinct unique RPC, folders/collection_files 동일컬렉션 RLS |
| 022 | 데이터룸 Phase 3: 뷰어 그룹(`viewer_groups`/`viewer_group_folders`) + `share_links.viewer_group_id`, 그룹 폴더 closure로 필터하는 `get_viewer_link_bundle` 재작성 + `link_can_view_file` RPC, `bump_policy_version`에 `viewer_group_id` 반영 |
| 023 | 파일 요청(inbound 업로드): `file_requests`/`file_request_uploads` + owner RLS, `request-uploads` 비공개 버킷(문서 전반 MIME), `file_uploaded` 구독 이벤트, 업로드 카운트 트리거. 알림은 outbox가 아닌 직접 디스패치(`lib/notify/file-upload.ts`, 무재시도) |
| 024 | 리뷰 하드닝: `pending_storage_deletions.bucket`(버킷별 스위퍼), 공유 closure 함수 `viewer_group_folder_closure`(get_viewer_link_bundle/link_can_view_file 재사용), 원자적 업로드 한도 `claim_file_request_upload`(`FOR UPDATE`) |
| 025 | 커스텀 브랜딩(화이트라벨): `owner_branding`(company_name/brand_color/logo_path) + owner RLS, `owner-logos` **공개** 버킷(이미지 2MB). 공개 뷰어(/v)·파일요청(/r) 페이지가 소유자 로고·색상·회사명을 표시하고 브랜딩 설정 시 DocFlow 표기를 숨김 |
| 026 | 데이터룸별 브랜딩: `collection_branding`(collection_id PK + owner RLS, owner-logos 버킷 재사용). 데이터룸 링크 뷰어는 룸 브랜딩이 계정 브랜딩 위에 **필드 단위 병합**(룸이 비운 항목은 계정 상속). 데이터룸 생성은 빈 룸(이름만) → 룸 페이지에서 파일·폴더 추가/제거 |
| 027 | 커버 이미지 브랜딩: `owner_branding`·`collection_branding`에 `cover_image_path` 컬럼 추가(로고와 동일 패턴·필드 단위 병합·owner-logos 버킷 재사용). 공개 **랜딩** 화면(뷰어 접근 게이트·빈 데이터룸·파일 요청)에 가로형 커버 배너 표시 + 링크 미리보기(OG) 이미지. 풀스크린 PDF 뷰어에는 미표시 |
| 028 | 데이터룸 Q&A(Phase 4): `data_room_questions`(collection_id/link_id SET NULL/owner_id/session_id/asker_email/body/answer + owner RLS, **인증 insert 없음** — 방문자 질문은 service-role). 뷰어는 데이터룸 링크에서 질문을 남기고 **본인 세션 스레드만**(비공개) 확인, 소유자는 룸 페이지에서 전체 질문 확인·답변·삭제. `question_asked` 구독 이벤트(Teams/webhook, outbox 아닌 직접 디스패치 `lib/notify/question.ts`) 추가 |
| 029 | 데이터룸 파일 순서변경 RPC `reorder_collection_files`(collection·owner 스코프, `unnest … with ordinality`로 0-based `sort_order` 일괄 갱신). **UPDATE 전용**이라 동시 삭제된 멤버를 되살리지 않고(업서트 INSERT 경로 제거), 원자적·단일 왕복. 코드리뷰 후속 수정 |
| 030 | 파일 요청 업로드 2단계 커밋: `file_request_uploads.confirmed_at`(+ 기존 row backfill·미확정 partial index). 업로드 라우트가 Storage 저장 성공 후에만 confirm → 소유자 목록은 confirmed만 노출, 디스패치 cron이 1시간 지난 **미확정 고아 row 정리**(트리거가 `upload_count` 복구). insert↔Storage 사이 크래시로 생기던 빈 row + 한도 소진 방지 |
| 031 | 데이터룸 **폴더** 순서변경 RPC `reorder_folders`(collection·owner 스코프, UPDATE 전용·원자적 — 029의 폴더판). 룸 페이지 폴더 헤더의 ▲▼ 버튼으로 형제 폴더 순서 변경 |
| 032 | **팀/워크스페이스 Phase A**(추가 전용): `workspaces`·`workspace_members`(역할 enum owner/admin/member) + `is_workspace_member`/`has_workspace_role` SECURITY DEFINER 헬퍼. 15개 테넌트 테이블에 `workspace_id`(nullable·FK·인덱스) 추가 + **기존 사용자마다 개인 워크스페이스 생성·owner 멤버십·모든 행 백필**. RLS·앱 불변 → 무중단 |
| 033 | **팀/워크스페이스 Phase C**(추가 전용): 15개 테이블에 멤버십 SELECT 정책 추가 → `SELECT = owner_id=auth.uid() OR is_workspace_member(workspace_id)`(읽기를 넓히기만 함, 깨지지 않음). `claim_view`의 view 이벤트에 `workspace_id` 태깅(마지막 미태깅 인서트 경로). owner 쓰기 정책·012 교차소유 체크는 방어층으로 유지(앱은 service-role admin 클라이언트로 씀) |
| 034 | **팀/워크스페이스 Phase D**: `workspace_invitations`(토큰 초대 링크 + admin RLS) + 워크스페이스 단위 분석 RPC `get_workspace_overview`/`get_workspace_top_documents`/`get_workspace_contacts`(020의 워크스페이스판) |
| 035 | 워크스페이스 하드닝: 15개 테넌트 테이블 `workspace_id` **NOT NULL** + owner 정책 폐기 → `ws_read_*`/`ws_insert_*` 등 워크스페이스 정책으로 교체, reorder RPC를 workspace 스코프로, 원자적 `accept_workspace_invitation` |
| 036 | 하드닝 후속: `claim_file_request_upload`의 workspace 태깅(035 NOT NULL로 인한 업로드 중단 수정), `accept_workspace_invitation` grant 잠금, service-role 전용 테이블(link_events 등)의 authenticated 쓰기 정책 제거, cascade 삭제 RPC workspace 스코프 |
| 037 | 리뷰 후속: 원자적 개인 워크스페이스 생성(`ensure_personal_workspace`, advisory lock), 멤버 쓰기 정책(`ws_insert/update/delete_*`) 전면 제거(서비스롤만 쓰기) |
| 038 | **P0 회귀 수정**: 033이 `claim_view`를 재정의하며 007의 **세션 dedup**과 **service_role 전용 grant**를 되돌렸던 것을 복구(033의 workspace 태깅은 유지). dedup/ingest 검사용 partial index `(link_id, session_id) where event_type='view'` 추가. **분석 정확도+정책(max_views/one_time)+보안이 걸린 수정 — 코드 배포 전 필수 적용** |
| 039 | 분석 보강 2: `files.page_count`(첫 열람자가 보고 → 완독률), `link_events.country`(geo 헤더 2자리, `claim_view`에 `p_country`), `get_link_visitors` 수정(데이터룸 페이지 수를 `(file_id, page_number)`로 집계 + country/last_user_agent 반환), `get_link_daily_views` 단일 스캔 재작성 + `p_tz`, `get_workspace_top_documents`에 `p_days`(기본 30일), 신규 `get_link_engagement`(평균 체류)/`get_link_country_breakdown` |
| 040 | page_view **컴팩션**: 90일 지난 page_view 행을 세션 grain rollup(`page_view_rollups`)으로 압축·삭제하는 `compact_page_view_events`(배치 제한, dispatch cron에서 호출). 페이지 신호를 읽는 RPC(`get_per_page_stats`/`get_link_visitors`/`get_link_engagement`/`get_workspace_top_documents`/`get_workspace_contacts`)를 raw ∪ rollup으로 재정의 — distinct 세션 지표는 세션 grain 덕에 **정확도 손실 없음**. 감사 이벤트(view/download/denied/agreement)는 컴팩션 대상 아님 |
| 041 | **데이터룸 인사이트**: `get_collection_file_engagement`(룸 전체 링크 기준 문서별 열람자·체류·다운로드·최근 활동) + `get_collection_visitor_matrix`(방문자×문서 셀, 최근 방문자 N명) — 040 rollup union 패턴으로 컴팩션 후에도 정확. NDA 로그·최근 활동은 기존 link_events 쿼리 |

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
  page.tsx                       # 랜딩 (getOwner → 로그인 시 대시보드 CTA + 아바타)
  login|signup|forgot|reset      # 인증 페이지
  dashboard/                     # owner shell (PolarisProvider 여기서만) — 6탭 IA
    page.tsx                     # 대시보드 개요 (집계 + 인기 문서 + 최근 활동)
    files                        # 콘텐츠: 업로드 + 파일 브라우저
    files/[fileId]               # 파일 상세 + 링크 관리
    collections                  # 데이터룸 목록 + 빈 룸 생성
    collections/[collectionId]   # 룸: 파일/폴더 구성 · 순서변경 · 그룹 · 브랜딩 · Q&A · 링크
    collections/[id]/(logo|cover)# 룸 브랜딩 이미지 업로드 라우트
    links/[linkId]               # 링크 분석 + 정책 요약 + 페이지 heatmap
    links/[linkId]/preview       # 오너 미리보기 (서명 토큰 발급 → /v 리다이렉트)
    contacts                     # 연락처 (이메일 제출 방문자 롤업)
    requests / requests/[id]     # 파일 요청 목록 + 상세(수신 파일)
    automations                  # MCP 키 + webhook/Teams 구독
    team                         # 팀/워크스페이스: 멤버·역할·초대 링크·전환·생성
    settings                     # 브랜딩(계정) · 비밀번호 · 계정 삭제
    (logo|cover)                 # 계정 브랜딩 이미지 업로드 라우트
    trash                        # 휴지통 (복구 / 영구 삭제)
    upload                       # POST 핸들러 (XHR으로 업로드)
  v/[token]/page.tsx             # viewer (정책·NDA·그룹 평가 → PdfViewer + 사이드바 Q&A)
  r/[token]/page.tsx + upload    # 파일 요청 공개 페이지 + 익명 업로드 라우트
  invite/[token]/page.tsx        # 워크스페이스 초대 수락 (로그인 후 참여)
  api/
    v/[token]/(document|download|event)  # Range 스트리밍 / 다운로드 / page_view ingest
    owner/files                  # 페이지네이션/검색되는 파일 picker API
    owner/request-uploads/[id]   # 소유자용 수신 파일 다운로드(서명 URL)
    automation/dispatch          # webhook outbox + 스토리지 정리 cron
    mcp                          # MCP JSON-RPC 엔드포인트

middleware.ts                    # /dashboard, /auth, /v, /r 등에만 적용 — asset 제외
                                 # /v/* · /r/* 는 viewer cookie만 회전, supabase.auth 호출 안 함
```

---

## MCP 사용 방법

1. 대시보드 `자동화` 탭에서 MCP API 키 생성
2. Agent가 `/api/mcp` 호출 시 헤더 추가:

```http
Authorization: Bearer <MCP_API_KEY>
```

지원 RPC: `initialize`, `tools/list`, `tools/call`

주요 Tools (MCP·REST 공통 — 같은 `lib/api/operations.ts` 구현 공유):
- `workspace.info` — 키 컨텍스트(워크스페이스·라벨·스코프) 확인. **에이전트 첫 호출 권장**
- `files.upload` / `list` / `get`(+서명 다운로드 URL) / `delete`
- `links.list` / `get` / `create` / `update` / `delete`(휴지통) / `restore` / `hardDelete` / `preview`(오너 미리보기 URL)
- `collections.list` / `get`(폴더+파일 포함) / `create` / `update` / `delete` / `addFiles` / `removeFile`
- `requests.list` / `create` / `uploads`
- `questions.list` / `answer` / `delete`
- `contacts.list`
- `analytics.summary`(+체류·국가) / `events`(+페이지·체류·국가 컬럼) / `visitors` / `pages` / `daily`
- `automations.subscribe` / `list` / `unsubscribe`

링크 생성·수정은 NDA 게이트(`requireAgreement`/`agreementText`)와 뷰어 그룹(`viewerGroupId`)까지 — 대시보드와 동일한 정책 표면을 커버합니다. MCP 게이트웨이는 `notifications/*`(202 무응답)·`ping`·클라이언트 protocolVersion 협상을 지원합니다.

---

## REST API (`/api/v1`)

MCP가 AI 에이전트용이라면, REST는 Zapier·Make·스크립트·SDK 등 전통적 통합용입니다. **동일한 API 키·스코프**(자동화 탭에서 발급)로 인증하고, MCP와 **같은 오퍼레이션 구현**(`lib/api/operations.ts`)을 공유합니다 — 한 곳만 고치면 양쪽에 반영됩니다.

```http
Authorization: Bearer <API_KEY>
```

- **OpenAPI 3.0 스펙**: `/api/v1/openapi.json` (Postman/Insomnia import·SDK 생성)
- **인터랙티브 문서(Swagger UI)**: `/api/v1/docs`
- 엔드포인트: `GET /workspace` · `GET/POST /files` · `GET/DELETE /files/{id}` · `GET/POST /links` · `GET/PATCH/DELETE /links/{id}`(`?permanent=true` 영구 삭제) · `POST /links/{id}/restore` · `GET /links/{id}/preview` · `GET/POST /collections` · `GET/PATCH/DELETE /collections/{id}` · `POST /collections/{id}/files` · `DELETE /collections/{id}/files/{fileId}` · `GET/POST /requests` · `GET /requests/{id}/uploads` · `GET /questions` · `PATCH/DELETE /questions/{id}` · `GET /contacts` · `GET /analytics/summary|events|visitors|pages|daily` · `GET/POST /automations` · `DELETE /automations/{id}`
- 에러는 `{ error: { code, message } }` + 적절한 HTTP 상태. 레이트리밋은 MCP와 동일 버킷.

---

## 이벤트 자동화 (Webhook)

- 모든 `link_events` 기록은 `automation_event_outbox`에 큐잉되어 비동기 전달됩니다 (QStash 즉시 kick + cron 백스톱).
- `file_uploaded` · `question_asked` · `question_answered` · `request_created` · `member_invited` · `member_joined` · `member_removed`는 link_event가 아니라서 outbox를 타지 않고 **직접 디스패치**됩니다 (`lib/notify/dispatch.ts` 공유 — 동일한 Teams 포맷터 + HMAC 서명 + SSRF 가드 재사용, best-effort·무재시도). 워크스페이스 라이프사이클 이벤트(`member_*` · `request_created` · `question_answered`)는 **워크스페이스 단위로 스코프**됩니다(`lib/notify/workspace-events.ts`) — 한 멤버가 만든 구독이라도 워크스페이스의 해당 이벤트를 모두 받습니다.
- 디스패처: `/api/automation/dispatch` (Vercel cron)
- `AUTOMATION_CRON_SECRET` 또는 `CRON_SECRET` 설정 시 Bearer 인증 강제
- 시크릿 미설정 시 본 서비스는 정상 동작, **자동화 전달만 비활성화**

각 webhook 페이로드에는 HMAC 서명 헤더가 포함되어 수신 측에서 검증 가능합니다. Teams 대상은 Adaptive Card(시크릿 URL이 인증)로 전송됩니다.

---

## 데이터베이스 요약

**테이블**:
- `workspaces`, `workspace_members`(역할 owner/admin/member), `workspace_invitations` (팀/워크스페이스 — RBAC 테넌시 루트)
- `files`, `share_links`, `link_events`, `page_view_rollups` (90일 지난 page_view의 세션 grain 압축본)
- `collections`, `collection_files`, `folders` (데이터룸 폴더 트리)
- `viewer_groups`, `viewer_group_folders` (그룹별 폴더 권한)
- `file_requests`, `file_request_uploads` (파일 요청 — inbound)
- `owner_branding`, `collection_branding` (화이트라벨 — 계정/룸, 로고+커버)
- `data_room_questions` (데이터룸 Q&A)
- `mcp_api_keys`
- `automation_subscriptions`, `automation_event_outbox`, `automation_deliveries`
- `pending_storage_deletions` (스토리지 정리 큐 — 버킷별)

**버킷**: `pdf-files`(비공개), `request-uploads`(비공개·문서 전반 MIME), `owner-logos`(**공개**·이미지 2MB — 로고/커버)

**핵심 RPC** (security definer, service_role 전용):
- `claim_view` — 원자적 view 카운트 + dedup (session 기준)
- `claim_file_request_upload` — 원자적 max_uploads 한도 검사 + 삽입 (`FOR UPDATE`)
- `delete_file_cascade` / `delete_collection_cascade` / `hard_delete_link`
- `get_viewer_link_bundle` — 토큰 → 링크+파일/컬렉션(+그룹 폴더 closure) 한 번에
- `link_can_view_file` / `viewer_group_folder_closure` — 그룹 권한 검증 + 공유 closure
- `reorder_collection_files` — 데이터룸 파일 순서 일괄 갱신 (UPDATE 전용·원자적)
- `get_per_page_stats` / `get_link_unique_views` / `get_collection_unique_views` — DB 쪽 집계 (페이지 신호는 raw ∪ rollup)
- `get_link_engagement` / `get_link_country_breakdown` / `get_link_visitors` / `get_link_daily_views` — 링크 상세 분석 (평균 체류·국가·방문자·일별 추세)
- `compact_page_view_events` — page_view → rollup 컴팩션 (dispatch cron, 배치 제한)
- `get_owner_overview` / `get_owner_top_documents` / `get_owner_contacts` — 계정 단위 집계
- `get_workspace_overview` / `get_workspace_top_documents` / `get_workspace_contacts` — 워크스페이스 단위 집계
- `is_workspace_member` / `has_workspace_role` — 워크스페이스 멤버십·역할 검사 (RLS 정책 + 앱 컨텍스트에서 사용)
- `claim_event_outbox_jobs` — webhook 디스패처용 atomic claim

**핵심 Index**:
- `idx_share_links_file_active`, `idx_share_links_collection_active`
- `idx_link_events_link_created`, `idx_link_events_owner_file_page_view`
- `idx_files_owner_created`

**보장**:
- **워크스페이스 멤버십 기준 RLS 멀티테넌시 격리**: 읽기는 `is_workspace_member(workspace_id)` SELECT 정책(032 백필 + 033 additive), 쓰기는 service-role admin 클라이언트가 `workspace_id`로 스코프(액션은 `requireWorkspace`로 현재 워크스페이스+역할 해석). owner 단위 정책은 방어층으로 유지(cross-owner 부모 소유권 검증 포함)
- 이벤트 카운터는 트리거가 아닌 RPC에서 원자적으로 처리
- 부모(파일/컬렉션) 삭제는 자식 활성 링크가 없을 때만 허용

---

## 보안 / 프라이버시

- **공유 토큰**: 32-byte 랜덤 (base64url)
- **PDF 원본**: private bucket, 서명된 URL을 짧은 TTL로 발급해 viewer 라우트가 fetch + stream
- **Grant cookie / Recovery cookie**: HMAC-SHA256 서명, `policy_version`/`user.id` fingerprint로 정책 변경 시 자동 무효화
- **미리보기 토큰**: 링크 스코프 HMAC 서명 + 15분 만료, 대시보드 인증 라우트에서만 발급. grant 쿠키와 서명 도메인 분리("preview." prefix)로 상호 재사용 불가
- **IP**: HMAC(`IP_HASH_SALT`) 해시로만 저장. 위치는 플랫폼 geo 헤더(`x-vercel-ip-country`)의 **국가 코드 2자리만** view 이벤트에 기록 — 원본 IP로부터 직접 유도하지 않음
- **이메일**: 정책이 요구할 때만 viewer로부터 수집
- **봇/크롤러**: 링크 프리뷰·메일 스캐너 UA는 문서 바이트 차단 + 분석(조회수/거부) 제외. UA 위장은 위장한 쪽만 손해(정책 집행은 이 판별을 신뢰하지 않음)
- **다이내믹 watermark**: viewer 화면에 이메일/시간/페이지 번호 타일링 (스크린샷 추적용)

---

## 성능 특성

- `/v/[token]` 초기 표시: PDF.js가 trailer만 Range 요청으로 받고 페이지별 progressive 로딩
- viewer 라우트는 supabase storage `download()` 대신 사이닝된 URL `fetch()`로 streaming — Node 메모리에 전체 PDF를 적재하지 않음
- 페이지 dwell 이벤트는 8개 단위 또는 8초 간격으로 batched POST — **가장 잘 보이는 페이지 1곳에만** 시간을 적립(activePage 전환 시점 기록, 슬라이드 더블카운트 없음), 세그먼트당 10분 캡
- page_view ingest의 "view 클레임 여부" 검사는 Redis claim 마커를 재사용(히트 시 Postgres 왕복 없음), 일별 추세 RPC는 단일 range scan
- 90일 지난 page_view 행은 cron이 세션 grain rollup으로 압축(테이블 성장 억제, distinct 지표 정확도 유지)
- 대시보드 파일 목록은 서버 페이지네이션 + ILIKE 검색 (URL state)
- 미들웨어는 `/dashboard`, `/auth`, `/v`, `/r`, 인증 페이지에만 매칭 — 랜딩과 정적 자산은 우회
- 랜딩 페이지는 로그인 상태 분기(대시보드 CTA·아바타)를 위해 per-request 렌더 — `getOwner` 세션 조회 1회(미들웨어는 여전히 우회)
- `PolarisProvider`는 dashboard layout 내부로 스코프 (랜딩/뷰어/인증은 client provider 비포함)
- PdfViewer는 `next/dynamic` + `ssr:false`, ±2 페이지 윈도우 가상화

---

## MVP 한계

- 다운로드 차단은 UI/API 레벨 — OS/브라우저 캡처/스크린레코더까지 완전 차단 불가
- Rate limiting / WAF / 고급 봇 방어는 인프라 계층에서 별도 구성 필요
- 이메일 발송 (비밀번호 재설정, 계정 확인)은 Supabase Auth 내장 메일러 사용 — 커스텀 SMTP 필요 시 Supabase 프로젝트 설정에서 구성

---

## 향후 로드맵

### P1 — 수익화 / 확장
- ✅ **팀 / 워크스페이스 + 역할(RBAC)** — **완료** (마이그레이션 032~034): owner 단위 RLS를 워크스페이스 멤버십으로 재설계, 토큰 초대 링크, owner/admin/member 역할, 워크스페이스 단위 분석·스코핑
- **빌링 (Stripe)**: 워크스페이스 = 빌링 엔티티 → 구독/요금제/시트 연동 (다음 P1)

### P2 — 프리미엄 / 견고성
- **파일 요청 업로드 원자성**: DB row ↔ Storage 사이 크래시 대비 — `pending→ready` 상태 또는 고아 row 정리 cron
- **커스텀 도메인**: 화이트라벨 완성 (브랜드 도메인으로 `/v` · `/r` 서빙)
- **멀티포맷 업로드**: PPT · Word · 이미지 (현재 뷰어는 react-pdf 전용)
- **이메일 인프라 (Resend)**: 알림 · 리포트 (현재 Supabase 내장 메일러만)

### P3 — 프리미엄 / 폴리시
- **eSignature**: 서명된 NDA (현재는 클릭랩 동의만)
- **Q&A 옵션**: 공개(FAQ) 모드 · 링크/그룹별 격리 (현재 룸 단위 비공개)
- **폴더 순서 변경** (현재 파일 순서만 지원)
- **비디오 임베드 · SSO · 네이티브 통합** (Salesforce / Zapier)

### 기술 부채 / 정리
- **워크스페이스 RLS 정리** (런칭 후·비긴급): 중복 owner SELECT 정책 폐기 + 쓰기 정책을 `has_workspace_role`로 전환(012 부모 검증은 cross-workspace로) + 백필·태깅 완료 후 `workspace_id` NOT NULL. 앱은 service-role admin으로 쓰므로 방어층일 뿐
- `listViewerQuestions` per-render 읽기 캐싱/지연
- 공개 브랜딩 버킷 SVG 허용 정책 결정
- 자동화 cron 빈도 (Hobby 1일 1회 → Pro 상향)

---

## 개발 노트

- `npm run lint` — Next.js ESLint
- `npm run lint:polaris` — Polaris Design 토큰/컴포넌트 사용 검증 (warning 0 강제)
- `npm run check:supabase-auth` — Supabase Auth 환경변수 sanity check
- 신규 RPC 추가 시 `lib/supabase/database.types.ts`의 `Functions` 블록도 함께 갱신
