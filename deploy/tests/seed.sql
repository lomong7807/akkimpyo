-- 백업 시험용 데이터. 모두 만든 값이다. docs/db/integrity-checks.sql의 점검을 통과해야 한다.
-- 덤프가 작은 tmpfs보다 크도록 압축되지 않는 메모를 넣는다.

INSERT INTO users (id, email, password_hash, display_name, created_at)
SELECT md5('user' || i)::uuid, 'user' || i || '@example.com', 'x', '사용자 ' || i, now()
  FROM generate_series(1, 2) i;

INSERT INTO ledger (id, name, created_at)
SELECT md5('ledger' || i)::uuid, '장부 ' || i, now() FROM generate_series(1, 2) i;

INSERT INTO ledger_member (id, ledger_id, user_id, role, created_at)
VALUES (md5('m1')::uuid, md5('ledger1')::uuid, md5('user1')::uuid, 'OWNER', now()),
       (md5('m2')::uuid, md5('ledger2')::uuid, md5('user2')::uuid, 'OWNER', now()),
       (md5('m3')::uuid, md5('ledger1')::uuid, md5('user2')::uuid, 'EDITOR', now());

INSERT INTO account (id, ledger_id, name, type, opening_balance, opening_date, created_at)
SELECT md5('account' || l || '-' || a)::uuid, md5('ledger' || l)::uuid, '계좌 ' || a, 'BANK', 1000000 * a, '2026-01-01', now()
  FROM generate_series(1, 2) l, generate_series(1, 2) a;

INSERT INTO category (id, ledger_id, kind, name, system, created_at)
SELECT md5('system' || l || k)::uuid, md5('ledger' || l)::uuid, k, '미분류', true, now()
  FROM generate_series(1, 2) l, (VALUES ('EXPENSE'), ('INCOME')) AS v(k);

INSERT INTO category (id, ledger_id, kind, name, created_at)
SELECT md5('food' || l)::uuid, md5('ledger' || l)::uuid, 'EXPENSE', '식비', now() FROM generate_series(1, 2) l;

INSERT INTO category (id, ledger_id, kind, name, parent_id, created_at)
SELECT md5('cafe' || l)::uuid, md5('ledger' || l)::uuid, 'EXPENSE', '카페', md5('food' || l)::uuid, now()
  FROM generate_series(1, 2) l;

-- i를 5로 나눈 나머지: 0 이체, 1 수입, 나머지 지출
INSERT INTO transaction (id, ledger_id, type, occurred_on, payee, memo, status, created_by, version, created_at, updated_at)
SELECT md5('tx' || i)::uuid, md5('ledger' || (1 + i % 2))::uuid,
       CASE i % 5 WHEN 0 THEN 'TRANSFER' WHEN 1 THEN 'INCOME' ELSE 'EXPENSE' END,
       date '2026-01-01' + i % 300, '가맹점 ' || i % 50,
       md5(random()::text) || md5(random()::text) || md5(random()::text),
       'CONFIRMED', md5('user' || (1 + i % 2))::uuid, 0, now(), now()
  FROM generate_series(1, 5000) i;

-- 라인의 ledger_id는 그 컬럼이 있는 스키마에만 들어간다(#58). jsonb_populate_record는 테이블에 없는 이름을 무시한다.
INSERT INTO transaction_line
SELECT r.*
  FROM (SELECT md5('line' || i)::uuid AS id,
               md5('tx' || i)::uuid AS transaction_id,
               md5('ledger' || (1 + i % 2))::uuid AS ledger_id,
               md5('account' || (1 + i % 2) || '-1')::uuid AS account_id,
               CASE i % 5 WHEN 0 THEN NULL
                          WHEN 1 THEN md5('system' || (1 + i % 2) || 'INCOME')::uuid
                          ELSE md5('cafe' || (1 + i % 2))::uuid END AS category_id,
               CASE i % 5 WHEN 1 THEN 1000 + i ELSE -(1000 + i) END AS amount,
               now() AS created_at
          FROM generate_series(1, 5000) i) l,
       jsonb_populate_record(NULL::transaction_line, to_jsonb(l)) r;

-- 이체의 받는 쪽 라인
INSERT INTO transaction_line
SELECT r.*
  FROM (SELECT md5('line-in' || i)::uuid AS id,
               md5('tx' || i)::uuid AS transaction_id,
               md5('ledger' || (1 + i % 2))::uuid AS ledger_id,
               md5('account' || (1 + i % 2) || '-2')::uuid AS account_id,
               1000 + i AS amount,
               now() AS created_at
          FROM generate_series(5, 5000, 5) i) l,
       jsonb_populate_record(NULL::transaction_line, to_jsonb(l)) r;

INSERT INTO change_log (id, transaction_id, ledger_id, action, actor_id, after_value, created_at)
SELECT md5('log' || i)::uuid, md5('tx' || i)::uuid, md5('ledger' || (1 + i % 2))::uuid, 'CREATE',
       md5('user' || (1 + i % 2))::uuid, jsonb_build_object('amount', 1000 + i), now()
  FROM generate_series(1, 5000) i;
