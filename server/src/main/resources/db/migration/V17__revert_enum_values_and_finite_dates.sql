-- 임시(PR #210): V16을 앞으로 되돌리는 SQL을 CI에서 돌려 본다. 되돌린다.
ALTER TABLE ledger_member
    DROP CONSTRAINT ck_ledger_member_role_values,
    ALTER COLUMN role TYPE varchar(20);

ALTER TABLE account
    DROP CONSTRAINT ck_account_type_values,
    DROP CONSTRAINT ck_account_currency_values,
    DROP CONSTRAINT ck_account_opening_date_finite,
    ALTER COLUMN type TYPE varchar(20),
    ALTER COLUMN currency TYPE char(3),
    ALTER COLUMN currency SET DEFAULT 'KRW';

ALTER TABLE category
    DROP CONSTRAINT ck_category_kind_values,
    ALTER COLUMN kind TYPE varchar(20);

ALTER TABLE transaction
    DROP CONSTRAINT ck_transaction_type_values,
    DROP CONSTRAINT ck_transaction_status_values,
    DROP CONSTRAINT ck_transaction_occurred_on_finite,
    ALTER COLUMN type TYPE varchar(20),
    ALTER COLUMN status TYPE varchar(20);

ALTER TABLE change_log
    DROP CONSTRAINT ck_change_log_action_values,
    ALTER COLUMN action TYPE varchar(20);
