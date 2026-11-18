# 1단계 기반(저장소·뼈대·데이터 구조) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가계부 1단계의 화면과 무관한 기반을 만든다. 서버·웹 프로젝트 뼈대, 로컬 Docker 구성, 장부·계좌·카테고리·거래의 저장 구조와 그 규칙을 지키는 서비스 계층, 그리고 이를 검증하는 테스트까지다.

**Architecture:** 기준 데이터는 PostgreSQL 하나다. 이 계획은 REST API와 로그인, 화면을 만들지 않는다. 서비스 계층은 호출자(`actorId`)를 인자로 받아 장부 구성원인지 확인하며, 다음 계획에서 REST와 인증이 이 서비스를 그대로 호출한다. 거래는 헤더 1건과 분개 라인 N건으로 저장한다.

**Tech Stack:** Java 21, Spring Boot 3.5.x(최신 패치), Gradle, Spring Data JPA, Flyway, PostgreSQL 17, JUnit 5, AssertJ, Testcontainers / Node 24, Vite, React, TypeScript, Vitest, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-18-account-book-design.md` (특히 5장, 6장, 7.5, 8장 1단계)

**이 계획에 없는 것(다음 계획):** 인증과 가입 제한, REST API, 화면, 한 줄 입력, 검색, 엑셀 내보내기, 오프라인 입력, 자동 백업, 이벤트(2단계), 자동 입력·할부·환불 연결·분할 입력(3단계). 해당 컬럼(`event_id`, `source`, `reviewed`, `installment_months`, `refund_of` 등)은 그 단계의 마이그레이션에서 추가한다.

## Global Constraints

- 금액은 정수 원이다. Java `long`, DB `BIGINT`. 부동소수점 금지.
- 라인 `amount`는 계좌 잔액을 늘리면 양수, 줄이면 음수다.
- 모든 id는 UUID다. 거래 id는 클라이언트가 만든 값을 그대로 쓴다. 나머지는 서버가 만든다.
- `occurred_on`은 `DATE`, `occurred_time`은 `TIME`(없을 수 있음)이며 장부 시간대의 현지 시각이다. 타임스탬프에서 유도하지 않는다.
- 삭제는 소프트 삭제(`deleted_at`)다. 수정은 `version`이 맞지 않으면 거부한다. 조용히 덮어쓰지 않는다.
- 통계는 이체 라인을 뺀 모든 라인을 합산한다. `CANCELED`와 삭제된 거래는 통계와 잔액에서 빠진다.
- 스키마 변경은 Flyway 마이그레이션으로만 한다. Hibernate는 `ddl-auto=validate`다.
- 서버 코드: 컬렉션 처리는 stream 우선, VO/DTO는 정적 팩토리 메서드 `of()`를 쓴다.
- 기본 패키지는 `app.accountbook`이다. 기능별 패키지(`ledger`, `account`, `category`, `transaction`, `stats`, `user`, `common`)로 나눈다.
- 테스트는 `server/src/test/java`, `web/src/**/__tests__` 또는 `web/tests`에 둔다. 소스 옆에 두지 않는다.
- 사용자에게 보이는 기본 이름은 한국어다: 개인 장부 `내 가계부`, 기본 카테고리 `미분류`.

## Review Focus

1. 같은 거래 생성 요청이 두 번 온다(재전송). 거래는 1건만 있어야 하고, 같은 id에 다른 내용이면 거부해야 한다. → Task 5
2. 낡은 `version`으로 수정·취소·삭제한다. 거부되고 저장된 값은 그대로여야 한다. → Task 5
3. 다른 장부의 계좌나 카테고리를 라인에 넣거나, 구성원이 아닌 사람이 호출한다. 거부해야 한다. → Task 3, 5
4. 계좌 기준일 이전 날짜의 거래를 넣는다. 통계에는 들어가고 잔액에는 반영되지 않아야 한다. → Task 6
5. 거래가 있는 계좌·카테고리를 지우려 한다. 거부하고 거래는 그대로여야 한다. `미분류`는 항상 지울 수 없다. → Task 4

---

### Task 1: 서버 뼈대와 로컬 DB

**Files:**
- Create: `server/` (Spring Boot Gradle 프로젝트, `app.accountbook.AccountBookApplication`)
- Create: `server/src/main/resources/application.yml`
- Create: `server/src/test/java/app/accountbook/support/IntegrationTest.java`
- Create: `server/src/test/java/app/accountbook/AccountBookApplicationTest.java`
- Create: `compose.yaml` (저장소 루트)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `@IntegrationTest` 메타 어노테이션. `@SpringBootTest`에 Testcontainers PostgreSQL 17(컨테이너 1개를 테스트 전체가 공유)과 `@Transactional` 롤백을 묶는다. 이후 모든 서비스 테스트가 이것을 쓴다.

- [ ] **Step 1:** `server/`에 Spring Boot 3.5.x Gradle 프로젝트를 만든다. 의존성: web, data-jpa, validation, actuator, flyway-core, flyway-database-postgresql, postgresql, 테스트용 spring-boot-starter-test, spring-boot-testcontainers, testcontainers postgresql. Java toolchain 21. Gradle wrapper 포함.
- [ ] **Step 2:** `compose.yaml`에 `postgres:17` 서비스 `db`를 둔다. DB·사용자·비밀번호는 모두 `accountbook`, 포트 `5432`, 이름 있는 볼륨. `application.yml`은 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` 환경변수를 읽고 기본값이 이 compose 값이다. `spring.jpa.hibernate.ddl-auto=validate`, `spring.jpa.open-in-view=false`.
- [ ] **Step 3:** 실패하는 테스트를 쓴다.

