-- 휴지통 목록
-- 코드: TransactionRepository.findByLedgerIdAndDeletedAtIsNotNullOrderByDeletedAtDesc (TransactionService.listDeleted)
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(TransactionServiceTest).
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

:explain
select t1_0.id,t1_0.created_at,t1_0.created_by,t1_0.deleted_at,t1_0.ledger_id,l1_0.transaction_id,l1_0.id,l1_0.account_id,l1_0.amount,l1_0.category_id,l1_0.created_at,t1_0.memo,t1_0.occurred_on,t1_0.occurred_time,t1_0.paid_by,t1_0.payee,t1_0.status,t1_0.type,t1_0.updated_at,t1_0.version from transaction t1_0 left join transaction_line l1_0 on t1_0.id=l1_0.transaction_id where t1_0.ledger_id=:'ledger_id' and t1_0.deleted_at is not null order by t1_0.deleted_at desc;
