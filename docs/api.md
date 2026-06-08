# DocFlow API 가이드

DocFlow의 콘텐츠·공유 링크·데이터룸·분석·자동화를 외부에서 다루기 위한 개발자 문서입니다.
두 가지 표면이 **같은 로직(`lib/api/operations.ts`)**을 공유합니다.

| 표면 | 경로 | 용도 |
|---|---|---|
| **REST** | `/api/v1/*` | Zapier·Make·n8n·스크립트·SDK 등 전통적 통합 |
| **MCP** (JSON-RPC) | `/api/mcp` | AI 에이전트(Claude 등) |

> 머신리더블 스펙: **`/api/v1/openapi.json`** (OpenAPI 3.0) · 인터랙티브 문서: **`/api/v1/docs`** (Swagger UI)

이 문서의 예시는 `https://<YOUR_DOCFLOW_HOST>`를 베이스로 씁니다 — 실제 호스트는 `/api/v1/openapi.json`의 `servers[0].url`을 확인하세요.

---

## 목차

1. [빠른 시작](#빠른-시작)
2. [인증 & 스코프](#인증--스코프)
3. [공통 규약](#공통-규약) (에러·레이트리밋·페이지네이션)
4. [엔드포인트](#엔드포인트)
   - [Files](#files-파일) · [Links](#links-공유-링크) · [Collections](#collections-데이터룸) · [Requests](#requests-파일-요청) · [Q&A](#qa-데이터룸-질문) · [Contacts](#contacts-연락처) · [Analytics](#analytics-분석) · [Automations](#automations-웹훅-구독)
5. [Webhooks](#webhooks) (이벤트·페이로드·서명 검증)
6. [MCP (에이전트용)](#mcp-에이전트용)
7. [엔드투엔드 예제](#엔드투엔드-예제)

---

## 빠른 시작

1. **API 키 발급** — 대시보드 → `자동화` 탭 → API 키 생성. 생성 시 한 번만 평문으로 노출되니 안전한 곳에 보관하세요. 키는 **발급한 워크스페이스에 묶입니다** — 모든 요청이 그 워크스페이스로 스코프됩니다.
2. **요청에 Bearer 토큰 추가:**

```bash
curl https://<YOUR_DOCFLOW_HOST>/api/v1/files \
  -H "Authorization: Bearer <API_KEY>"
```

3. 끝. REST·MCP 모두 같은 키를 씁니다.

---

## 인증 & 스코프

모든 요청은 `Authorization: Bearer <API_KEY>` 헤더가 필요합니다. 키 없음/무효 → `401`.

요청은 **키의 스코프**로 인가됩니다. 스코프가 없으면 `403 forbidden`. 기본 발급 키는 전체 스코프를 가집니다.

| 스코프 | 허용 |
|---|---|
| `files:read` | 파일·데이터룸·파일요청·Q&A·연락처 조회 |
| `files:write` | 파일 업로드, 데이터룸 생성·파일 추가/제거, Q&A 답변 |
| `links:read` | 공유 링크 조회 |
| `links:write` | 공유 링크 생성·수정·삭제 |
| `analytics:read` | 링크 분석·이벤트·연락처·Q&A 조회 |
| `automations:read` | 웹훅 구독 조회 |
| `automations:write` | 웹훅 구독 생성·삭제 |

> 엔드포인트별 필요한 스코프는 각 절의 제목 옆에 표기했습니다.

---

## 공통 규약

- **Base URL**: `https://<YOUR_DOCFLOW_HOST>/api/v1`
- **요청 본문**: `Content-Type: application/json` (POST·PATCH)
- **쿼리 파라미터**: 불리언은 `?includeDeleted=true`, 숫자는 `?limit=50` 형태로 그대로 전달
- **레이트리밋**: **API 키당 100 요청 / 1분** (sliding window). 초과 시 `429` + `Retry-After: <초>` 헤더
- **페이지네이션**: 목록은 `limit`(상한은 엔드포인트별)을 받습니다. 이벤트 조회는 커서(`afterId` → 응답의 `nextCursor`)를 씁니다.

### 에러 포맷

모든 에러는 동일한 형태입니다:

```json
{ "error": { "code": "link_not_found", "message": "link_not_found" } }
```

| HTTP | 대표 `code` | 의미 |
|---|---|---|
| `400` | `invalid_params`, `pdf_extension_required`, `invalid_base64`, `invalid_webhook_url` | 입력 오류 |
| `401` | `unauthorized` | 토큰 없음/무효 |
| `403` | `forbidden`, `no_workspace` | 스코프 부족 / 키에 워크스페이스 없음 |
| `404` | `file_not_found`, `collection_not_found`, `link_not_found`, `request_not_found`, `question_not_found` | 대상 없음(또는 다른 워크스페이스) |
| `409` | `automation_dispatcher_disabled` | 서버에 디스패처 시크릿 미설정 |
| `413` | `file_too_large` | 50MB 초과 |
| `429` | `rate_limited` | 레이트리밋 |

---

## 엔드포인트

### Files (파일)

#### `GET /files` · `files:read`
업로드된 PDF 목록.

| 파라미터 | 위치 | 타입 | 기본 | 설명 |
|---|---|---|---|---|
| `limit` | query | int(1–200) | 100 | 최대 개수 |

```bash
curl "https://<YOUR_DOCFLOW_HOST>/api/v1/files?limit=20" -H "Authorization: Bearer <API_KEY>"
```
```json
{ "files": [
  { "id": "uuid", "original_name": "pitch.pdf", "size_bytes": 482133,
    "mime_type": "application/pdf", "created_at": "2026-06-08T...", "updated_at": "2026-06-08T..." }
] }
```

#### `POST /files` · `files:write`
PDF 1개 업로드 (base64). PDF만 허용(`.pdf` 확장자 + `application/pdf` + 매직바이트 검사), 최대 50MB.

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `filename` | string | ✓ | `.pdf`로 끝나야 함 |
| `contentBase64` | string | ✓ | base64 (raw 또는 data URI) |
| `mimeType` | string | | 기본 `application/pdf` |

```bash
curl -X POST https://<YOUR_DOCFLOW_HOST>/api/v1/files \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"filename":"pitch.pdf","contentBase64":"JVBERi0xLjQ..."}'
```
```json
{ "file": { "id": "uuid", "original_name": "pitch.pdf", "size_bytes": 482133, "...": "..." },
  "dashboardUrl": "https://<host>/dashboard/files/uuid" }
```
에러: `pdf_extension_required` · `pdf_mime_required` · `invalid_base64` · `invalid_pdf_file`(400), `file_too_large`(413).

---

### Links (공유 링크)

공유 링크는 파일 1개 또는 데이터룸 1개를 가리킵니다. 응답의 `url`(`/v/<token>`)이 방문자용 링크입니다. **`password_hash`는 절대 반환하지 않으며** `has_password` 불리언으로 대체됩니다.

#### `GET /links` · `links:read`

| 파라미터 | 위치 | 타입 | 설명 |
|---|---|---|---|
| `targetType` | query | `file`\|`collection` | 대상 종류 필터 |
| `targetId` | query | string | 대상 ID 필터 |
| `includeDeleted` | query | bool | 휴지통 포함(기본 false) |
| `limit` | query | int(1–200) | 기본 100 |

```json
{ "links": [
  { "id": "uuid", "label": "투자자용", "token": "abc123", "url": "https://<host>/v/abc123",
    "is_active": true, "require_email": true, "allow_download": false, "one_time": false,
    "watermark": true, "has_password": false, "expires_at": null, "max_views": null }
] }
```

#### `POST /links` · `links:write`

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `targetType` | `file`\|`collection` | ✓ | |
| `targetId` | string | ✓ | 파일 또는 데이터룸 ID(같은 워크스페이스) |
| `label` | string | ✓ | 내부 라벨 |
| `isActive` | bool | | 기본 true |
| `expiresAt` | string(ISO) | | 만료 시각 |
| `maxViews` | int≥1 | | 최대 열람 수 |
| `requireEmail` | bool | | 이메일 게이트 (도메인 지정 시 자동 true) |
| `allowedDomains` | string[] \| string | | 허용 이메일 도메인 |
| `password` | string | | 비밀번호 게이트 |
| `allowDownload` | bool | | 다운로드 허용(기본 false) |
| `oneTime` | bool | | 1회용 |
| `watermark` | bool | | 워터마크(기본 true) |

```bash
curl -X POST https://<YOUR_DOCFLOW_HOST>/api/v1/links \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"targetType":"file","targetId":"<fileId>","label":"투자자용","requireEmail":true,"maxViews":50}'
```
응답: `{ "link": { ...redacted, "url": "https://<host>/v/<token>" } }`. 에러: `file_not_found`·`collection_not_found`(404).

#### `PATCH /links/{linkId}` · `links:write`
정책 부분 수정. 전달한 필드만 갱신. `POST /links`의 모든 필드 + `clearPassword`(true=비번 제거). `expiresAt`/`maxViews`에 `null` 전달 시 해제.

```bash
curl -X PATCH https://<YOUR_DOCFLOW_HOST>/api/v1/links/<linkId> \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"isActive":false}'
```

#### `DELETE /links/{linkId}` · `links:write`
휴지통으로 이동(소프트 삭제).
```json
{ "deleted": true, "linkId": "uuid" }
```

---

### Collections (데이터룸)

데이터룸은 여러 파일을 묶어 하나의 링크로 공유하는 단위입니다.

#### `GET /collections` · `files:read`
`limit`(1–200). 응답에 `file_count` 포함.
```json
{ "collections": [ { "id": "uuid", "name": "Series A", "description": null, "file_count": 7, "created_at": "..." } ] }
```

#### `POST /collections` · `files:write`
빈 데이터룸 생성(이름+설명). 파일은 아래 엔드포인트로 추가.

| 필드 | 타입 | 필수 |
|---|---|---|
| `name` | string | ✓ |
| `description` | string | |

응답: `{ "collection": {...}, "dashboardUrl": "..." }`

#### `POST /collections/{collectionId}/files` · `files:write`
기존 파일들을 데이터룸에 추가. 이미 포함된 파일은 무시.

| 필드 | 타입 | 필수 |
|---|---|---|
| `fileIds` | string[] | ✓ |

```bash
curl -X POST https://<YOUR_DOCFLOW_HOST>/api/v1/collections/<id>/files \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"fileIds":["<fileId1>","<fileId2>"]}'
```
응답: `{ "added": 2, "collectionId": "uuid" }`. 에러: `collection_not_found`·`file_not_found`(404, 일부라도 다른 워크스페이스면 실패).

#### `DELETE /collections/{collectionId}/files/{fileId}` · `files:write`
데이터룸에서 파일을 **언링크**(라이브러리·다른 룸의 파일은 유지).
```json
{ "removed": true, "collectionId": "uuid", "fileId": "uuid" }
```

---

### Requests (파일 요청)

방문자가 소유자에게 업로드하는 인바운드 요청(`/r/<token>`)을 조회합니다.

#### `GET /requests` · `files:read`
`limit`(1–200).
```json
{ "requests": [
  { "id": "uuid", "title": "계약서 제출", "slug": "abc", "instructions": null,
    "is_active": true, "max_uploads": 10, "allow_multiple": true, "created_at": "..." }
] }
```

#### `GET /requests/{requestId}/uploads` · `files:read`
해당 요청으로 수신된(확정된) 업로드 목록. 에러: `request_not_found`(404).
```json
{ "uploads": [
  { "id": "uuid", "request_id": "uuid", "original_name": "nda.pdf", "size_bytes": 12044,
    "uploader_email": "a@b.com", "confirmed_at": "...", "created_at": "..." }
] }
```

---

### Q&A (데이터룸 질문)

#### `GET /questions` · `analytics:read`

| 파라미터 | 위치 | 타입 | 설명 |
|---|---|---|---|
| `collectionId` | query | string | 특정 데이터룸으로 필터 |
| `limit` | query | int(1–200) | 기본 100 |

```json
{ "questions": [
  { "id": "uuid", "collection_id": "uuid", "body": "ARR이 궁금합니다",
    "answer": null, "answered_at": null, "session_id": "...", "created_at": "..." }
] }
```

#### `PATCH /questions/{questionId}` · `files:write`
질문에 답변(최대 4000자).

| 필드 | 타입 | 필수 |
|---|---|---|
| `answer` | string | ✓ |

```bash
curl -X PATCH https://<YOUR_DOCFLOW_HOST>/api/v1/questions/<id> \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"answer":"지난 분기 ARR은 ..."}'
```
응답: `{ "question": {...} }`. 답변 시 `question_answered` 웹훅이 발사됩니다. 에러: `question_not_found`(404).

---

### Contacts (연락처)

#### `GET /contacts` · `analytics:read`
이메일을 제출한 방문자를 모든 링크에 걸쳐 롤업. `limit`(1–500).
```json
{ "contacts": [ { "email": "a@b.com", "...": "집계 필드" } ] }
```

---

### Analytics (분석)

#### `GET /analytics/summary` · `analytics:read`
링크 1개의 요약 지표 + 거부 사유 분해.

| 파라미터 | 위치 | 타입 | 필수 |
|---|---|---|---|
| `linkId` | query | string | ✓ |

```json
{ "summary": { "...": "opens/uniques/downloads/..." }, "deniedBreakdown": [ { "reason": "...", "count": 3 } ] }
```
에러: `link_not_found`(404).

#### `GET /analytics/events` · `analytics:read`
원시 링크 이벤트 (커서 페이지네이션).

| 파라미터 | 위치 | 타입 | 설명 |
|---|---|---|---|
| `linkId` | query | string | 특정 링크로 필터 |
| `afterId` | query | int | 이 ID 이후(커서) |
| `limit` | query | int(1–500) | 기본 100 |

```json
{ "events": [
  { "id": 1024, "link_id": "uuid", "file_id": "uuid", "event_type": "view",
    "reason": null, "session_id": "...", "viewer_email": "a@b.com", "created_at": "..." }
], "nextCursor": 1024 }
```
다음 페이지: `?afterId=<nextCursor>`. `nextCursor`가 그대로면 끝.

---

### Automations (웹훅 구독)

#### `GET /automations` · `automations:read`
`includeInactive`(bool)로 비활성 포함. `signing_secret`은 반환하지 않고 `has_signing_secret`로 대체.

#### `POST /automations` · `automations:write`

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `name` | string | ✓ | 구독 이름 |
| `webhookUrl` | string(uri) | ✓ | 공개 HTTPS URL (SSRF 가드 적용) |
| `signingSecret` | string | | HMAC 서명용 시크릿 |
| `eventTypes` | string[] | | 구독할 이벤트(아래 목록) |
| `isActive` | bool | | 기본 true |

```bash
curl -X POST https://<YOUR_DOCFLOW_HOST>/api/v1/automations \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"name":"Slack 알림","webhookUrl":"https://hooks.example.com/x","eventTypes":["view","download"],"signingSecret":"whsec_..."}'
```
에러: `automation_dispatcher_disabled`(409, 서버에 디스패처 시크릿 미설정) · `invalid_webhook_url`(400).

#### `DELETE /automations/{id}` · `automations:write`
`{ "deleted": true, "subscriptionId": "uuid" }`

---

## Webhooks

구독을 만들면 DocFlow가 이벤트 발생 시 `webhookUrl`로 `POST` 합니다.

### 구독 가능한 이벤트

| 이벤트 | 발생 시점 | 스코프 |
|---|---|---|
| `view` | 문서 열람 성공 | 링크 |
| `download` | 다운로드 | 링크 |
| `denied` | 접근 거부 | 링크 |
| `email_submitted` | 이메일 제출 | 링크 |
| `password_failed` | 비밀번호 실패 | 링크 |
| `agreement` | NDA 동의 | 링크 |
| `file_uploaded` | 파일 요청 수신 | 소유자 |
| `question_asked` | 데이터룸 질문 등록 | 소유자 |
| `question_answered` | 질문에 답변 | **워크스페이스** |
| `request_created` | 파일 요청 생성 | **워크스페이스** |
| `member_invited` | 멤버 초대 | **워크스페이스** |
| `member_joined` | 멤버 합류 | **워크스페이스** |
| `member_removed` | 멤버 제거 | **워크스페이스** |

> 워크스페이스 스코프 이벤트는 해당 워크스페이스의 **모든 멤버 구독**에 전달됩니다.

### 페이로드

```http
POST <your webhook url>
Content-Type: application/json
x-docflow-event-type: view
x-docflow-timestamp: 2026-06-08T09:00:00.000Z
x-docflow-signature: <hex>          # signingSecret 설정 시에만
```
```json
{ "ownerId": "uuid", "subscriptionId": "uuid",
  "event": { "eventType": "view", "linkId": "uuid", "...": "이벤트별 필드" } }
```

### 서명 검증

`signingSecret`을 설정한 경우, 본문이 변조되지 않았는지 다음으로 검증하세요:

```
signature = HMAC_SHA256(secret, timestamp + "." + rawBody)   // hex
```
여기서 `timestamp`는 `x-docflow-timestamp` 헤더 값, `rawBody`는 수신한 **원시 본문 문자열**입니다. 계산값이 `x-docflow-signature`와 일치해야 합니다 (재생 공격 방지를 위해 timestamp가 최근인지도 확인).

```js
import crypto from 'node:crypto';
function verify(rawBody, headers, secret) {
  const ts = headers['x-docflow-timestamp'];
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headers['x-docflow-signature']));
}
```

> 전달은 **best-effort**입니다 — 재시도/순서 보장이 없으니, 정확성이 중요한 흐름은 주기적으로 REST `GET /analytics/events`로 보강하세요. Microsoft Teams Incoming Webhook URL을 등록하면 Adaptive Card로 전송됩니다(이 경우 서명 없음 — URL 자체가 시크릿).

---

## MCP (에이전트용)

AI 에이전트는 `/api/mcp`에서 JSON-RPC 2.0으로 같은 오퍼레이션을 호출합니다. 같은 Bearer 키를 씁니다.

지원 메서드: `initialize` · `tools/list` · `tools/call`.

```bash
curl -X POST https://<YOUR_DOCFLOW_HOST>/api/mcp \
  -H "Authorization: Bearer <API_KEY>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"docflow.files.list","arguments":{"limit":10}}}'
```

툴 이름은 REST 오퍼레이션과 1:1 대응됩니다: `docflow.files.upload`·`files.list`, `links.list`·`create`·`update`·`delete`, `collections.list`·`create`·`addFiles`·`removeFile`, `requests.list`·`requests.uploads`, `questions.list`·`questions.answer`, `contacts.list`, `analytics.summary`·`events`, `automations.subscribe`·`list`·`unsubscribe`. 전체 입력 스키마는 `tools/list`로 확인하세요.

---

## 엔드투엔드 예제

파일 업로드 → 보호된 링크 생성 → 분석 조회:

```bash
HOST=https://<YOUR_DOCFLOW_HOST>; KEY=<API_KEY>
AUTH="-H Authorization:Bearer\ $KEY -H Content-Type:application/json"

# 1) PDF 업로드
FILE_ID=$(curl -s -X POST $HOST/api/v1/files $AUTH \
  -d "{\"filename\":\"deck.pdf\",\"contentBase64\":\"$(base64 -i deck.pdf)\"}" | jq -r .file.id)

# 2) 이메일 게이트 + 50회 제한 링크 생성
LINK=$(curl -s -X POST $HOST/api/v1/links $AUTH \
  -d "{\"targetType\":\"file\",\"targetId\":\"$FILE_ID\",\"label\":\"투자자용\",\"requireEmail\":true,\"maxViews\":50}")
echo "$LINK" | jq -r .link.url     # → https://<host>/v/<token>
LINK_ID=$(echo "$LINK" | jq -r .link.id)

# 3) (방문 발생 후) 분석 조회
curl -s "$HOST/api/v1/analytics/summary?linkId=$LINK_ID" $AUTH | jq
```

---

*이 문서는 `lib/api/operations.ts`의 구현과 `/api/v1/openapi.json` 스펙을 기준으로 합니다. 불일치 시 OpenAPI 스펙이 정본입니다.*