```java
@IntegrationTest
class AccountBookApplicationTest {
    @Autowired DataSource dataSource;
    @Test void contextLoadsAgainstPostgres() throws Exception {
        try (var c = dataSource.getConnection()) {
            assertThat(c.getMetaData().getDatabaseProductName()).isEqualTo("PostgreSQL");
        }
    }
}
```

- [ ] **Step 4:** `cd server && ./gradlew test` → `IntegrationTest`가 없어 컴파일 실패를 확인한다.
- [ ] **Step 5:** `IntegrationTest`를 구현한다. `./gradlew test` → PASS.
- [ ] **Step 6:** `docker compose up -d db && cd server && ./gradlew bootRun`을 띄우고 `curl -s localhost:8080/actuator/health` → `{"status":"UP"}` 확인 후 종료한다(`docker compose down`).
- [ ] **Step 7:** `.gitignore`에 `server/build/`, `server/.gradle/`, `web/node_modules/`, `web/dist/`, `.idea/`, `*.iml`을 더하고 커밋한다: `서버 프로젝트 뼈대와 로컬 PostgreSQL 구성 추가`.

### Task 2: V1 스키마와 엔터티

**Files:**
- Create: `server/src/main/resources/db/migration/V1__ledger_core.sql`
- Create: 엔터티와 리포지토리 `user/User`, `ledger/Ledger`, `ledger/LedgerMember`, `ledger/LedgerRole`, `account/Account`, `account/AccountType`, `category/Category`, `category/CategoryKind`, `transaction/Transaction`, `transaction/TransactionLine`, `transaction/TransactionType`, `transaction/TransactionStatus`, `transaction/ChangeLog`, `transaction/ChangeAction`
- Test: `server/src/test/java/app/accountbook/SchemaTest.java`

**Interfaces:**
- Produces: 아래 테이블과 같은 이름의 엔터티, 각 엔터티의 Spring Data 리포지토리(`XxxRepository`). enum 값: `LedgerRole{OWNER,MEMBER}`, `AccountType{BANK,CARD,CASH}`, `CategoryKind{INCOME,EXPENSE}`, `TransactionType{EXPENSE,INCOME,TRANSFER}`, `TransactionStatus{PENDING,POSTED,CANCELED}`, `ChangeAction{CREATE,UPDATE,CANCEL,DELETE,RESTORE}`.

스키마(모든 테이블에 `id UUID PK`, `created_at TIMESTAMPTZ NOT NULL`; enum은 `VARCHAR`):

