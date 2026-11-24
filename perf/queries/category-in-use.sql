-- 카테고리 사용 여부
-- 코드: TransactionLineRepository.existsByCategoryId (CategoryService.delete)
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(CategoryServiceTest).
-- 가져온 날 2026-11-24, 코드 main 48aa00e, Spring Boot 3.5.16, Hibernate 6.6.53.Final.
--
-- 변수: ledger_no(기본 1), category_kind(기본 EXPENSE), category_no(기본 24 = 거래가 없는 카테고리)
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

:explain
select tl1_0.id from transaction_line tl1_0 where tl1_0.category_id=:'category_id' fetch first :fetch_first rows only;
