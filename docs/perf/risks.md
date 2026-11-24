# 아낌표 성능 위험 목록

> **실측이 아니다.** main 9a31116의 코드를 읽고 정리한 것이다. 이 문서를 올릴 때의 main(baaa2a4)과 서버 코드는 같다.

- 상태: 초안, 실측 전
- 작성일: 2026-11-24
- 반영한 의견: dba 의견(2026-11-23)
- 인덱스와 스키마 변경은 dba가 이슈로 다룬다. 이 문서는 변경을 직접 정하지 않는다.
- 목표는 [README](README.md), 재는 방법은 [측정 계획](measurement-plan.md)에 있다.

## 1. 읽기 전에 알아 둘 코드 사실

- 인덱스는 `V1__ledger_core.sql`에 있는 다음 네 개와 PK, UNIQUE뿐이다.
  - `transaction (ledger_id, occurred_on)`
  - `transaction_line (transaction_id)`
  - `transaction_line (account_id)`
  - `change_log (transaction_id, created_at)`
- 컨트롤러가 아직 없다. 거래 목록과 검색 쿼리도 없다. 읽기로 있는 것은 휴지통 목록(`listDeleted`), 거래 하나 조회, 변경 이력, 잔액(`BalanceQuery`), 월 통계(`MonthlyStatsQuery`)이다.

## 2. 위험 표

상태의 "확인"은 코드나 스키마를 열어 사실을 본 것이고, "추정"은 읽고 짐작한 것이다.

| 번호 | 위험 | 근거(파일) | 상태 | 대응 방향 | 담당 |
|------|------|-----------|------|-----------|------|
| 1 | 인덱스 없는 조회 | 아래 2.1 | 확인 | 인덱스 3개 제안 | dba |
| 2 | 목록의 N+1 | 아래 2.2 | 추정 (API가 생길 때의 위험) | 점검표 1, 2번 | ledger |
| 3 | 페이지 나누기 | 아래 2.3 | 추정 | 마지막 값 기준, 경계 테스트 | ledger |
| 4 | 잔액 | 아래 2.4 | 추정 | 재기 전에는 누적 테이블을 넣지 않는다 | dba, ledger |
| 5 | 검색(부분 일치) | 아래 2.5 | 추정 | 장부당 5만 건에서 잰 뒤 판단 | dba |
| 6 | 휴지통 목록 | 아래 2.6 | 확인 | 건수 제한, 부분 인덱스 제안 | dba, ledger |
| 7 | 저장 1건의 SQL 수 | 아래 2.7 | 추정 (세어 보지 않음) | 세어서 상한으로 고정 | ledger |
| 8 | 오프라인 입력 전송 | 아래 2.8 | 추정 | 묶음 저장 API 검토 | architect |
| 9 | 스키마 변경 예정 | 아래 2.9 | 확인 (제안이 올라가 있음) | 결정 뒤에 실행 계획을 잰다 | dba, architect |

### 2.1 인덱스 없는 조회 (확인)

- `TransactionLineRepository.existsByCategoryId`가 `transaction_line.category_id`에 인덱스가 없어 전체 테이블을 훑는다. 카테고리 삭제 때(`CategoryService`) 불린다.
- `CategoryRepository.existsByParentId`는 `category.parent_id`에, `LedgerMemberRepository.findByUserId`는 `ledger_member.user_id`에 인덱스가 없다. `ledger_member`의 UNIQUE는 `(ledger_id, user_id)` 순서라서 `user_id`만으로는 쓰지 못한다.
- dba 제안은 다음 세 가지다.
  - `transaction_line (category_id) WHERE category_id IS NOT NULL`
  - `ledger_member (user_id)`
  - `category (parent_id)`
- `account.ledger_id`와 `category.ledger_id`는 따로 만들지 않는다. 앞으로 들어갈 유니크 제약이 `ledger_id`로 시작해 같이 해결된다. 지금 스키마에는 그 제약이 아직 없다.
- 담당: dba.

### 2.2 목록의 N+1 (API가 생길 때의 위험)

