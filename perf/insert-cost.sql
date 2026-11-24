-- 거래 1,000건(라인 1,100건)을 넣는 시간. perf/run-diagnosis.sh의 e7이 쓴다.
-- 장부 1~1000에 하나씩, 날짜는 2026-10-31, 지출 850 / 수입 50 / 이체 100. 커밋까지 한다.
-- transaction_line.ledger_id를 손으로 넣은 측정용 DB에서만 돈다.
--
-- 변수: run_no(회차. id가 겹치지 않게 회차마다 다르게 준다)
\set ON_ERROR_STOP on

DO $$
BEGIN
    IF current_database() NOT LIKE 'perf\_%' THEN
        RAISE EXCEPTION '측정용 DB가 아니다: %', current_database();
    END IF;
END
$$;

CREATE TEMP TABLE ins_tx AS
SELECT g AS ledger_no,
       md5('perf-ins-' || :run_no || '-' || g)::uuid AS id,
       CASE WHEN g % 20 < 17 THEN 'EXPENSE' WHEN g % 20 = 17 THEN 'INCOME' ELSE 'TRANSFER' END AS type,
       1 + (g * 7 + :run_no) % (5 + g % 6) AS account_no
  FROM generate_series(1, 1000) AS g;
ANALYZE ins_tx;

\timing on
BEGIN;
EXPLAIN (ANALYZE, BUFFERS, WAL)
INSERT INTO transaction (id, ledger_id, type, occurred_on, occurred_time, payee, memo, status,
                         created_by, paid_by, version, deleted_at, created_at, updated_at)
SELECT id, md5('perf-ledger-' || ledger_no)::uuid, type, date '2026-10-31', time '12:00',
       CASE WHEN type <> 'TRANSFER' THEN '시험가맹점 1' END, NULL, 'POSTED',
       md5('perf-user-' || ledger_no)::uuid,
       CASE WHEN type <> 'TRANSFER' THEN md5('perf-user-' || ledger_no)::uuid END,
       1, NULL, now(), now()
  FROM ins_tx;
EXPLAIN (ANALYZE, BUFFERS, WAL)
INSERT INTO transaction_line (id, transaction_id, account_id, category_id, amount, created_at, ledger_id)
SELECT md5('perf-ins-line-' || i.id || '-' || n.line_no)::uuid,
       i.id,
       md5('perf-account-' || i.ledger_no || '-'
           || CASE n.line_no WHEN 1 THEN i.account_no ELSE 1 + i.account_no % (5 + i.ledger_no % 6) END)::uuid,
       CASE WHEN i.type <> 'TRANSFER'
            THEN md5('perf-category-' || i.ledger_no || '-' || i.type || '-1')::uuid END,
       CASE n.line_no WHEN 1 THEN -10000 ELSE 10000 END * CASE WHEN i.type = 'INCOME' THEN -1 ELSE 1 END,
       now(),
       md5('perf-ledger-' || i.ledger_no)::uuid
  FROM ins_tx i
 CROSS JOIN (VALUES (1), (2)) AS n(line_no)
 WHERE n.line_no = 1 OR i.type = 'TRANSFER';
COMMIT;
\timing off
