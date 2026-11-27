-- 휴지통 목록
-- 코드: TransactionRepository.findByLedgerIdAndDeletedAtIsNotNullOrderByDeletedAtDesc (TransactionService.listDeleted)
-- SQL은 손으로 쓴 것이 아니다. 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 그대로 가져왔고,
-- ?만 psql 변수로 바꿨다(TransactionServiceTest).
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

-- PREPARE의 타입은 SQL 로그의 바인드 타입과 같다.
\if :generic
  \set head 'PREPARE q (uuid) AS'
  \set p1 $1
\else
  \set head :explain
  \set p1 :'ledger_id'
\endif

:head
select t1_0.id,t1_0.created_at,t1_0.created_by,t1_0.deleted_at,t1_0.ledger_id,l1_0.transaction_id,l1_0.id,l1_0.account_id,l1_0.amount,l1_0.category_id,l1_0.created_at,l1_0.ledger_id,t1_0.memo,t1_0.occurred_on,t1_0.occurred_time,t1_0.paid_by,t1_0.payee,t1_0.status,t1_0.type,t1_0.updated_at,t1_0.version from transaction t1_0 left join transaction_line l1_0 on t1_0.id=l1_0.transaction_id where t1_0.ledger_id=:p1 and t1_0.deleted_at is not null order by t1_0.deleted_at desc;

\if :generic
  SET plan_cache_mode = force_generic_plan;
  :explain EXECUTE q (:'ledger_id');
  DEALLOCATE q;
\endif