| 테이블 | 컬럼 |
|---|---|
| `users` | `email` UNIQUE NOT NULL, `password_hash` NOT NULL, `display_name` NOT NULL |
| `ledger` | `name` NOT NULL, `timezone` NOT NULL DEFAULT `'Asia/Seoul'` |
| `ledger_member` | `ledger_id` FK, `user_id` FK, `role` NOT NULL, UNIQUE(`ledger_id`,`user_id`) |
| `account` | `ledger_id` FK, `name` NOT NULL, `type` NOT NULL, `opening_balance` BIGINT NOT NULL DEFAULT 0, `opening_date` DATE NOT NULL, `currency` CHAR(3) NOT NULL DEFAULT `'KRW'` |
| `category` | `ledger_id` FK, `kind` NOT NULL, `name` NOT NULL, `parent_id` FK NULL, `system` BOOLEAN NOT NULL DEFAULT false |
| `transaction` | `ledger_id` FK, `type` NOT NULL, `occurred_on` DATE NOT NULL, `occurred_time` TIME NULL, `payee` NULL, `memo` NULL, `status` NOT NULL, `created_by` FK users NOT NULL, `paid_by` FK users NULL, `version` BIGINT NOT NULL, `deleted_at` TIMESTAMPTZ NULL, `updated_at` TIMESTAMPTZ NOT NULL |
| `transaction_line` | `transaction_id` FK ON DELETE CASCADE, `account_id` FK NOT NULL, `category_id` FK NULL, `amount` BIGINT NOT NULL CHECK (`amount` <> 0) |
| `change_log` | `transaction_id` UUID NOT NULL(FK 아님), `ledger_id` UUID NOT NULL, `action` NOT NULL, `actor_id` UUID NOT NULL, `device_id` NULL, `before_value` JSONB NULL, `after_value` JSONB NULL |

인덱스: `transaction(ledger_id, occurred_on)`, `transaction_line(transaction_id)`, `transaction_line(account_id)`, `change_log(transaction_id, created_at)`.

- [ ] **Step 1:** 실패하는 테스트를 쓴다: `SchemaTest.migrationAppliesAndEntitiesValidate()`는 컨텍스트가 뜨는 것(= Flyway 적용과 `ddl-auto=validate` 통과)과 `flyway_schema_history`에 버전 `1`이 성공으로 있는 것을 확인한다. `amountZeroIsRejectedByDatabase()`는 `amount=0` 라인 저장이 `DataIntegrityViolationException`을 내는지 확인한다.
- [ ] **Step 2:** `./gradlew test --tests '*SchemaTest'` → FAIL 확인.
- [ ] **Step 3:** `V1__ledger_core.sql`과 엔터티·리포지토리를 만든다. `Transaction.version`은 JPA `@Version`을 쓰지 않는다(Task 5에서 직접 비교한다). `Transaction`은 `lines`를 `cascade=ALL, orphanRemoval=true`로 가진다.
- [ ] **Step 4:** `./gradlew test` → PASS.
- [ ] **Step 5:** 커밋: `장부·계좌·카테고리·거래 V1 스키마와 엔터티 추가`.

### Task 3: 사용자 생성과 장부 접근 확인

**Files:**
- Create: `user/UserService.java`, `ledger/LedgerAccess.java`, `common/NotLedgerMemberException.java`, `common/NotLedgerOwnerException.java`
- Test: `server/src/test/java/app/accountbook/user/UserServiceTest.java`, `.../ledger/LedgerAccessTest.java`

