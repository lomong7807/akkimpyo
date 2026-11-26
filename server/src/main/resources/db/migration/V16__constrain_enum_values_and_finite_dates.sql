-- 열거형 컬럼의 허용 값(P-203, P-208, P-220, P-221, P-301), 통화(P-201), 날짜가 유한한지(P-202, P-206), 이슈 #63.
-- 값 목록은 앱의 Java enum(LedgerRole, AccountType, CategoryKind, TransactionType, TransactionStatus, ChangeAction)과
-- 같아야 한다. SchemaValueMatchTest가 둘을 비교한다. enum에 값을 더하거나 빼는 PR은 CHECK를 바꾸는 마이그레이션을 같이 올린다.
-- 이미 어긋난 행(목록 밖의 값, 'KRW'가 아닌 통화, 'infinity'나 '-infinity'인 날짜)이 있으면 실패한다. 여기서 고치지 않는다.
-- 그 행을 먼저 고친 뒤 다시 적용한다.
-- varchar(20) → text는 테이블을 다시 쓰지 않는다(V2). char(3) → text는 account를 다시 쓴다.

ALTER TABLE ledger_member
    ALTER COLUMN role TYPE text,
    ADD CONSTRAINT ck_ledger_member_role_values CHECK (role IN ('OWNER', 'MEMBER'));

ALTER TABLE account
    ALTER COLUMN type TYPE text,
    ADD CONSTRAINT ck_account_type_values CHECK (type IN ('BANK', 'CARD', 'CASH')),
    -- 통화 칸은 두되 KRW만 쓴다(P-201). 바로 전 버전 앱은 이 컬럼을 char(3)으로 검증해서(ddl-auto=validate)
    -- 이 스키마에서 뜨지 않는다.
    ALTER COLUMN currency TYPE text,
    -- 기본값을 새 타입으로 다시 건다.
    ALTER COLUMN currency SET DEFAULT 'KRW',
    -- 하한 CHECK(V9)는 'infinity'를 통과시킨다. 그런 계좌는 잔액 조회가 실패한다(#165).
    ADD CONSTRAINT ck_account_opening_date_finite CHECK (isfinite(opening_date));

ALTER TABLE category
    ALTER COLUMN kind TYPE text,
    ADD CONSTRAINT ck_category_kind_values CHECK (kind IN ('INCOME', 'EXPENSE'));

ALTER TABLE transaction
    ALTER COLUMN type TYPE text,
    ALTER COLUMN status TYPE text,
    ADD CONSTRAINT ck_transaction_type_values CHECK (type IN ('EXPENSE', 'INCOME', 'TRANSFER')),
    ADD CONSTRAINT ck_transaction_status_values CHECK (status IN ('PENDING', 'POSTED', 'CANCELED'));

ALTER TABLE change_log
    ALTER COLUMN action TYPE text,
    ADD CONSTRAINT ck_change_log_action_values
        CHECK (action IN ('CREATE', 'UPDATE', 'CANCEL', 'DELETE', 'RESTORE', 'PURGE'));
