-- [#58 앞] 계좌 하나의 잔액. 지금 앱이 보내는 SQL이 아니다.
-- 코드: BalanceQuery.balance (main bc91001 = a55e96f의 바로 앞, V9, Spring Boot 4.2.0, Hibernate 7.4.15.Final)
-- SQL은 손으로 쓴 것이 아니다. 그 커밋의 BalanceQueryTest를 SQL 로그를 켜고 돌려 가져왔고 ?만 psql 변수로 바꿨다(2026-11-26).
-- perf/run-diagnosis.sh의 v12(#58 앞뒤 비교)만 쓴다.
--
-- 변수: ledger_no(기본 1), account_no(기본 1)
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
\if :{?account_no}
\else
  \set account_no 1
\endif
SELECT id AS account_id, opening_date FROM account WHERE id = md5('perf-account-' || :ledger_no || '-' || :account_no)::uuid \gset
\set canceled CANCELED

-- PREPARE의 타입은 SQL 로그의 바인드 타입과 같다.
\if :generic
  \set head 'PREPARE q (uuid, date, varchar) AS'
  \set p1 $1
  \set p2 $2
  \set p3 $3
\else
  \set head :explain
  \set p1 :'account_id'
  \set p2 :'opening_date'
  \set p3 :'canceled'
\endif

:head
select cast(coalesce(sum(tl1_0.amount),0) as numeric(38,0)) from transaction_line tl1_0 join transaction t1_0 on t1_0.id=tl1_0.transaction_id where tl1_0.account_id=:p1 and t1_0.occurred_on>=:p2 and t1_0.deleted_at is null and t1_0.status<>:p3;

\if :generic
  SET plan_cache_mode = force_generic_plan;
  :explain EXECUTE q (:'account_id', :'opening_date', :'canceled');
  DEALLOCATE q;
\endif