**Interfaces:**
- Produces:
  - `User UserService.createUser(String email, String passwordHash, String displayName)` — 사용자, 장부 `내 가계부`(시간대 `Asia/Seoul`), `OWNER` 구성원, `system=true`인 `미분류` 카테고리 2개(`INCOME`, `EXPENSE`)를 한 트랜잭션으로 만든다.
  - `void LedgerAccess.requireMember(UUID actorId, UUID ledgerId)` → 아니면 `NotLedgerMemberException`
  - `void LedgerAccess.requireOwner(UUID actorId, UUID ledgerId)` → 아니면 `NotLedgerOwnerException`
  - 테스트 지원: `support/Fixtures`에 `User user(String email)`(= `createUser` 호출)과 `UUID personalLedgerId(User)`.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - `createUser_createsPersonalLedgerWithOwnerAndDefaultCategories`: 장부 1개, 이름 `내 가계부`, 구성원 역할 `OWNER`, 카테고리 2개가 모두 `name="미분류"`, `system=true`, kind는 `INCOME`과 `EXPENSE`.
  - `createUser_rejectsDuplicateEmail`: 같은 이메일 두 번째 호출이 `DuplicateEmailException`.
  - `requireMember_rejectsOutsider`: 다른 사용자의 장부에 대해 `NotLedgerMemberException`. 존재하지 않는 장부 id도 같은 예외(장부 존재 여부를 드러내지 않는다).
  - `requireOwner_rejectsMember`: `MEMBER` 역할 구성원에 대해 `NotLedgerOwnerException`.
- [ ] **Step 2:** FAIL 확인 → 구현 → `./gradlew test` PASS.
- [ ] **Step 3:** 커밋: `사용자 생성 시 개인 장부와 기본 카테고리 생성, 장부 접근 확인 추가`.

### Task 4: 계좌와 카테고리 서비스

**Files:**
- Create: `account/AccountService.java`, `account/AccountCommand.java`, `category/CategoryService.java`, `category/CategoryCommand.java`, `common/InUseException.java`, `common/InvalidRequestException.java`
- Test: `.../account/AccountServiceTest.java`, `.../category/CategoryServiceTest.java`

**Interfaces:**
- Consumes: `LedgerAccess.requireMember`, `Fixtures`
- Produces:
  - `record AccountCommand(String name, AccountType type, long openingBalance, LocalDate openingDate)`
  - `Account AccountService.create(UUID actorId, UUID ledgerId, AccountCommand cmd)`
  - `Account AccountService.update(UUID actorId, UUID accountId, AccountCommand cmd)`
  - `void AccountService.delete(UUID actorId, UUID accountId)`
  - `List<Account> AccountService.list(UUID actorId, UUID ledgerId)`
  - `record CategoryCommand(String name, CategoryKind kind, UUID parentId)`
  - `Category CategoryService.create(UUID actorId, UUID ledgerId, CategoryCommand cmd)`
  - `Category CategoryService.rename(UUID actorId, UUID categoryId, String name)`
  - `void CategoryService.delete(UUID actorId, UUID categoryId)`
  - `List<Category> CategoryService.list(UUID actorId, UUID ledgerId)`
  - `Category CategoryService.uncategorized(UUID ledgerId, CategoryKind kind)` — 그 장부의 `미분류`

규칙: 모든 메서드는 대상의 장부에 대해 `requireMember`를 먼저 한다. 이름은 공백 제거 후 1~50자. 카테고리는 2단계까지다(부모는 최상위여야 하고, 같은 장부·같은 kind여야 한다). `system=true` 카테고리는 이름 변경과 삭제를 거부한다(`InvalidRequestException`). 라인이 참조하는 계좌·카테고리(소프트 삭제된 거래의 라인 포함), 자식이 있는 카테고리는 삭제를 거부한다(`InUseException`). `openingBalance`는 음수를 허용한다(카드 부채).

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - `AccountServiceTest`: `create_storesOpeningBalanceAndDate`, `create_rejectsBlankName`, `create_rejectsOutsider`(`NotLedgerMemberException`), `delete_rejectsAccountWithLines`(`InUseException`, 계좌는 그대로 조회됨), `delete_removesUnusedAccount`.
  - `CategoryServiceTest`: `create_child_underTopLevelParent`, `create_rejectsThirdLevel`, `create_rejectsParentOfOtherKind`, `create_rejectsParentFromOtherLedger`, `delete_rejectsSystemCategory`, `rename_rejectsSystemCategory`, `delete_rejectsCategoryWithLines`, `delete_rejectsCategoryWithChildren`.
  - 라인이 필요한 테스트는 `Transaction`·`TransactionLine`을 리포지토리로 직접 저장해 준비한다(Task 5에 의존하지 않는다).
