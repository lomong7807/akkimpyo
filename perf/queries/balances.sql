-- 장부 전체 계좌의 잔액
-- 코드: BalanceQuery.balances
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(BalanceQueryTest).
-- 가져온 날 2026-11-26, 코드 main a55e96f, Spring Boot 4.2.0, Hibernate 7.4.15.Final, pgJDBC 42.7.14.
--
-- 변수: ledger_no(기본 1)
--       explain(기본 'EXPLAIN (ANALYZE, BUFFERS)', -v explain= 로 비우면 쿼리만 실행)
--       generic(기본 off. on이면 값을 문장에 넣지 않고 PREPARE한 뒤 일반 계획을 강제해 EXECUTE한다)
\set ON_ERROR_STOP on

\if :{?explain}
\else
  \set explain 'EXPLAIN (ANALYZE, BUFFERS)'
\endif
\if :{?generic}
\else
  \set generic off
\endif
\if :{?ledger_no}
\else
  \set ledger_no 1
\endif
SELECT md5('perf-ledger-' || :ledger_no)::uuid AS ledger_id \gset
\set canceled CANCELED

-- PREPARE의 타입은 SQL 로그의 바인드 타입과 같다.
\if :generic
  \set head 'PREPARE q (uuid, uuid, varchar) AS'
  \set p1 $1
  \set p2 $2
  \set p3 $3
\else
  \set head :explain
  \set p1 :'ledger_id'
  \set p2 :'ledger_id'
  \set p3 :'canceled'
\endif

:head
select tl1_0.account_id,cast(sum(tl1_0.amount) as numeric(38,0)) from transaction_line tl1_0 join transaction t1_0 on t1_0.id=tl1_0.transaction_id join account a1_0 on a1_0.id=tl1_0.account_id where tl1_0.ledger_id=:p1 and t1_0.ledger_id=:p2 and t1_0.occurred_on>=a1_0.opening_date and t1_0.deleted_at is null and t1_0.status<>:p3 group by tl1_0.account_id;

\if :generic
  SET plan_cache_mode = force_generic_plan;
  :explain EXECUTE q (:'ledger_id', :'ledger_id', :'canceled');
  DEALLOCATE q;
\endif
