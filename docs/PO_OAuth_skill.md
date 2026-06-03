# PolarisCloud SSO OAuth2 — 외부 서비스 연동 가이드

---

## 사전동작 — 프로젝트 등록

**name** : 사전 등록 가이드

**desc** : API 호출 전 clientId, clientSecret 발급 및 redirectUri 등록이 필요하다. 현재는 담당자 문의 후 등록하며, 추후 홈페이지에서 직접 등록 가능 예정이다.

---

| 항목 | 설명 |
|------|------|
| clientId | 프로젝트 식별자 (발급 항목) |
| clientSecret | 인증 시크릿 (발급 항목) |
| redirectUri | AuthorizationCode 수신 URI (사전 등록 필요) |

---

## 1. AuthorizationCode 발급

**name** : AuthorizationCode 발급 가이드

**desc** : AuthorizationCode를 발급 받기 위해 PO 도메인 로그인 페이지로 리다이렉트 시킨다.

---

**호출 규격**

`[GET] {PO_BaseURL}/sign-in`

**Request 쿼리스트링**

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| clientId | String | (필수) : 사전 발급항목 |
| redirectUri | String | (필수) : 사전 등록항목 |
| state | String | (필수) : 요청자가 생성하는 랜덤 문자열 |
| codeChallenge | String | (선택) : public client 필수 |
| codeChallengeMethod | String | (선택) : public client 필수. "S256"만 허용, plain 미지원 |

**Response 쿼리스트링** (redirectUri로 리다이렉트)

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| code | String | AuthorizationCode : Token 교환에 사용하는 인증키 |
| state | String | 요청 시 전달한 state 값 (위변조 검증용, 불일치 시 요청 폐기) |
| expiresIn | Int | 만료시간(초) |

**EX)**

```
request  : https://vf-ca-cloud.polarisoffice.com/sign-in?client_id=mcpname&state=statestring&redirect_uri=redirectdomain%2Fapi
response : redirectdomain/api?code=codestring&state=statestring&expiresIn=299
```

---

## 2. Token 발급

**name** : Token 발급 가이드

**desc** : OAuth서버에 AuthorizationCode를 전달하여 AccessToken과 RefreshToken을 발급받는다.

---

**호출 규격**

`[POST] {OAuth_BaseURL}/external/auth/token`

**Request Body**

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| code | String | (필수) : 1에서 발급받은 AuthorizationCode |
| clientId | String | (필수) : 사전 발급항목 |
| redirectUri | String | (필수) : 1의 요청과 동일한 값 |
| clientSecret | String | (조건) : Confidential Client 필수, Public Client null |
| codeVerifier | String | (조건) : 1에서 codeChallenge를 전달한 경우 필수, 그 외 null |

**Response Body**

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| accessToken | String | Resource 접근에 사용하는 JWT (RS256) |
| refreshToken | String | Token 갱신에 사용하는 키 |
| expiresIn | Int | AccessToken 만료시간(초) |
| tokenType | String | 토큰 타입 ("Bearer") |

**EX)**

```json
// request
{
  "code": "587119ee0da34ec0ac6dc9f75f2215ed",
  "clientId": "cli_c9c18539d2984573a87d747b4128896e",
  "redirectUri": "https://redirectdomain/api",
  "clientSecret": "cs_live_xxxxxx",
  "codeVerifier": null
}

// response
{
  "accessToken": "eyJraWQiOiJsb2NhbC1rZXktaWQi...",
  "refreshToken": "06512fabf657c10a7cb60c221a107a7...",
  "expiresIn": 300,
  "tokenType": "Bearer"
}
```

code는 1회 사용 후 즉시 폐기됩니다. 만료(300초) 또는 재사용 시 오류가 반환되며, 이 경우 1번부터 재시작합니다.

---

## 3. Token 갱신

**name** : Token 갱신 가이드

**desc** : OAuth서버에 RefreshToken을 전달하여 AccessToken을 갱신한다. 갱신 시 기존 RefreshToken은 즉시 폐기되고 새 RefreshToken이 발급된다.

---

**호출 규격**

`[POST] {OAuth_BaseURL}/external/auth/refresh`

**Request Body**

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| refreshToken | String | (필수) : 2에서 발급받은 RefreshToken |
| clientId | String | (필수) : 사전 발급항목 |
| clientSecret | String | (조건) : Confidential Client 필수, Public Client null |

**Response Body**

| 파라미터 | 타입 | 설명 |
|---------|------|------|
| accessToken | String | 갱신된 JWT (RS256) |
| refreshToken | String | 갱신된 RefreshToken (기존 값과 다름) |
| expiresIn | Int | AccessToken 만료시간(초) |
| tokenType | String | 토큰 타입 ("Bearer") |

**EX)**

```json
// request
{
  "refreshToken": "06512fabf657c10a7cb60c221a107a7...",
  "clientId": "cli_c9c18539d2984573a87d747b4128896e",
  "clientSecret": "cs_live_xxxxxx"
}

// response
{
  "accessToken": "eyJraWQiOiJsb2NhbC1rZXktaWQi...",
  "refreshToken": "2ebe8e5acf8c997fbd8b312ffbaeccd...",
  "expiresIn": 900,
  "tokenType": "Bearer"
}
```

응답의 새 refreshToken을 저장해야 합니다. 이전 refreshToken으로 재시도하면 오류가 반환됩니다.

---

## 4. (공통) PO Resource 접근 시 Token 이용 인증 방법 ( 크레딧 차감 등 .. )

**name** : PO Resource 접근 인증 가이드

**desc** : 2에서 발급받은 AccessToken을 Authorization 헤더에 담아 PO Resource API를 호출한다.

---

**호출 규격**

`[POST] {PO_BaseURL}/{Resource 접근 API}`

**Request Header**

| 헤더 | 설명 |
|------|------|
| Authorization | [tokenType] [AccessToken] |

**EX)**

```
Authorization: Bearer eyJraWQiOiJsb2NhbC1rZXktaWQi...
```