- `TransactionView.of`가 `tx.getLines()`를 읽는다. 목록에서 라인을 함께 읽지 않으면 50건에 SQL이 51회가 된다.
- 페이지 나누기와 컬렉션 함께 읽기를 한 쿼리에 쓰면 Hibernate가 전체를 메모리에 올린 뒤 자른다.
- 대응: README 점검표 1, 2번(호출당 SQL 수를 테스트로 고정, id를 먼저 자르고 라인은 한 번에 읽기).
- 담당: ledger.

### 2.3 페이지 나누기

- 한 달 목록은 수백 건이라 영향이 작고, 전체 기간 검색에서 문제가 된다.
- 마지막 값 기준 방식을 쓴다(dba 동의). 인덱스는 지금의 `(ledger_id, occurred_on)`을 유지하고, 느린 것이 측정되면 다시 본다.
- 주의할 점 두 가지가 있다.
  - `occurred_time`이 NULL일 수 있어 (날짜, 시각, id) 행 비교 한 줄로 다음 페이지 조건을 쓸 수 없다. 조건을 풀어 써야 하고, "시각 없는 거래가 페이지 경계에 걸린 경우" 테스트가 필요하다.
  - id가 무작위 UUID라 같은 날 같은 시각의 순서가 입력 순서와 무관하다. 입력 순서를 원하면 정렬 키에 `created_at`을 넣어야 하며, 이것은 기획(F-215)이 정할 일이다. **미결정**.
- 담당: ledger.

### 2.4 잔액

- `BalanceQuery`가 계좌 기준일 이후의 모든 라인을 매번 합산한다. 홈을 열 때마다 불리고, 거래 수에 비례해 느려진다.
- 재기 전에는 누적 테이블을 넣지 않는다(dba 동의: 라인에서 계산하는 구조가 무결성에 가장 안전하다).
- 계좌 하나에 라인 1만 / 5만 / 20만 건으로 기준선을 잰다.
- 나중에 스냅샷을 넣게 되면 "스냅샷 + 이후 합 = 전체 합" 대조 검사를 같이 넣는다.

### 2.5 검색

- P-232는 가맹점/내용, 메모의 부분 일치를 정했다. 부분 일치라 일반 인덱스를 못 탄다.
- 장부 하나 범위면 1만 건대까지는 버틴다고 본다(추정).
- `pg_trgm`은 확장이라 마이그레이션과 운영 DB 설정이 같이 바뀐다. 장부당 5만 건에서 잰 뒤 판단한다.

### 2.6 휴지통 목록

- `TransactionRepository.findByLedgerIdAndDeletedAtIsNotNullOrderByDeletedAtDesc`에 건수 제한이 없다. 이 메서드는 `@EntityGraph(attributePaths = "lines")`로 라인을 함께 읽으므로 SQL 수는 늘지 않지만, 삭제된 거래가 쌓이는 만큼 한 번에 다 올린다.
- dba 제안은 `transaction (ledger_id, deleted_at) WHERE deleted_at IS NOT NULL` 인덱스와, API에서 50건 페이지로 나누는 것이다.
- 이 메서드에 50건 페이지를 넣을 때 `@EntityGraph`를 그대로 두면 2.2의 메모리 페이지 나누기가 된다.

### 2.7 저장 1건의 SQL 수

- `TransactionService.create`가 보내는 SQL은 다음과 같아 8~10회로 보인다(추정, 세어 보지 않음).
  - 권한 확인, 계좌 조회, 카테고리 조회, 결제자 확인
  - id 중복 확인, 거래 insert, 라인 insert
  - 이력 최신 조회, 이력 insert
- 세어서 상한으로 고정한다.
- 담당: ledger.

### 2.8 오프라인 입력 전송

- P-225에 따라 쌓인 N건을 하나씩 보내면 요청이 N번이고 SQL이 약 10N회다(추정).
- 묶음 저장 API를 검토할 만하다.
- 담당: architect.

### 2.9 스키마 변경 예정

- `transaction_line`에 `ledger_id`를 넣는 안이 소유자에게 올라가 있다.
- 채택되면 통계 쿼리의 조인 모양이 바뀐다. 그 결정 뒤에 실행 계획을 잰다.
