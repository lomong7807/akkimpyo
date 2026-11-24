-- 월별 통계(카테고리별 합계)
-- 코드: MonthlyStatsQuery.monthly
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(MonthlyStatsQueryTest).
-- 가져온 날 2026-11-24, 코드 main 48aa00e, Spring Boot 3.5.16, Hibernate 6.6.53.Final.
--
-- 변수: ledger_no(기본 1), month(기본 2026-10)
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
\if :{?month}
\else
  \set month 2026-10
\endif
SELECT (:'month' || '-01')::date AS first_day,
       ((:'month' || '-01')::date + interval '1 month' - interval '1 day')::date AS last_day \gset
\set canceled CANCELED

:explain
select tl1_0.category_id,c1_0.kind,sum(tl1_0.amount) from transaction_line tl1_0 join transaction t1_0 on t1_0.id=tl1_0.transaction_id join category c1_0 on c1_0.id=tl1_0.category_id where t1_0.ledger_id=:'ledger_id' and t1_0.occurred_on between :'first_day' and :'last_day' and t1_0.deleted_at is null and t1_0.status<>:'canceled' group by tl1_0.category_id,c1_0.kind having sum(tl1_0.amount)<>0;