- [ ] **Step 2:** FAIL 확인 → 구현 → `./gradlew test` PASS.
- [ ] **Step 3:** 커밋: `계좌·카테고리 서비스와 삭제 제한 규칙 추가`.

### Task 5: 거래 쓰기와 변경 이력

**Files:**
- Create: `transaction/TransactionService.java`, `transaction/TransactionCommand.java`, `transaction/TransactionView.java`, `transaction/ChangeLogView.java`, `common/StaleVersionException.java`, `common/IdConflictException.java`, `common/NotFoundException.java`
- Test: `.../transaction/TransactionServiceTest.java`

**Interfaces:**
- Consumes: `LedgerAccess`, `CategoryService.uncategorized`, `Fixtures`
- Produces:

```java
public sealed interface TransactionCommand {
    record Entry(UUID id, TransactionType type,      // EXPENSE 또는 INCOME
                 LocalDate occurredOn, LocalTime occurredTime,
                 UUID accountId, UUID categoryId,    // categoryId null이면 미분류
                 long amount,                        // 항상 양수로 받는다
                 boolean refund,                     // EXPENSE에서만 true 가능
                 String payee, String memo, UUID paidBy) implements TransactionCommand {}
    record Transfer(UUID id, LocalDate occurredOn, LocalTime occurredTime,
                    UUID fromAccountId, UUID toAccountId, long amount,
                    String memo) implements TransactionCommand {}
}
TransactionView create(UUID actorId, UUID ledgerId, TransactionCommand cmd, String deviceId);
TransactionView update(UUID actorId, UUID txId, long expectedVersion, TransactionCommand cmd, String deviceId);
TransactionView cancel(UUID actorId, UUID txId, long expectedVersion, String deviceId);   // status → CANCELED
TransactionView delete(UUID actorId, UUID txId, long expectedVersion, String deviceId);   // deleted_at 설정
TransactionView restore(UUID actorId, UUID txId, long expectedVersion, String deviceId);  // deleted_at 해제
TransactionView get(UUID actorId, UUID txId);
List<TransactionView> listDeleted(UUID actorId, UUID ledgerId);                           // 휴지통
List<ChangeLogView> history(UUID actorId, UUID txId);                                     // 오래된 순
```

`TransactionView.of(Transaction)`는 헤더 필드, `version`, `deleted`, 라인 목록(`accountId`, `categoryId`, `amount`)을 담는다.

