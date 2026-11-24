# ADR 002: API 공통 규칙과 오류 응답 형식

- 상태: 제안됨 (2026-11-24)
- 결정한 사람: architect (검토: owner, 의견: frontend)

## 배경

- 서버와 화면은 `/api/v1` 아래 JSON API 하나로 만난다. 웹앱과 4단계의 네이티브 앱(SwiftUI)이 같은 API를 쓰고, 웹 전용 지름길 API는 만들지 않는다(설계 5.1). 네이티브 앱이 나간 뒤에는 고치기 어려운 결정이다.
- API 명세는 코드에서 OpenAPI로 만든다(ADR 003, #32).
- 컨트롤러는 아직 없다(확인, main `baaa2a4`). 로그인 API(#12)가 이 ADR을 선행으로 둔다.
- 앞서 frontend에 보낸 초안(`code`, `message`, `fieldErrors`)은 이 ADR로 대체된다.
- 금액은 원 단위 정수다(P-201). 날짜와 시각은 사용자가 입력한 값을 시간대 변환 없이 저장한다(P-202). 거래 id는 기기가 만든 UUID다(P-225).

## 결정

### 1. 경로

- 접두는 `/api/v1`이다. 자원 이름은 복수 명사, 소문자이고 낱말 사이는 하이픈이다.
- 장부에 속한 자원은 장부 id를 경로에 넣는다: `/api/v1/ledgers/{ledgerId}/transactions/{transactionId}`. 계좌, 카테고리, 통계도 같다. 권한 검사를 한 자리에서 같은 방식으로 하고, "지금 고른 장부"라는 숨은 상태를 서버에 두지 않기 위해서다.
- 장부에 속하지 않는 것은 `/api/v1/auth/...`(로그인, 갱신, 로그아웃)와 `/api/v1/me`다.
- 상태를 바꾸는 동작(승인취소, 복원 등)은 자원 아래 동작 이름으로 POST 한다: `POST .../transactions/{id}/cancel`. 세부 경로 목록은 각 API 이슈가 정하고 OpenAPI 문서가 기준이다.

### 2. 값 형식

- 필드 이름은 camelCase, 열거 값은 대문자와 밑줄이다(`POSTED`).
- 금액은 JSON 정수이고 단위는 원이다. 소수와 문자열은 받지 않는다. 상한은 #5가 정한 값이며 JavaScript의 안전한 정수 범위 안이다.
- 날짜는 `YYYY-MM-DD`, 사용자가 고른 시각은 `HH:mm`이다. 둘 다 시간대가 없다.
- 서버가 기록한 시각(만든 시각, 고친 시각)은 ISO 8601, UTC, `Z` 표기다(예: `2026-11-24T03:15:00Z`). 화면이 Asia/Seoul로 바꿔 보여 준다.
- id는 UUID 문자열, 소문자다.
- 값이 없는 필드는 빼지 않고 `null`로 넣는다.
- 고칠 수 있는 자원의 응답에는 `version`(정수)이 있다. 수정, 삭제, 상태 변경 요청은 본문에 자기가 본 `version`을 넣는다.

### 3. 목록

- 목록 응답은 최상위 배열이 아니라 객체다: `{ "items": [...] }`.
- 계속 늘어나는 목록(거래, 휴지통, 변경 이력)은 cursor로 나눈다. 요청은 `?limit=50&cursor=...`, 응답은 `{ "items": [...], "nextCursor": "..." }`이고 마지막이면 `nextCursor`는 `null`이다. cursor는 클라이언트가 해석하지 않는 문자열이다. `limit`은 기본 50, 최대 100이다(P-232의 50건).
- 정렬 순서는 목록마다 서버가 고정하고 같은 값이 있으면 id로 순서를 정한다. 불러오는 사이에 거래가 추가돼도 빠지거나 겹치지 않게 하기 위해서다.
- 계좌, 카테고리처럼 작은 목록은 나누지 않고 `items`에 전부 넣는다.

### 4. 오류 응답: RFC 9457 problem+json을 채택한다

- Content-Type은 `application/problem+json`이다. Spring의 `ProblemDetail`로 만들 수 있어 새 의존성이 없다(확인: 지금 쓰는 spring-web 6.2.19에 있다. Spring Boot 4.2(#17)에서의 동작은 미확인).
- 필드는 `type`(항상 `about:blank`), `title`, `status`, `detail`(개발자가 읽는 한 줄. 화면 문구로 쓰지 않는다)이고, 확장 필드는 `code`, `requestId`, 필요할 때 `fieldErrors`, `current`다.
- 오류 종류는 `code`로 구분한다. 화면은 `code`로 문구를 고르고, 모르는 `code`는 `status`로 처리한다. `code`는 추가만 하고 뜻을 바꾸거나 없애지 않는다.
- `fieldErrors`는 입력란별 검증 오류의 배열이다. 항목은 `field`(요청 본문의 경로, 예: `lines[0].amount`), `code`, `message`다.
- `current`는 수정 충돌(409 `STALE_VERSION`) 때 서버의 최신 자원 전체다. 화면이 최신 내용과 내 입력을 나란히 보여 주는 데 쓴다(F-909).
- `requestId`는 프록시가 만든 `X-Request-Id` 값이다. 응답 헤더에도 같은 값을 넣는다(ADR 005).

아래 예시에서 정한 것은 오류 필드의 모양이다. `detail`과 `message` 문구, 입력란 `code` 값, `current` 안의 자원 필드는 예시이고 OpenAPI 문서가 기준이다.

검증 오류(400):

```json
{
  "type": "about:blank", "title": "Bad Request", "status": 400,
  "detail": "요청 본문의 값 1개가 규칙에 맞지 않는다",
  "code": "VALIDATION_FAILED", "requestId": "req-example-1",
  "fieldErrors": [
    { "field": "lines[0].amount", "code": "OUT_OF_RANGE", "message": "1원부터 9,999,999,999원까지 입력할 수 있다" }
  ]
}
```

수정 충돌(409):

```json
{
  "type": "about:blank", "title": "Conflict", "status": 409,
  "detail": "요청의 version 3이 저장된 version 4와 다르다",
  "code": "STALE_VERSION", "requestId": "req-example-2",
  "current": {
    "id": "0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60", "version": 4, "type": "EXPENSE", "status": "POSTED",
    "occurredOn": "2026-11-24", "occurredTime": "12:30", "payee": "예시 식당", "memo": null,
    "lines": [ { "accountId": "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f", "categoryId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "amount": -12000 } ],
    "createdAt": "2026-11-24T03:15:00Z", "updatedAt": "2026-11-24T04:02:10Z"
  }
}
```

찾을 수 없음(404):

```json
{ "type": "about:blank", "title": "Not Found", "status": 404, "detail": "대상을 찾을 수 없다",
  "code": "NOT_FOUND", "requestId": "req-example-3" }
```

### 5. 상태 코드와 code 목록

| 상태 | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 입력 검증 실패. `fieldErrors`가 있다 |
| 400 | `MALFORMED_REQUEST` | 해석할 수 없는 본문, 지원하지 않는 형식 |
| 401 | `UNAUTHENTICATED` | 토큰이 없거나 만료됐거나 틀렸다 |
| 401 | `INVALID_CREDENTIALS` | 로그인 실패. 이메일과 비밀번호 중 무엇이 틀렸는지 구분하지 않는다(P-105) |
| 403 | `FORBIDDEN` | 구성원이지만 권한이 모자란다(보기 전용의 쓰기, 소유자 전용 동작) |
| 404 | `NOT_FOUND` | 없는 자원. 구성원이 아닌 장부와 그 데이터도 같은 응답이며 구분되지 않는다(P-903) |
| 409 | `STALE_VERSION` | 낡은 version으로 고치려 했다. `current`가 있다 |
| 409 | `ID_CONFLICT` | 같은 id로 다른 내용을 만들려 했다 |
| 409 | `DUPLICATE` | 이름, 이메일 등 겹치면 안 되는 값이 겹쳤다. `fieldErrors`로 어느 값인지 알린다 |
| 409 | `IN_USE` | 쓰이고 있어 지울 수 없다 |
| 429 | `TOO_MANY_REQUESTS` | 로그인 잠금(P-105)과 출시 단계의 요청 횟수 제한. `Retry-After` 헤더를 넣는다 |
| 500 | `INTERNAL_ERROR` | 서버 오류. `detail`은 고정 문구다 |

이슈 #24의 목록(400, 401, 403, 404, 409)에 429와 500을 더했다. 로그인 잠금을 429로 둔 것은 architect 판단이며 security 검토 때 확인한다.

지금 `common` 패키지에 있는 예외 8개는 다음 code가 된다(클래스 이름 확인, main `baaa2a4`).

- `DuplicateEmailException` → 409 `DUPLICATE`
- `IdConflictException` → 409 `ID_CONFLICT`
- `InUseException` → 409 `IN_USE`
- `InvalidRequestException` → 400 `VALIDATION_FAILED`
- `NotFoundException` → 404 `NOT_FOUND`
- `NotLedgerMemberException` → 404 `NOT_FOUND`
- `NotLedgerOwnerException` → 403 `FORBIDDEN`
- `StaleVersionException` → 409 `STALE_VERSION`

남의 장부에 관한 정보를 응답으로 구분할 수 없어야 한다. 다른 장부에 이미 있는 id로 만들려 할 때도 장부의 존재가 드러나지 않아야 하며, 이때의 응답은 #21이 정한다.

### 6. 만들기의 멱등 규칙

기기가 id를 만드는 자원(거래)은 `POST`로 만들고 본문에 id를 넣는다. 같은 id와 같은 내용을 다시 보내면 새로 만들지 않고 저장된 자원을 돌려준다(처음은 201, 다시 보낸 것은 200). 같은 id에 다른 내용이면 409 `ID_CONFLICT`다. 오프라인에서 쌓아 둔 입력을 다시 보내도 겹치지 않게 하기 위한 규칙이다(P-225). 세부는 ADR 006(#72)이 다룬다.

### 7. 내보내지 않는 것

응답 본문과 헤더에 스택 트레이스, 예외 클래스 이름, SQL, 내부 주소를 넣지 않는다. 500의 `detail`은 고정 문구이고 원인은 `requestId`로 로그에서 찾는다. 이 규칙은 자동 테스트로 고정한다(구현 이슈에서).

### 8. 바꾸는 규칙

- `/api/v1` 안에서는 더하기만 한다(필드, 경로, code 추가). 필드를 없애거나 뜻을 바꾸는 변경은 `/api/v2`로 한다. 화면은 모르는 필드를 무시해야 한다.
- 예외: 네이티브 앱이 나가기 전(웹앱만 있고 서버와 같이 배포되는 동안)에는 owner 승인으로 v1을 깨는 변경을 할 수 있다.

## 검토한 대안

모두 채택하지 않았다.

| 대안 | 장점 | 대가와 채택하지 않은 이유 |
|---|---|---|
| 오류 형식을 직접 정하기(`code`, `message`, `fieldErrors`만. 앞선 초안) | 가장 단순하다 | 표준이 아니라 클라이언트 라이브러리와 OpenAPI 도구의 기본 지원을 못 받고, 형식을 우리가 계속 설명해야 한다. RFC 9457에 `code`와 `fieldErrors`를 확장 필드로 넣으면 초안의 장점을 그대로 가져온다 |
| RFC 9457에서 오류 종류를 `type` URI로 구분하기 | 표준에 가장 가깝다 | 종류마다 주소를 정하고 설명 문서를 호스팅해야 한다. `code` 문자열이 화면 코드에서 다루기 쉽다 |
| 장부 id를 헤더나 서버의 "현재 장부" 상태로 넘기기 | 주소가 짧다 | 주소만으로 무엇을 가리키는지 알 수 없고, 탭 두 개에서 다른 장부를 열면 어긋나며, 권한 검사 자리가 흩어진다 |
| 수정 충돌 검사를 `ETag`/`If-Match` 헤더로 하기 | HTTP 표준 방식이다 | 오프라인 대기열과 네이티브 앱에서 헤더와 본문 두 곳을 같이 다뤄야 한다. 본문 `version`은 자원과 함께 저장하기 쉽다 |
| 목록을 쪽 번호(offset)로 나누기 | 구현이 쉽다 | 불러오는 사이에 거래가 추가되면 항목이 겹치거나 빠지고, 뒤쪽으로 갈수록 느려진다 |

## 결과

- 좋아지는 것: 화면과 네이티브 앱이 오류를 한 가지 방식으로 처리한다. 권한 검사와 페이지 나누기가 모든 API에서 같다.
- 대가: 주소가 길어진다. `code` 목록을 관리해야 한다. 앞서 frontend에 보낸 초안과 필드 구성이 달라 frontend가 맞춰야 한다(`message` → `detail`, 최상위에 `title`과 `status` 추가).
- 받아들인 위험: 네이티브 앱이 나간 뒤에 이 결정을 되돌리려면 `/api/v2`가 필요하다. 그 전에는 owner 승인으로 고칠 수 있다.
- 다시 검토할 조건: security 검토에서 로그인 잠금의 429를 다르게 정할 때, 네이티브 앱을 내기 전에 v1을 깨는 변경이 필요할 때.
- 이 ADR이 머지되면 frontend에게 알린다(#24).
