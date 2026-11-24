-- 계좌 하나의 잔액
-- 코드: BalanceQuery.balance
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(BalanceQueryTest).
-- 가져온 날 2026-11-24, 코드 main 48aa00e, Spring Boot 3.5.16, Hibernate 6.6.53.Final.
--
-- 변수: ledger_no(기본 1), account_no(기본 1)
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
\if :{?account_no}
\else
  \set account_no 1
\endif
SELECT id AS account_id, opening_date FROM account WHERE id = md5('perf-account-' || :ledger_no || '-' || :account_no)::uuid \gset
\set canceled CANCELED

:explain
select coalesce(sum(tl1_0.amount),0) from transaction_line tl1_0 join transaction t1_0 on t1_0.id=tl1_0.transaction_id where tl1_0.account_id=:'account_id' and t1_0.occurred_on>=:'opening_date' and t1_0.deleted_at is null and t1_0.status<>:'canceled';
