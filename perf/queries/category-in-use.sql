-- 카테고리 사용 여부
-- 코드: TransactionLineRepository.existsByCategoryId (CategoryService.delete)
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(CategoryServiceTest).
-- 가져온 날 2026-11-26, 코드 main a55e96f, Spring Boot 4.2.0, Hibernate 7.4.15.Final, pgJDBC 42.7.14.
--
-- 변수: ledger_no(기본 1), category_kind(기본 EXPENSE), category_no(기본 24 = 거래가 없는 카테고리)
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
\if :{?category_kind}
\else
  \set category_kind EXPENSE
\endif
\if :{?category_no}
\else
  \set category_no 24
\endif
SELECT md5('perf-category-' || :ledger_no || '-' || :'category_kind' || '-' || :category_no)::uuid AS category_id \gset
\set fetch_first 1

-- PREPARE의 타입은 SQL 로그의 바인드 타입과 같다.
\if :generic
  \set head 'PREPARE q (uuid, integer) AS'
  \set p1 $1
  \set p2 $2
\else
  \set head :explain
  \set p1 :'category_id'
  \set p2 :fetch_first
\endif

:head
select tl1_0.id from transaction_line tl1_0 where tl1_0.category_id=:p1 fetch first :p2 rows only;

\if :generic
  SET plan_cache_mode = force_generic_plan;
  :explain EXECUTE q (:'category_id', :fetch_first);
  DEALLOCATE q;
\endif
