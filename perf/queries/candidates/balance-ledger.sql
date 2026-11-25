-- [후보] 계좌 하나의 잔액. 앱이 보내는 SQL이 아니다.
-- 지금 쿼리(../balance.sql)에 transaction_line.ledger_id와 transaction.ledger_id 조건을 더했다(dba, 2026-11-25).
-- transaction_line.ledger_id는 아직 마이그레이션에 없다(이슈 #58).
-- perf/run-diagnosis.sh의 e7이 측정용 DB에 손으로 넣은 뒤에만 돈다.
--
-- 일반 계획에서는 장부 값을 $4, $5로 두 번 보낸다(balances-ledger.sql과 같은 까닭).
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
SELECT id AS account_id, opening_date, ledger_id FROM account WHERE id = md5('perf-account-' || :ledger_no || '-' || :account_no)::uuid \gset
\set canceled CANCELED

\if :generic
  \set head 'PREPARE q (uuid, date, varchar, uuid, uuid) AS'
  \set p1 $1
  \set p2 $2
  \set p3 $3
  \set p4 $4
  \set p5 $5
\else
  \set head :explain
  \set p1 :'account_id'
  \set p2 :'opening_date'
  \set p3 :'canceled'
  \set p4 :'ledger_id'
  \set p5 :'ledger_id'
\endif

:head
select coalesce(sum(l.amount),0) from transaction_line l join transaction t on t.id = l.transaction_id where l.account_id = :p1 and t.occurred_on >= :p2 and t.deleted_at is null and t.status <> :p3 and l.ledger_id = :p4 and t.ledger_id = :p5;

\if :generic
  SET plan_cache_mode = force_generic_plan;
  :explain EXECUTE q (:'account_id', :'opening_date', :'canceled', :'ledger_id', :'ledger_id');
  DEALLOCATE q;
\endif
