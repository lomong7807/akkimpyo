-- [후보] 장부 전체 잔액의 지금 쿼리와 후보 쿼리가 모든 장부에서 행 단위로 같은지 한 번에 본다.
-- 두 문장에서 장부 조건을 빼고 장부별로 묶었다. 두 차이 열이 0이어야 한다.
-- transaction_line.ledger_id를 손으로 넣은 측정용 DB에서만 돈다(perf/run-diagnosis.sh의 e7).
\set ON_ERROR_STOP on

WITH now_rows AS (
    SELECT a.ledger_id, tl.account_id, sum(tl.amount) AS amount
      FROM transaction_line tl
      JOIN transaction t ON t.id = tl.transaction_id
      JOIN account a ON a.id = tl.account_id
     WHERE t.occurred_on >= a.opening_date
       AND t.deleted_at IS NULL
       AND t.status <> 'CANCELED'
     GROUP BY a.ledger_id, tl.account_id
), candidate_rows AS (
    SELECT l.ledger_id, l.account_id, sum(l.amount) AS amount
      FROM transaction_line l
      JOIN transaction t ON t.id = l.transaction_id
      JOIN account a ON a.id = l.account_id
     WHERE t.ledger_id = l.ledger_id
       AND t.occurred_on >= a.opening_date
       AND t.deleted_at IS NULL
       AND t.status <> 'CANCELED'
     GROUP BY l.ledger_id, l.account_id
)
SELECT (SELECT count(*) FROM now_rows) AS now_count,
       (SELECT count(*) FROM candidate_rows) AS candidate_count,
       (SELECT count(*) FROM (TABLE now_rows EXCEPT TABLE candidate_rows) d) AS only_now,
       (SELECT count(*) FROM (TABLE candidate_rows EXCEPT TABLE now_rows) d) AS only_candidate;
