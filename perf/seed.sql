-- 성능 측정용 시험 데이터. 명령은 perf/README.md에 있다.
--
-- 변수(psql -v 이름=값)
--   ledgers        장부 수                                                      기본 1
--   tx_per_ledger  장부당 거래 수                                               기본 12000
--   start_date     거래 날짜의 시작                                             기본 2016-11-01
--   years          시작 날짜부터 몇 년에 걸칠지                                 기본 10
--   one_account    on이면 모든 거래의 라인 하나가 장부의 첫 계좌에 붙는다.      기본 off
--                  첫 계좌의 라인 수 = tx_per_ledger (잔액 기준선용)
--   seed           난수 씨앗(setseed, -1~1). 같은 변수면 다시 만들어도 같은 값  기본 0.42
--
-- 모두 만든 값이다. 실제 카드 내역, 사람, 가맹점 이름은 쓰지 않는다.
-- 분포와 비율은 perf/README.md에 적었다.
--
-- 안전장치: DB 이름이 perf_로 시작하고 비어 있을 때만 넣는다. 지우는 문장은 없다.
--
-- V1 스키마 기준이다. 이슈 #58(transaction_line에 ledger_id 추가)이 머지되면
-- 아래 transaction_line INSERT에 ledger_id를 넣어야 한다.

\set ON_ERROR_STOP on

\if :{?ledgers}
\else
  \set ledgers 1
\endif
\if :{?tx_per_ledger}
\else
  \set tx_per_ledger 12000
\endif
\if :{?start_date}
\else
  \set start_date 2016-11-01
\endif
\if :{?years}
\else
  \set years 10
\endif
\if :{?one_account}
\else
  \set one_account off
\endif
\if :{?seed}
\else
  \set seed 0.42
\endif

DO $$
BEGIN
    IF current_database() NOT LIKE 'perf\_%' THEN
        RAISE EXCEPTION '측정용 DB가 아니다: %. 이름이 perf_로 시작하는 DB에만 넣는다.', current_database();
    END IF;
    IF EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM ledger) OR EXISTS (SELECT 1 FROM transaction) THEN
        RAISE EXCEPTION '% DB가 비어 있지 않다. 새 DB를 만들어 넣는다.', current_database();
    END IF;
END
$$;

BEGIN;

SELECT setseed(:seed) \g /dev/null

-- 사용자, 장부, OWNER 구성원: 장부마다 1명
INSERT INTO users (id, email, password_hash, display_name, created_at)
SELECT md5('perf-user-' || l)::uuid,
       'perf-user-' || l || '@example.invalid',
       'not-a-real-hash',
       '시험 사용자 ' || l,
       :'start_date'::date::timestamp AT TIME ZONE 'Asia/Seoul'
  FROM generate_series(1, :ledgers) AS l;

INSERT INTO ledger (id, name, timezone, created_at)
SELECT md5('perf-ledger-' || l)::uuid,
       '시험 장부 ' || l,
       'Asia/Seoul',
       :'start_date'::date::timestamp AT TIME ZONE 'Asia/Seoul'
  FROM generate_series(1, :ledgers) AS l;

INSERT INTO ledger_member (id, ledger_id, user_id, role, created_at)
SELECT md5('perf-member-' || l)::uuid,
       md5('perf-ledger-' || l)::uuid,
       md5('perf-user-' || l)::uuid,
       'OWNER',
       :'start_date'::date::timestamp AT TIME ZONE 'Asia/Seoul'
  FROM generate_series(1, :ledgers) AS l;

-- 계좌: 장부마다 5~10개. 기준일은 거래가 시작되는 날이라 모든 거래가 잔액에 들어간다.
INSERT INTO account (id, ledger_id, name, type, opening_balance, opening_date, currency, created_at)
SELECT md5('perf-account-' || l || '-' || a)::uuid,
       md5('perf-ledger-' || l)::uuid,
       '시험 계좌 ' || a,
       (ARRAY['BANK', 'CARD', 'CASH'])[1 + (a - 1) % 3],
       CASE WHEN (a - 1) % 3 = 1 THEN 0 ELSE a * 100000 END,
       :'start_date'::date,
       'KRW',
       :'start_date'::date::timestamp AT TIME ZONE 'Asia/Seoul' + a * interval '1 minute'
  FROM generate_series(1, :ledgers) AS l
 CROSS JOIN LATERAL generate_series(1, 5 + l % 6) AS a;

