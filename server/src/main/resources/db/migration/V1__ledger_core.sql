-- 1단계 핵심 스키마: 사용자, 장부, 구성원, 계좌, 카테고리, 거래(헤더 + 분개 라인), 변경 이력
-- 금액은 정수 원(BIGINT). 라인 amount는 계좌 잔액을 늘리면 양수, 줄이면 음수다.

CREATE TABLE users (
    id            UUID         PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL
);

CREATE TABLE ledger (
    id         UUID         PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    timezone   VARCHAR(64)  NOT NULL DEFAULT 'Asia/Seoul',
    created_at TIMESTAMPTZ  NOT NULL
);

CREATE TABLE ledger_member (
    id         UUID        PRIMARY KEY,
    ledger_id  UUID        NOT NULL REFERENCES ledger (id),
    user_id    UUID        NOT NULL REFERENCES users (id),
    role       VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (ledger_id, user_id)
);

CREATE TABLE account (
    id              UUID        PRIMARY KEY,
    ledger_id       UUID        NOT NULL REFERENCES ledger (id),
    name            VARCHAR(50) NOT NULL,
    type            VARCHAR(20) NOT NULL,
    opening_balance BIGINT      NOT NULL DEFAULT 0,
    opening_date    DATE        NOT NULL,
    currency        CHAR(3)     NOT NULL DEFAULT 'KRW',
    created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE category (
    id         UUID        PRIMARY KEY,
    ledger_id  UUID        NOT NULL REFERENCES ledger (id),
    kind       VARCHAR(20) NOT NULL,
    name       VARCHAR(50) NOT NULL,
    parent_id  UUID        NULL REFERENCES category (id),
    system     BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE transaction (
    id            UUID         PRIMARY KEY,
    ledger_id     UUID         NOT NULL REFERENCES ledger (id),
    type          VARCHAR(20)  NOT NULL,
    occurred_on   DATE         NOT NULL,
    occurred_time TIME         NULL,
    payee         VARCHAR(100) NULL,
    memo          VARCHAR(500) NULL,
    status        VARCHAR(20)  NOT NULL,
    created_by    UUID         NOT NULL REFERENCES users (id),
    paid_by       UUID         NULL REFERENCES users (id),
    version       BIGINT       NOT NULL,
    deleted_at    TIMESTAMPTZ  NULL,
    created_at    TIMESTAMPTZ  NOT NULL,
    updated_at    TIMESTAMPTZ  NOT NULL
);

CREATE INDEX ix_transaction_ledger_occurred_on ON transaction (ledger_id, occurred_on);

CREATE TABLE transaction_line (
    id             UUID        PRIMARY KEY,
    transaction_id UUID        NOT NULL REFERENCES transaction (id) ON DELETE CASCADE,
    account_id     UUID        NOT NULL REFERENCES account (id),
    category_id    UUID        NULL REFERENCES category (id),
    amount         BIGINT      NOT NULL CHECK (amount <> 0),
    created_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_transaction_line_transaction ON transaction_line (transaction_id);
CREATE INDEX ix_transaction_line_account ON transaction_line (account_id);

-- 변경 이력은 추가만 한다. 거래가 지워져도 남도록 transaction_id는 FK가 아니다.
CREATE TABLE change_log (
    id             UUID         PRIMARY KEY,
    transaction_id UUID         NOT NULL,
    ledger_id      UUID         NOT NULL,
    action         VARCHAR(20)  NOT NULL,
    actor_id       UUID         NOT NULL,
    device_id      VARCHAR(255) NULL,
    before_value   JSONB        NULL,
    after_value    JSONB        NULL,
    created_at     TIMESTAMPTZ  NOT NULL
);

CREATE INDEX ix_change_log_transaction_created ON change_log (transaction_id, created_at);
