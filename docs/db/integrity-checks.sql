-- 데이터 점검 쿼리. V1 스키마(main 9a31116) 기준이다. 스키마가 바뀌면 같이 고친다.
-- "점검" 쿼리는 모두 0건이어야 한다.
-- "명세표" 쿼리는 백업 때와 복원 뒤 결과가 같아야 한다.
-- 읽기만 한다.
--
-- 점검 7은 가입 때 기본 카테고리를 만드는 #4가 들어가기 전에는 0건이 아닐 수 있다(추정).
-- 점검 12의 "소유자 1명"은 P-306(소유권 넘기기) 기준이다.

-- [명세표] 테이블별 행 수
SELECT 'users' AS t, count(*) FROM users
UNION ALL SELECT 'ledger', count(*) FROM ledger
UNION ALL SELECT 'ledger_member', count(*) FROM ledger_member
UNION ALL SELECT 'account', count(*) FROM account
UNION ALL SELECT 'category', count(*) FROM category
UNION ALL SELECT 'transaction', count(*) FROM transaction
UNION ALL SELECT 'transaction_line', count(*) FROM transaction_line
UNION ALL SELECT 'change_log', count(*) FROM change_log
ORDER BY t;

-- [명세표] 금액 합계와 최신 시각
SELECT coalesce(sum(amount), 0) AS line_amount_sum,
       coalesce(sum(abs(amount)), 0) AS line_amount_abs_sum
  FROM transaction_line;
SELECT coalesce(sum(opening_balance), 0) AS opening_balance_sum FROM account;
SELECT max(updated_at) AS last_transaction_update FROM transaction;

-- [명세표] Flyway 최신 버전
SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1;

-- [점검 1] 이체 거래는 라인이 2줄이고 합이 0이다
SELECT t.id
  FROM transaction t
  JOIN transaction_line l ON l.transaction_id = t.id
 WHERE t.type = 'TRANSFER'
 GROUP BY t.id
HAVING count(*) <> 2 OR sum(l.amount) <> 0;

-- [점검 2] 라인이 없는 거래
SELECT t.id
  FROM transaction t
 WHERE NOT EXISTS (SELECT 1 FROM transaction_line l WHERE l.transaction_id = t.id);

-- [점검 3] 라인의 계좌가 거래와 다른 장부에 있다
SELECT l.id
  FROM transaction_line l
  JOIN transaction t ON t.id = l.transaction_id
  JOIN account a ON a.id = l.account_id
 WHERE a.ledger_id <> t.ledger_id;

-- [점검 4] 라인의 카테고리가 거래와 다른 장부에 있다
SELECT l.id
  FROM transaction_line l
  JOIN transaction t ON t.id = l.transaction_id
  JOIN category c ON c.id = l.category_id
 WHERE c.ledger_id <> t.ledger_id;

-- [점검 5] 지출·수입 라인에 카테고리가 없거나, 이체 라인에 카테고리가 있다
SELECT l.id
  FROM transaction_line l
  JOIN transaction t ON t.id = l.transaction_id
 WHERE (t.type IN ('EXPENSE', 'INCOME') AND l.category_id IS NULL)
    OR (t.type = 'TRANSFER' AND l.category_id IS NOT NULL);

-- [점검 6] 라인 카테고리의 구분이 거래 유형과 다르다
SELECT l.id
  FROM transaction_line l
  JOIN transaction t ON t.id = l.transaction_id
  JOIN category c ON c.id = l.category_id
 WHERE t.type IN ('EXPENSE', 'INCOME') AND c.kind <> t.type;

-- [점검 7] 장부마다 미분류(system)가 지출 1개, 수입 1개가 아니다
SELECT g.id AS ledger_id, k.kind, count(c.id) AS system_count
  FROM ledger g
 CROSS JOIN (VALUES ('EXPENSE'), ('INCOME')) AS k(kind)
  LEFT JOIN category c ON c.ledger_id = g.id AND c.kind = k.kind AND c.system
 GROUP BY g.id, k.kind
HAVING count(c.id) <> 1;

-- [점검 8] 상위 카테고리가 다른 장부·다른 구분이거나, 3단계 이상이다
SELECT c.id
  FROM category c
  JOIN category p ON p.id = c.parent_id
 WHERE p.ledger_id <> c.ledger_id
    OR p.kind <> c.kind
    OR p.parent_id IS NOT NULL;

-- [점검 9] 같은 장부에 이름이 같은 계좌
SELECT ledger_id, name, count(*)
  FROM account
 GROUP BY ledger_id, name
HAVING count(*) > 1;

-- [점검 10] 같은 상위 아래 이름이 같은 카테고리
SELECT ledger_id, kind, parent_id, name, count(*)
  FROM category
 GROUP BY ledger_id, kind, parent_id, name
HAVING count(*) > 1;

-- [점검 11] 금액 범위 밖(P-201)
SELECT id FROM transaction_line WHERE amount = 0 OR abs(amount) > 9999999999;
SELECT id FROM account WHERE abs(opening_balance) > 9999999999;

-- [점검 12] 구성원이 없는 장부, 소유자가 1명이 아닌 장부
SELECT g.id
  FROM ledger g
  LEFT JOIN ledger_member m ON m.ledger_id = g.id AND m.role = 'OWNER'
 GROUP BY g.id
HAVING count(m.id) <> 1;

-- [점검 13] 정규화가 안 된 이메일(P-101)
SELECT id FROM users WHERE (email COLLATE "C") !~ '^[\x21-\x40\x5B-\x7E]+$' OR char_length(email) > 254;