-- 카테고리: 장부마다 30개.
--   지출: 0 = 미분류(system), 1~6 = 상위, 7~24 = 하위(상위마다 3개). 24번에는 거래를 붙이지 않는다.
--   수입: 0 = 미분류(system), 1~2 = 상위, 3~4 = 하위
INSERT INTO category (id, ledger_id, kind, name, parent_id, system, created_at)
SELECT md5('perf-category-' || l || '-' || k.kind || '-' || c)::uuid,
       md5('perf-ledger-' || l)::uuid,
       k.kind,
       CASE WHEN c = 0 THEN '미분류' ELSE '시험 ' || k.label || ' ' || c END,
       CASE WHEN c > k.top_count
            THEN md5('perf-category-' || l || '-' || k.kind || '-' || (1 + (c - 1) % k.top_count))::uuid END,
       c = 0,
       :'start_date'::date::timestamp AT TIME ZONE 'Asia/Seoul' + c * interval '1 minute'
  FROM generate_series(1, :ledgers) AS l
 CROSS JOIN (VALUES ('EXPENSE', '지출', 6, 24), ('INCOME', '수입', 2, 4)) AS k(kind, label, top_count, last_no)
 CROSS JOIN LATERAL generate_series(0, k.last_no) AS c;

-- 거래 한 건의 모든 값을 여기서 정한다. 난수는 안쪽 SELECT에서 거래 순서대로 뽑는다.
-- 장부 순서가 아니라 날짜 순서로 번갈아 만들어, 여러 장부의 거래가 섞여 쌓이는 실제 모양과 맞춘다.
CREATE TEMP TABLE seed_tx ON COMMIT DROP AS
SELECT b.*,
       CASE WHEN b.is_deleted OR b.is_canceled
            THEN b.created_at + (1 + b.r_later * 6) * interval '1 day' END AS changed_at
  FROM (
        SELECT d.i,
               d.ledger_no,
               d.r_later,
               md5('perf-tx-' || d.i)::uuid AS id,
               d.type,
               d.occurred_on,
               d.occurred_time,
               (d.occurred_on + coalesce(d.occurred_time, time '12:00')) AT TIME ZONE 'Asia/Seoul' AS created_at,
               d.r_state < 0.02 AS is_deleted,
               d.r_state >= 0.02 AND d.r_state < 0.03 AS is_canceled,
               d.account_no,
               -- account_no와 항상 다른 계좌
               1 + (d.account_no + floor(d.r_other * (d.account_count - 1))::int) % d.account_count
                   AS other_account_no,
               CASE WHEN d.r_uncategorized < 0.05 THEN 0
                    WHEN d.type = 'EXPENSE' THEN 1 + floor(power(d.r_category, 2) * 23)::int
                    ELSE 1 + floor(d.r_category * 4)::int END AS category_no,
               CASE d.type
                    WHEN 'EXPENSE' THEN -(floor(power(10, 1 + d.r_amount * 2.2))::bigint * 100)
                    WHEN 'INCOME' THEN floor(10 + d.r_amount * 390)::bigint * 10000
                    ELSE floor(1 + d.r_amount * 100)::bigint * 10000
                         * CASE WHEN d.r_direction < 0.5 THEN -1 ELSE 1 END END AS amount,
               CASE WHEN d.type = 'TRANSFER' OR d.r_has_payee >= 0.9 THEN NULL
                    WHEN d.type = 'EXPENSE' THEN '시험가맹점 ' || (1 + floor(power(d.r_payee, 2) * 200)::int)
                    ELSE '시험입금 ' || (1 + floor(d.r_payee * 10)::int) END AS payee,
               CASE WHEN d.r_memo < 0.2 THEN '시험 메모 ' || d.i END AS memo
          FROM (
                SELECT r.*,
                       5 + r.ledger_no % 6 AS account_count,
                       CASE WHEN r.r_type < 0.85 THEN 'EXPENSE'
                            WHEN r.r_type < 0.90 THEN 'INCOME'
                            ELSE 'TRANSFER' END AS type,
                       :'start_date'::date
                           + floor((r.seq + r.r_day) * r.total_days / :tx_per_ledger)::int AS occurred_on,
                       CASE WHEN r.r_has_time < 0.7
                            THEN time '00:00' + floor(r.r_time * 1440) * interval '1 minute' END AS occurred_time,
                       CASE WHEN :'one_account'::boolean THEN 1
                            ELSE 1 + floor(power(r.r_account, 1.5) * (5 + r.ledger_no % 6))::int END AS account_no
                  FROM (
                        SELECT g.i,
                               (g.i % :ledgers)::int + 1 AS ledger_no,
                               g.i / :ledgers AS seq,
                               (:'start_date'::date + :years * interval '1 year')::date - :'start_date'::date
                                   AS total_days,
                               random() AS r_type,
                               random() AS r_day,
                               random() AS r_has_time,
                               random() AS r_time,
                               random() AS r_state,
                               random() AS r_later,
                               random() AS r_account,
                               random() AS r_other,
                               random() AS r_direction,
                               random() AS r_uncategorized,
                               random() AS r_category,
                               random() AS r_amount,
                               random() AS r_has_payee,
                               random() AS r_payee,
                               random() AS r_memo
                          FROM generate_series(0, :ledgers::bigint * :tx_per_ledger - 1) AS g(i)
                       ) r
               ) d
       ) b;

