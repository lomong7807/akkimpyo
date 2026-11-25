-- [후보] 장부 전체 계좌의 잔액에서 account 조인을 없앤 모양 1. 앱이 보내는 SQL이 아니다(dba, PR #170 댓글).
-- 앱이 이미 읽은 계좌의 id와 기준일을 배열 둘로 보내고, 라인 쪽에서 기준일을 견준다.
-- 지금 쿼리(../balances.sql)와 다른 점은 account 테이블 자리에 unnest(배열, 배열)가 온 것뿐이다.
-- 파라미터는 계좌 수와 관계없이 5개(계좌 id 배열, 기준일 배열, 장부, 장부, 취소 상태)다.
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
SELECT array_agg(id ORDER BY created_at, id) AS account_ids, array_agg(opening_date ORDER BY created_at, id) AS opening_dates
  FROM account WHERE ledger_id = :'ledger_id' \gset
\set canceled CANCELED

\if :generic
  \set head 'PREPARE q (uuid[], date[], uuid, uuid, varchar) AS'
  \set p1 $1
  \set p2 $2
  \set p3 $3
  \set p4 $4
  \set p5 $5
\else
  \set head :explain
  \set p1 :'account_ids'
  \set p2 :'opening_dates'
  \set p3 :'ledger_id'
  \set p4 :'ledger_id'
  \set p5 :'canceled'
\endif

:head
select l.account_id, cast(sum(l.amount) as numeric(38,0)) from transaction_line l join transaction t on t.id = l.transaction_id join unnest(cast(:p1 as uuid[]), cast(:p2 as date[])) as a(id, opening_date) on a.id = l.account_id where l.ledger_id = :p3 and t.ledger_id = :p4 and t.occurred_on >= a.opening_date and t.deleted_at is null and t.status <> :p5 group by l.account_id;

\if :generic
  SET plan_cache_mode = force_generic_plan;
  :explain EXECUTE q (:'account_ids', :'opening_dates', :'ledger_id', :'ledger_id', :'canceled');
  DEALLOCATE q;
\endif
