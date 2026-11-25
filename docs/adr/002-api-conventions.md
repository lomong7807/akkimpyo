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
- 장부에 속하지 않는 것은 `/api/v1/auth/...`(가입, 로그인, 갱신, 로그아웃), `/api/v1/me`, `/api/v1/ledgers`(장부 목록과 만들기)다. 초대, 열람 링크, 내 전체 지출은 2단계 이슈가 이 규칙에 맞춰 정한다.
- 상태를 바꾸는 동작(승인취소, 복원 등)은 자원 아래 동작 이름으로 POST 한다: `POST .../transactions/{id}/cancel`. 세부 경로 목록은 각 API 이슈가 정하고 OpenAPI 문서가 기준이다.
- 달은 `YYYY-MM`으로 적는다.
- 파일을 돌려주는 API(내보내기)는 성공 응답이 JSON이 아니며 오류일 때만 problem+json이다.

### 2. 값 형식

- 필드 이름은 camelCase, 열거 값은 대문자와 밑줄이다(`POSTED`).
- 금액은 JSON 정수이고 단위는 원이다. 소수와 문자열은 받지 않는다. 상한은 #5가 정한 값이며 JavaScript의 안전한 정수 범위 안이다.
- 날짜는 `YYYY-MM-DD`, 사용자가 고른 시각은 `HH:mm`만 주고받는다(초 이하는 없다). 둘 다 시간대가 없다.
- 서버가 기록한 시각(만든 시각, 고친 시각)은 ISO 8601, UTC, `Z` 표기이고 밀리초 3자리 고정이다(예: `2026-11-24T03:15:00.123Z`). 화면이 Asia/Seoul로 바꿔 보여 준다.
- id는 UUID 문자열, 소문자다.
- 자원 응답에서 값이 없는 필드는 빼지 않고 `null`로 넣는다. 오류 응답의 확장 필드(`fieldErrors`, `current`)는 해당할 때만 넣고 아니면 뺀다.
- 수정 충돌 검사를 하는 자원(지금은 거래뿐, P-217)의 응답에만 `version`(정수)이 있고, 그 자원의 수정, 삭제, 상태 변경 요청만 자기가 본 `version`을 보낸다. 계좌, 카테고리 등은 나중 저장이 덮어쓴다(P-217).
- 수정 충돌 검사를 하는 자원의 응답에는 `version`과 함께 `updatedAt`, `updatedBy`(`id`와 `displayName`)가 있다. 화면이 "누가 언제 먼저 고쳤는지"를 보이는 데 쓴다(F-909, N-04). `displayName`은 api가 응답을 만들 때 붙인다. 변경 이력의 전후 값에는 사람 이름을 넣지 않는다(ADR 007, #73). 고친 사람이 탈퇴했으면 `updatedBy`는 `null`이다.
- 수정 요청과 상태 변경 `POST`는 `version`을 본문에 넣는다. 삭제는 `DELETE`로 하고 쿼리 문자열로 보낸다: `DELETE .../transactions/{id}?version=3`. DELETE에는 본문을 쓰지 않는다.
- 삭제(`DELETE`)와 상태 변경 `POST`는 바뀐 자원 전체를 200으로 돌려준다. 삭제 직후 "되돌리기"가 새 `version`을 알아야 하기 때문이다(F-227). 완전히 지우기처럼 자원이 남지 않는 동작은 204다.

### 3. 목록

- 목록 응답은 최상위 배열이 아니라 객체다: `{ "items": [...] }`.
- 계속 늘어나는 목록(거래, 휴지통, 변경 이력)은 cursor로 나눈다. 요청은 `?limit=50&cursor=...`, 응답은 `{ "items": [...], "nextCursor": "..." }`이고 마지막이면 `nextCursor`는 `null`이다. cursor는 클라이언트가 해석하지 않는 문자열이고 목록 안의 위치만 담는다. 어느 장부의 무엇을 볼 수 있는지는 cursor가 아니라 항상 경로와 구성원 확인으로 정한다. `limit`은 기본 50, 최대 100이다(P-232의 50건).
- 정렬 순서는 목록마다 서버가 고정하고 같은 값이 있으면 id로 순서를 정한다. 불러오는 사이에 거래가 추가돼도 빠지거나 겹치지 않게 하기 위해서다.
- 계좌, 카테고리처럼 작은 목록은 나누지 않고 `items`에 전부 넣는다.
- 목록 객체에는 `items`와 `nextCursor` 말고 합계 같은 최상위 필드를 더할 수 있다. 모양은 각 API 이슈가 정한다(#15).

### 4. 오류 응답: RFC 9457 problem+json을 채택한다

- Content-Type은 `application/problem+json`이다. Spring의 `ProblemDetail`로 만들 수 있어 새 의존성이 없다(확인: spring-web 7.1.0에 있다. Spring Boot 4.2.0에서 확장 필드가 최상위에 나가는 것을 PR #100의 임시 테스트로 확인했다).
- 필드는 `type`(항상 `about:blank`), `title`(HTTP 상태 문구), `status`, `detail`(개발자가 읽는 한 줄)이고, 확장 필드는 `code`, `requestId`, 해당할 때만 `fieldErrors`, `current`다. `instance`는 넣지 않는다(경로에 토큰이 들 수 있다).
- `type`은 직접 `about:blank`로 넣는다(Spring Boot 4.2는 넣지 않으면 본문에서 뺀다, PR #100).
- 오류 응답은 전부 서버의 공통 처리기가 만들고, 프레임워크의 기본 오류 응답(`spring.mvc.problemdetails` 포함)은 그대로 내보내지 않는다(`code`와 `requestId`가 없고 `detail`에 요청 값이 들어간다, PR #100).
- 필드 순서는 정하지 않으며, 본문 문자열을 통째로 비교하는 테스트는 쓰지 않는다.
- 오류 종류는 `code`로 구분한다. 화면은 화면설계서의 문구를 `code`로 골라 쓰고, 모르는 `code`는 `status`로 처리한다. `code`는 추가만 하고 뜻을 바꾸거나 없애지 않는다.
- `fieldErrors`는 입력란별 검증 오류의 배열이다. 항목은 `field`(요청 본문의 경로, 예: `lines[0].amount`), `code`, `message`다. `message`와 `detail`은 개발자가 읽는 글이고 화면 문구로 쓰지 않는다. 거래 요청의 줄 순서와 금액 부호 규칙은 OpenAPI 문서에 적는다(#14).
- `detail`과 `message`에는 요청으로 받은 값을 그대로 넣지 않는다. `MALFORMED_REQUEST`의 `detail`은 고정 문구다.
- `fieldErrors[].code`의 시작 목록은 `REQUIRED`, `INVALID_FORMAT`, `OUT_OF_RANGE`, `TOO_LONG`, `DUPLICATE`, `NOT_FOUND`(가리킨 계좌나 카테고리가 없음), `NOT_ALLOWED`(형식은 맞지만 규칙상 받을 수 없는 값이나 조합: 같은 계좌 사이 이체, 카테고리 구분 불일치 등), `INCORRECT`(현재 비밀번호가 맞지 않음)다. 추가만 한다.
- 화면 문구가 갈리는 경우에는 `fieldErrors[].code`를 따로 둔다. 예:
  - 가입의 허용 목록 밖 이메일: `field`=`email`, `code`=`NOT_ALLOWED`
  - 같은 계좌 사이 이체: 받는 계좌 입력란에 `NOT_ALLOWED`
  - 비밀번호 바꾸기에서 현재 비밀번호가 틀림: 401이 아니라 400 `VALIDATION_FAILED`, `field`=`currentPassword`, `code`=`INCORRECT`(화면의 "401이면 토큰 갱신"과 섞이지 않게)
- 본문을 JSON으로 읽을 수 없을 때만 400 `MALFORMED_REQUEST`다. JSON은 읽히지만 값의 형이 틀린 경우는 400 `VALIDATION_FAILED`이고 그 입력란에 `INVALID_FORMAT`을 준다.
- 쿼리 값(`version`, `limit`, `cursor`, 달)의 오류도 400 `VALIDATION_FAILED`이고 `field`에는 쿼리 이름을 그대로 적는다. 경로의 id가 UUID 형식이 아니면 404 `NOT_FOUND`다(없는 자원과 같게).
- `current`는 수정 충돌(409 `STALE_VERSION`) 때 서버의 최신 자원 전체다. 화면이 최신 내용과 내 입력을 나란히 보여 주는 데 쓴다(F-909). 409 `ID_CONFLICT` 가운데 같은 장부에서 내가 만든 거래일 때도 있다(ADR 006).
- `requestId`는 프록시가 만든 `X-Request-Id` 값이다. 프록시는 밖에서 온 `X-Request-Id`를 덮어쓴다. 영문, 숫자, 하이픈, 밑줄로 된 64자 이하의 문자열이고 클라이언트는 해석하지 않는다. 서버는 형식을 검사해, 헤더가 없거나(로컬 개발, 테스트) 이 형식이 아니면 새로 만든다. 응답 헤더에도 같은 값을 넣는다(ADR 005).

아래 예시에서 정한 것은 오류 필드의 모양이다. `detail`과 `message` 문구, `current` 안의 자원 필드는 예시이고 OpenAPI 문서가 기준이다.

검증 오류(400):

```json
{
  "type": "about:blank", "title": "Bad Request", "status": 400,
  "detail": "요청 본문의 값 1개가 규칙에 맞지 않는다",
  "code": "VALIDATION_FAILED", "requestId": "req-example-1",
  "fieldErrors": [
    { "field": "amount", "code": "OUT_OF_RANGE", "message": "1 이상 9999999999 이하의 정수여야 한다" }
  ]
}
```

수정 충돌(409):

```json
{
  "type": "about:blank", "title": "Conflict", "status": 409,
  "detail": "요청의 version이 저장된 version과 다르다",
  "code": "STALE_VERSION", "requestId": "req-example-2",
  "current": {
    "id": "0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60", "version": 4, "type": "EXPENSE", "status": "POSTED",
    "occurredOn": "2026-11-24", "occurredTime": "12:30", "payee": "예시 식당", "memo": null,
    "lines": [ { "accountId": "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f", "categoryId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "amount": -12000 } ],
    "createdAt": "2026-11-24T03:15:00.123Z", "updatedAt": "2026-11-24T04:02:10.456Z",
    "updatedBy": { "id": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b", "displayName": "예시 사용자" }
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
| 400 | `VALIDATION_FAILED` | 입력란에 붙일 수 있는 오류 전부. 겹치는 이름과 이메일도 여기에 넣는다(`fieldErrors[].code`는 `DUPLICATE`). `fieldErrors`가 항상 1개 이상 있다 |
| 400 | `MALFORMED_REQUEST` | 본문을 JSON으로 읽을 수 없다 |
| 401 | `UNAUTHENTICATED` | 토큰이 없거나 만료됐거나 틀렸다. 갱신 요청이 실패했을 때도 같으며, 화면은 갱신 요청의 401을 로그인 풀림으로 처리한다 |
| 401 | `INVALID_CREDENTIALS` | 로그인 실패. 이메일과 비밀번호 중 무엇이 틀렸는지 구분하지 않는다(P-105) |
| 403 | `FORBIDDEN` | 구성원이지만 권한이 모자란다(보기 전용의 쓰기, 소유자 전용 동작) |
| 403 | `NO_LONGER_MEMBER` | 2단계에 추가. 내가 구성원이었던 장부(나갔거나 내보내짐, 삭제됨)(P-903, P-310, F-906). 본인이 이미 아는 사실이라 드러나는 것이 없다. 판정은 지난 구성원 기록으로만 하고, 응답에 장부의 값(이름 등)을 넣지 않는다. 기록이 남아 있는 동안만 준다. 그 기록은 장부 영구 삭제와 탈퇴 때 지우며, 기록이 없으면 404 `NOT_FOUND`다 |
| 404 | `NOT_FOUND` | 없는 자원. 한 번도 구성원이 아니었던 장부와 그 데이터도 같은 응답이며 없는 것과 구분되지 않는다(P-903) |
| 405 | `METHOD_NOT_ALLOWED` | 그 경로에서 받지 않는 메서드 |
| 409 | `STALE_VERSION` | 낡은 version으로 고치려 했다. `current`가 있다 |
| 409 | `ID_CONFLICT` | 그 id로 만들 수 없다. 같은 id로 다른 내용을 만들려 했거나(이때 `current`가 있다), 그 id를 쓸 수 없다(`current` 없음). 판정은 ADR 006 |
| 409 | `INVALID_STATE` | 입력란과 무관한 상태 오류("이미 취소된 거래" 등) |
| 409 | `IN_USE` | 쓰이고 있어 지울 수 없다 |
| 413 | `PAYLOAD_TOO_LARGE` | 본문이 너무 크다 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 지원하지 않는 Content-Type |
| 429 | `LOGIN_LOCKED` | 로그인 잠금(P-105). `Retry-After` 헤더를 넣는다 |
| 429 | `TOO_MANY_REQUESTS` | 출시 단계의 요청 횟수 제한. `Retry-After` 헤더를 넣는다 |
| 500 | `INTERNAL_ERROR` | 서버 오류. `detail`은 고정 문구다 |

검사 순서는 인증(401) → 구성원 확인(404) → 권한(403) → 입력 검증(400) → 상태와 version(409)이다. 409의 `current`는 구성원 확인을 지난 요청에만 나간다.

만들기는 입력 검증을 형식 검증과 참조 검증으로 나누고 그 사이에 같은 id 조회를 둔다(ADR 006).

요청 형식 자체의 오류(405, 413, 415, `MALFORMED_REQUEST`)는 인증보다 먼저 나올 수 있다. 대상 자원이 없는 404는 구성원 확인 다음이고, 만들기에서 `ID_CONFLICT`가 나오는 자리는 ADR 006 결정 4를 따른다.

휴지통에 있는(소프트 삭제된) 거래를 낡은 version으로 고치려 하면 404가 아니라 409 `STALE_VERSION`이고 `current`에 `deletedAt`이 채워져 온다. 완전히 지워진 거래는 404 `NOT_FOUND`다.

이슈 #24의 목록(400, 401, 403, 404, 409)에 405, 413, 415, 429, 500을 더했다. 로그인 잠금을 429로 둔 것은 architect 판단이며 security가 429에 동의했다(PR #97 검토, 2026-11-24). 잠금 응답이 계정의 존재를 드러내지 않게 하는 방법은 ADR 001에서 security와 정한다.

지금 `common` 패키지에 있는 예외 8개는 다음 code가 된다(클래스 이름 확인, main `baaa2a4`).

- `DuplicateEmailException` → 400 `VALIDATION_FAILED`(`fieldErrors[].code`=`DUPLICATE`)
- `IdConflictException` → 409 `ID_CONFLICT`
- `InUseException` → 409 `IN_USE`
- `InvalidRequestException` → 400 `VALIDATION_FAILED`(상태 오류는 409 `INVALID_STATE`)
- `NotFoundException` → 404 `NOT_FOUND`
- `NotLedgerMemberException` → 404 `NOT_FOUND`
- `NotLedgerOwnerException` → 403 `FORBIDDEN`
- `StaleVersionException` → 409 `STALE_VERSION`

남의 장부에 관한 정보를 응답으로 구분할 수 없어야 한다. 다른 장부에 이미 있는 id로 만들려 할 때도 장부의 존재가 드러나지 않아야 하며, 이때의 응답은 ADR 006 결정 3이 정한다.

### 6. 만들기의 멱등 규칙

기기가 id를 만드는 자원(거래)은 `POST`로 만들고 본문에 id를 넣는다. 같은 id와 같은 내용을 다시 보내면 새로 만들지 않고 저장된 자원을 돌려준다(처음은 201, 다시 보낸 것은 200). 판정은 ADR 006 결정 3의 표를 따른다. 오프라인에서 쌓아 둔 입력을 다시 보내도 겹치지 않게 하기 위한 규칙이다(P-225). 판정과 검사 순서는 ADR 006을 따른다.

### 7. 내보내지 않는 것

응답 본문과 헤더에 스택 트레이스, 예외 클래스 이름, SQL, 내부 주소를 넣지 않는다. Tomcat 기본 HTML 오류 페이지와 서버 제품을 드러내는 헤더도 내보내지 않는다. 모든 오류는 problem+json이다. 다만 프록시가 직접 내는 오류(502, 504 등)는 problem+json이 아닐 수 있다. 화면은 본문을 읽지 못하면 상태 코드(status)로 처리한다. 500의 `detail`은 고정 문구이고 원인은 `requestId`로 로그에서 찾는다. 이 규칙은 자동 테스트로 고정한다(구현 이슈에서).

500, Whitelabel HTML, Tomcat 단계의 400은 설정만으로 problem+json이 되지 않으므로 따로 처리한다(#12, 확인한 곳은 PR #100).

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
| 수정 충돌 검사를 `ETag`/`If-Match` 헤더로 하기 | HTTP 표준 방식이다 | 오프라인 대기열과 네이티브 앱이 자원 본문과 따로 헤더 값을 보관하고 보내야 한다. `version`을 자원의 필드로 두면 자원과 함께 저장된다 |
| 목록을 쪽 번호(offset)로 나누기 | 구현이 쉽다 | 불러오는 사이에 거래가 추가되면 항목이 겹치거나 빠지고, 뒤쪽으로 갈수록 느려진다 |

## 지금 코드와 다른 점

구현 이슈에서 맞춘다. 이 PR은 코드를 바꾸지 않는다(확인, main `baaa2a4`).

- `LedgerAccess.requireOwner`는 구성원이 아니어도 `NotLedgerOwnerException`을 던진다. 404가 먼저여야 한다.
- `IdConflictException`은 내용이 다를 때와 다른 장부의 id일 때를 함께 다룬다(#21).
- `InvalidRequestException`은 입력란 정보가 없고 상태 오류에도 쓰인다. `VALIDATION_FAILED`와 `INVALID_STATE`로 나눠야 한다.
- 거래 서비스의 조회, 수정, 취소, 삭제, 복원은 거래 id만 받는다. 거래 API는 경로의 `ledgerId`와 거래의 장부가 같은지 확인해야 한다. 다르면 404다.
- 거래에 마지막으로 고친 사람을 담는 값이 없다. V1의 `transaction`과 `TransactionView`에는 고친 시각만 있고, 바꾼 사람은 `change_log.actor_id`에만 남는다.
- `TransactionService.update`는 version을 입력 검증보다 먼저 본다. 검사 순서(검증 400 → version 409)와 맞춰야 한다.
- UUID가 아닌 경로 id는 프레임워크 기본이 400이라 404로 바꾸는 처리가 필요하다(#12, 확인한 곳은 PR #100).

## 결과

- 좋아지는 것: 화면과 네이티브 앱이 오류를 한 가지 방식으로 처리한다. 권한 검사와 페이지 나누기가 모든 API에서 같다.
- 대가: 주소가 길어진다. `code` 목록을 관리해야 한다. 앞서 frontend에 보낸 초안과 달라 frontend가 맞춰야 한다(`message` → `detail`, `title`·`status` 추가, 중복 오류가 400).
- 받아들인 위험: 네이티브 앱이 나간 뒤에 이 결정을 되돌리려면 `/api/v2`가 필요하다. 그 전에는 owner 승인으로 고칠 수 있다.
- 다시 검토할 조건: 네이티브 앱을 내기 전에 v1을 깨는 변경이 필요할 때.
- 이 ADR이 머지되면 frontend에게 알린다(#24).