INSERT INTO transaction (id, ledger_id, type, occurred_on, occurred_time, payee, memo, status,
                         created_by, paid_by, version, deleted_at, created_at, updated_at)
SELECT s.id,
       md5('perf-ledger-' || s.ledger_no)::uuid,
       s.type,
       s.occurred_on,
       s.occurred_time,
       s.payee,
       s.memo,
       CASE WHEN s.is_canceled THEN 'CANCELED' ELSE 'POSTED' END,
       md5('perf-user-' || s.ledger_no)::uuid,
       CASE WHEN s.type <> 'TRANSFER' THEN md5('perf-user-' || s.ledger_no)::uuid END,
       CASE WHEN s.changed_at IS NULL THEN 1 ELSE 2 END,
       CASE WHEN s.is_deleted THEN s.changed_at END,
       s.created_at,
       coalesce(s.changed_at, s.created_at)
  FROM seed_tx s;

-- 지출과 수입은 라인 1개, 이체는 카테고리 없는 라인 2개(합 0)
INSERT INTO transaction_line (id, transaction_id, account_id, category_id, amount, created_at)
SELECT md5('perf-line-' || s.i || '-' || n.line_no)::uuid,
       s.id,
       md5('perf-account-' || s.ledger_no || '-'
           || CASE n.line_no WHEN 1 THEN s.account_no ELSE s.other_account_no END)::uuid,
       CASE WHEN s.type <> 'TRANSFER'
            THEN md5('perf-category-' || s.ledger_no || '-' || s.type || '-' || s.category_no)::uuid END,
       CASE n.line_no WHEN 1 THEN s.amount ELSE -s.amount END,
       s.created_at
  FROM seed_tx s
 CROSS JOIN (VALUES (1), (2)) AS n(line_no)
 WHERE n.line_no = 1 OR s.type = 'TRANSFER';

COMMIT;

-- VACUUM을 같이 해 두지 않으면 측정 도중에 autovacuum이 돌아 수치가 흔들린다.
VACUUM (ANALYZE);

SELECT (SELECT count(*) FROM ledger) AS ledgers,
       (SELECT count(*) FROM account) AS accounts,
       (SELECT count(*) FROM category) AS categories,
       (SELECT count(*) FROM transaction) AS transactions,
       (SELECT count(*) FROM transaction_line) AS lines,
       (SELECT count(*) FROM transaction WHERE deleted_at IS NOT NULL) AS deleted,
       (SELECT count(*) FROM transaction WHERE status = 'CANCELED') AS canceled,
       (SELECT count(*) FROM transaction WHERE occurred_time IS NULL) AS no_time,
       (SELECT min(occurred_on) || ' ~ ' || max(occurred_on) FROM transaction) AS occurred_on;