규칙:
- 라인 부호: `EXPENSE`는 `-amount`, `refund=true`인 `EXPENSE`는 `+amount`, `INCOME`은 `+amount`. `Transfer`는 `from` 라인 `-amount`, `to` 라인 `+amount`이고 두 라인 모두 `category_id`가 null, `paid_by`도 null이다.
- 새 거래는 `status=POSTED`, `version=1`이다. `paidBy`가 null이면 `actorId`다. `paidBy`는 그 장부의 구성원이어야 한다.
- 검증 실패는 `InvalidRequestException`: `amount <= 0`, `from == to`, 다른 장부의 계좌·카테고리, 카테고리 kind가 거래 type과 다름, `INCOME`인데 `refund=true`, `payee` 100자 초과, `memo` 500자 초과.
- 멱등 생성: 같은 `id`의 거래가 이미 있고(삭제된 것 포함) 같은 장부이며 내용이 같으면 새로 만들지 않고 기존 것을 돌려준다. 이때 `change_log`도 추가하지 않는다. 내용이 다르거나 다른 장부면 `IdConflictException`이다. "내용이 같다"는 type, occurredOn, occurredTime, payee, memo, paidBy와 라인의 (accountId, categoryId, amount) 집합이 같다는 뜻이다.
- `update`는 type을 바꿀 수 없다(`InvalidRequestException`). 라인은 통째로 교체한다. `cmd.id`는 `txId`와 같아야 한다.
- `update`, `cancel`, `delete`, `restore`는 `expectedVersion`이 저장된 `version`과 다르면 `StaleVersionException`을 내고 아무것도 바꾸지 않는다. 성공하면 `version`을 1 올린다. 비교와 증가는 `UPDATE ... WHERE id=? AND version=?`의 영향 행 수로 확인해 동시 요청에서도 하나만 성공하게 한다.
- 삭제된 거래는 `update`·`cancel`을 거부한다(`InvalidRequestException`). `restore`는 삭제된 거래에만 된다.
- 다섯 쓰기 동작은 각각 `change_log` 1행을 추가한다: `action`, `actor_id`, `device_id`, `before_value`(CREATE는 null), `after_value`. 값은 `TransactionView`를 JSON으로 만든 것이다.
- 없는 거래 id와 구성원이 아닌 장부의 거래 id는 모두 `NotFoundException`이다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - `create_expense_storesNegativeLineAndDefaults`: 12000원 지출 → 라인 1개 `amount=-12000`, `status=POSTED`, `version=1`, `paidBy=actor`, 카테고리 미지정이면 `EXPENSE`의 `미분류`.
  - `create_refund_storesPositiveLineWithExpenseCategory`
  - `create_income_storesPositiveLine`
  - `create_transfer_storesTwoLinesWithoutCategory`: 합이 0, 둘 다 category null, `paidBy` null.
  - `create_isIdempotentForSameIdAndContent`: 두 번 호출 후 거래 1건, `change_log` 1행, 두 결과의 `version`이 모두 1.
  - `create_rejectsSameIdWithDifferentContent`: 금액만 바꿔 재호출 → `IdConflictException`, 저장된 금액 그대로.
  - `create_rejectsNonPositiveAmount`(0과 -1), `create_rejectsTransferToSameAccount`, `create_rejectsAccountFromOtherLedger`, `create_rejectsCategoryFromOtherLedger`, `create_rejectsIncomeCategoryOnExpense`, `create_rejectsOutsider`(`NotLedgerMemberException`), `create_rejectsPaidByNonMember`.
  - `update_replacesLinesAndBumpsVersion`: 금액 12000→15000, `version=2`, 라인 1개 `-15000`.
  - `update_rejectsStaleVersion`: `expectedVersion=1`로 두 번 수정 → 두 번째가 `StaleVersionException`, 저장값은 첫 수정 결과.
  - `update_rejectsTypeChange`
  - `cancel_setsStatusCanceled`, `delete_thenRestore_roundTrips`(삭제 후 `listDeleted`에 있고 `restore` 후 없다), `update_rejectsDeletedTransaction`, `delete_rejectsStaleVersion`.
  - `history_recordsEveryWriteInOrder`: create→update→cancel→delete→restore 후 action 순서가 `CREATE, UPDATE, CANCEL, DELETE, RESTORE`, 첫 행 `before_value` null, UPDATE 행의 before 금액 `-12000`·after 금액 `-15000`, 모든 행에 `actor_id`와 `device_id`.
  - `get_hidesOtherLedgersTransaction`: 다른 사용자가 `get` → `NotFoundException`.
- [ ] **Step 2:** `./gradlew test --tests '*TransactionServiceTest'` → FAIL 확인.
- [ ] **Step 3:** 구현한다. → `./gradlew test` PASS.
- [ ] **Step 4:** 커밋: `거래 생성·수정·취소·삭제·복원과 변경 이력 추가`.

### Task 6: 잔액과 월별 통계

**Files:**
- Create: `stats/BalanceQuery.java`, `stats/MonthlyStatsQuery.java`, `stats/MonthlySummary.java`, `stats/CategoryTotal.java`
- Test: `.../stats/BalanceQueryTest.java`, `.../stats/MonthlyStatsQueryTest.java`

**Interfaces:**
- Consumes: `TransactionService.create/cancel/delete`, `AccountService.create`, `Fixtures`
- Produces:
  - `long BalanceQuery.balance(UUID actorId, UUID accountId)`
  - `Map<UUID, Long> BalanceQuery.balances(UUID actorId, UUID ledgerId)` — 장부의 모든 계좌
  - `MonthlySummary MonthlyStatsQuery.monthly(UUID actorId, UUID ledgerId, YearMonth month)`
  - `record MonthlySummary(long income, long expense, List<CategoryTotal> categories)`
  - `record CategoryTotal(UUID categoryId, CategoryKind kind, long total)`

