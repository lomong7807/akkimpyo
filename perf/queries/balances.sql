-- 장부 전체 계좌의 잔액
-- 코드: BalanceQuery.balances
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(BalanceQueryTest).
-- 가져온 날 2026-11-24, 코드 main 48aa00e, Spring Boot 3.5.16, Hibernate 6.6.53.Final.
--
-- 변수: ledger_no(기본 1)
--       explain(기본 'EXPLAIN (ANALYZE, BUFFERS)', -v explain= 로 비우면 쿼리만 실행)
\set ON_ERROR_STOP on

\if :{?explain}
\else
  \set explain 'EXPLAIN (ANALYZE, BUFFERS)'
\endif
\if :{?ledger_no}
\else
  \set ledger_no 1
\endif
SELECT md5('perf-ledger-' || :ledger_no)::uuid AS ledger_id \gset
\set canceled CANCELED

:explain
select tl1_0.account_id,sum(tl1_0.amount) from transaction_line tl1_0 join transaction t1_0 on t1_0.id=tl1_0.transaction_id join account a1_0 on a1_0.id=tl1_0.account_id where a1_0.ledger_id=:'ledger_id' and t1_0.occurred_on>=a1_0.opening_date and t1_0.deleted_at is null and t1_0.status<>:'canceled' group by tl1_0.account_id;
