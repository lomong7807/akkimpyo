-- [후보] 장부 전체 계좌의 잔액. 앱이 보내는 SQL이 아니다.
-- dba가 2026-11-25에 정한 후보다. 지금 쿼리(../balances.sql)와 다른 점은 장부를 거르는 곳뿐이다.
--   지금: account.ledger_id = 장부
--   후보: transaction_line.ledger_id = 장부, transaction.ledger_id = 장부
-- transaction_line.ledger_id는 아직 마이그레이션에 없다(이슈 #58).
-- perf/run-diagnosis.sh의 e7이 측정용 DB에 손으로 넣은 뒤에만 돈다.
--
-- 일반 계획에서는 장부 값을 $1, $2로 두 번 보낸다. Hibernate가 같은 이름의 변수를 쓴 곳마다 ?를 하나씩 만들기 때문이다.
-- status 조건도 지금 쿼리와 같게 바인드 변수로 보낸다(dba가 준 문장에는 'CANCELED'로 적혀 있다. 리터럴이면 같은 문장이다).
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
select l.account_id, sum(l.amount) from transaction_line l join transaction t on t.id = l.transaction_id join account a on a.id = l.account_id where l.ledger_id = :p1 and t.ledger_id = :p2 and t.occurred_on >= a.opening_date and t.deleted_at is null and t.status <> :p3 group by l.account_id;

\if :generic
  SET plan_cache_mode = force_generic_plan;
  :explain EXECUTE q (:'ledger_id', :'ledger_id', :'canceled');
  DEALLOCATE q;
\endif