규칙:
- 잔액 = `opening_balance` + 그 계좌 라인 `amount`의 합. 대상은 `occurred_on >= opening_date`, `deleted_at IS NULL`, `status <> 'CANCELED'`인 거래의 라인이다.
- 월별 통계 대상은 `occurred_on`이 그 달이고 `deleted_at IS NULL`, `status <> 'CANCELED'`이며 `category_id`가 있는 라인이다. 계좌 기준일과 무관하다.
- `expense` = 지출 카테고리 라인 합의 부호를 뒤집은 값(환불은 지출을 줄인다). `income` = 수입 카테고리 라인의 합. `CategoryTotal.total`도 같은 부호 규칙을 쓴다(지출은 양수로 표시). 합계가 0인 카테고리는 넣지 않는다.
- 집계는 DB 쿼리(JPQL 또는 네이티브 `SUM ... GROUP BY`)로 한다. 거래를 모두 읽어 Java에서 더하지 않는다.

- [ ] **Step 1:** 실패하는 테스트를 쓴다.
  - `balance_isOpeningPlusLines`: 기준 잔액 100000, 지출 12000, 수입 50000 → 138000.
  - `balance_transferMovesBetweenAccounts`: 은행 100000 → 현금 0으로 30000 이체 → 70000과 30000.
  - `balance_cardIsLiability`: 카드(기준 0) 20000 지출 → -20000. 은행→카드 20000 이체 후 카드 0.
  - `balance_ignoresTransactionsBeforeOpeningDate`: 기준일 11-10, 11-09 지출 5000 → 잔액은 기준 잔액 그대로. 11-10 지출은 반영된다.
  - `balance_excludesCanceledAndDeleted`
  - `monthly_excludesTransfers`: 이체만 있는 달 → income 0, expense 0, categories 비어 있음.
  - `monthly_refundReducesExpense`: 식비 12000 지출과 식비 2000 환불 → expense 10000, 식비 total 10000.
  - `monthly_includesTransactionsBeforeOpeningDate`: 위 11-09 지출 5000이 11월 expense에 들어간다.
  - `monthly_excludesCanceledAndDeleted`
  - `monthly_groupsUncategorizedUnderDefaultCategory`: 카테고리 없이 넣은 지출이 `미분류` id로 집계된다.
  - `monthly_boundaries`: 10-31과 12-01 거래는 11월 통계에 없다.
  - `monthly_rejectsOutsider`(`NotLedgerMemberException`).
- [ ] **Step 2:** FAIL 확인 → 구현 → `./gradlew test` PASS.
- [ ] **Step 3:** 커밋: `계좌 잔액과 월별·카테고리별 통계 조회 추가`.

### Task 7: 웹 프로젝트 뼈대 (Task 1~6과 독립, 병렬 가능)

**Files:**
- Create: `web/` (Vite + React + TypeScript), `web/vite.config.ts`, `web/src/App.tsx`, `web/tests/App.test.tsx`

**Interfaces:**
- Produces: `npm run dev`(포트 5173, `/api`와 `/actuator`를 `http://localhost:8080`으로 프록시), `npm run build`, `npm run lint`, `npm test`.

이 Task는 뼈대만 만든다. 화면 설계는 기획 문서 이후의 일이므로 실제 화면, 라우팅, 상태 관리, UI 라이브러리, PWA 설정을 넣지 않는다.

- [ ] **Step 1:** `web/`에 Vite React TypeScript 프로젝트를 만들고 Vitest, `@testing-library/react`, `jsdom`, ESLint를 설정한다. 템플릿의 예제 화면과 자산은 지운다.
- [ ] **Step 2:** 실패하는 테스트를 쓴다: `App.test.tsx`의 `renders app title`은 `<App />`에 제목 `가계부`(heading)가 있는지 확인한다. `npm test` → FAIL.
- [ ] **Step 3:** `App.tsx`가 `<h1>가계부</h1>`만 그리게 하고 `<html lang="ko">`, `<title>가계부</title>`로 맞춘다. `npm test`, `npm run lint`, `npm run build` → 모두 통과.
- [ ] **Step 4:** 커밋: `웹 프로젝트 뼈대 추가`.
