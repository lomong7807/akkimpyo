# 1단계 기반 작업 기록 (2026-11-18)

## 작업 보고

**변경 요약**: 가계부 1단계의 화면과 무관한 기반을 만들었다. 서버와 웹 프로젝트 뼈대, 로컬 PostgreSQL 구성, 장부·계좌·카테고리·거래의 저장 구조와 규칙, 잔액과 월별 통계 조회다. 계획은 `docs/superpowers/plans/2026-11-18-phase1-foundation.md`, 설계는 `docs/superpowers/specs/2026-11-18-account-book-design.md`에 있다.

**변경 파일**
- `server/`: Spring Boot 3.5.16, Java 21 서버. 기능별 패키지(`user`, `ledger`, `account`, `category`, `transaction`, `stats`, `common`)로 나뉜다.
- `server/src/main/resources/db/migration/V1__ledger_core.sql`: 사용자, 장부, 구성원, 계좌, 카테고리, 거래 헤더와 라인, 변경 이력 테이블.
- `compose.yaml`: 로컬 PostgreSQL 17. 이 Mac에서 5432를 다른 PostgreSQL이 쓰고 있어 호스트 포트는 5433이다.
- `web/`: Vite, React, TypeScript 뼈대. 제목만 그리며 화면은 없다.

**판단/결정**
- 병렬 2개로 진행했다. 서버 Task 1~6은 Opus 작업자 1개가 순서대로, 웹 Task 7은 Sonnet 작업자 1개가 맡았다. 두 결과는 Fable 세션이 한꺼번에 검수했다.
- REST API, 로그인, 화면은 이번 범위에 넣지 않았다. 서비스는 호출자 id를 인자로 받아 장부 구성원인지 확인한다.
- 이벤트, 자동 입력, 할부용 컬럼은 해당 단계의 마이그레이션에서 추가한다.
- 거래 시각은 밀리초까지만 저장된다(Hibernate 동작). 재전송 비교가 어긋나지 않도록 저장과 비교를 밀리초로 맞췄다.

**검증**
- `cd server && ./gradlew clean test`: 테스트 57개, 실패 0, 건너뜀 0 (검수 때 다시 실행해 확인).
- `cd web && npm test`, `npm run lint`, `npm run build`: 모두 통과 (검수 때 다시 실행해 확인).
- 서버 기동 확인은 작업자가 8081 포트로 했다. 8080은 이 Mac의 다른 프로세스가 쓰고 있었다.

**리스크/후속** (다음 계획인 인증·REST에서 다룰 것)
- 같은 id의 거래 생성이나 같은 이메일 가입이 동시에 오면 두 번째 요청은 DB 제약 오류를 받는다. 중복 데이터는 생기지 않지만 응답으로 바꿔 줘야 한다.
- 없는 계좌·카테고리는 `NotLedgerMemberException`, 없는 거래는 `NotFoundException`이다. 응답 규칙을 하나로 맞춘다.
- 이메일 대소문자 정규화와 형식 검증이 없다.
- `transaction_line.category_id` 인덱스와, 장부·구분마다 미분류가 하나뿐이라는 DB 제약이 없다.
- 웹 의존성 `picomatch`에 `npm audit` high 등급 보고가 있다(간접 의존성, 빌드 도구 쪽).
- 6장 데이터 모델은 사용자 확인 전이다. 바뀌면 이 기반도 고쳐야 한다.
