#!/usr/bin/env bash
# 큰 장부 잔액 진단 측정. 사용법은 perf/README.md의 "진단 측정"에 있다.
#
#   OUT=<결과 폴더> perf/run-diagnosis.sh <단계> [단계...]
#   단계: up seed base e1 e2 e3 e4 e5 e6 e7 base-again down
#
# 측정용 프로젝트 akkimpyo-perf(포트 5434)와 이름이 perf_로 시작하는 DB만 건드린다.
# 실행 계획 원문을 OUT 아래에 남기고, 숫자는 perf/summarize-diagnosis.mjs가 뽑는다.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${OUT:?결과를 둘 폴더를 OUT으로 준다(레포 밖)}"
mkdir -p "$OUT"
read -r -a DBS <<< "${DBS:-perf_mix_50k perf_mix_200k}"
BIG=${BIG:-1001}      # 큰 장부 번호
NORMAL=${NORMAL:-1}   # 보통 장부 번호

BALANCE=perf/queries/balance.sql
BALANCES=perf/queries/balances.sql
MONTHLY=perf/queries/monthly-stats.sql
TRASH=perf/queries/trash-list.sql
C_BALANCE=perf/queries/candidates/balance-ledger.sql
C_BALANCES=perf/queries/candidates/balances-ledger.sql

INDEX_A="CREATE INDEX ix_transaction_line_ledger_account ON transaction_line (ledger_id, account_id) INCLUDE (transaction_id, amount)"
INDEX_B="CREATE INDEX ix_transaction_ledger_live ON transaction (ledger_id, occurred_on) INCLUDE (id, status) WHERE deleted_at IS NULL"
INDEX_OLD="CREATE INDEX ix_transaction_ledger_occurred_on ON transaction (ledger_id, occurred_on)"

# 컨테이너가 블록 장치에서 실제로 읽은 바이트(누적). 실행 사이에 넣어 OS 캐시 읽기와 디스크 읽기를 가른다.
IO_MARK="SELECT 'io ' || (regexp_match(pg_read_file('/sys/fs/cgroup/io.stat'), 'rbytes=([0-9]+)'))[1];"

COMPOSE_FILES=(-f compose.yaml -f compose.perf.yaml)
dc() { docker compose -p akkimpyo-perf "${COMPOSE_FILES[@]}" "$@"; }
perfsql() { dc exec -T db psql -X -q -v ON_ERROR_STOP=1 -U accountbook "$@"; }
sql() { local db=$1; shift; perfsql -At -F ' | ' -d "$db" "$@" < /dev/null; }

load1() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ,; }
mark() { printf '%s\t%s\t%s\n' "$(date '+%F %T')" "$(load1)" "$*" | tee -a "$OUT/timeline.tsv"; }
wait_ready() { until dc exec -T db pg_isready -q -h localhost -U accountbook -d accountbook < /dev/null; do sleep 1; done; }

# 단계가 시작될 때 그때의 조건을 남긴다.
step() {
  # docker ps는 Docker Desktop의 Kubernetes 컨테이너를 숨긴다. docker info의 수에는 들어 있다.
  mark "== $* 시작. 다른 컨테이너(docker ps): [$(docker ps --format '{{.Names}}' | grep -v '^akkimpyo-perf' | tr '\n' ' ' || true)], 실행 중 전체(docker info): $(docker info --format '{{.ContainersRunning}}')"
}

# run10 <결과 폴더> <db> <쿼리 파일> <장부> <lit|gen> [세션 SET 문]
# 한 세션에서 10번. 버리는 것(앞 3번)은 요약할 때 한다.
run10() {
  local dir=$1 db=$2 file=$3 ledger=$4 mode=$5 prelude=${6:-}
  local name generic=off out
  name=$(basename "$file" .sql)
  [ "$mode" = gen ] && generic=on
  out="$OUT/$dir/$db/$name.$ledger.$mode.txt"
  mkdir -p "$(dirname "$out")"
  mark "$dir $db $name $ledger $mode"
  {
    printf '%s\n%s\n' "$prelude" "$IO_MARK"
    for _ in 1 2 3 4 5 6 7 8 9 10; do cat "$file"; printf '%s\n' "$IO_MARK"; done
  } | perfsql -At -d "$db" -v ledger_no="$ledger" -v generic=$generic > "$out"
}

# cells <결과 폴더> <db> <세션 SET 문> <쿼리 파일...>: 큰 장부와 보통 장부를 리터럴과 일반 계획으로
cells() {
  local dir=$1 db=$2 prelude=$3 file ledger mode
  shift 3
  for file in "$@"; do
    for ledger in "$BIG" "$NORMAL"; do
      for mode in lit gen; do run10 "$dir" "$db" "$file" "$ledger" "$mode" "$prelude"; done
    done
  done
}

# 측정용 DB 파일만 OS 페이지 캐시에서 내린다(posix_fadvise DONTNEED). VM 전체 캐시는 비우지 않는다.
evict_files() {
  # shellcheck disable=SC2016
  dc exec -T db bash -c 'sync; find "$PGDATA/base" "$PGDATA/global" -type f -exec dd if={} iflag=nocache count=0 status=none \;' < /dev/null
}

# cold <결과 폴더> <db> <쿼리 파일> <장부> <restart|evict>: 첫 실행을 세 번 되풀이한다.
# 매번 같은 쿼리를 세 번 돌려 OS 캐시에 올린 뒤 PostgreSQL을 재시작한다. evict면 파일 캐시까지 내린다.
cold() {
  local dir=$1 db=$2 file=$3 ledger=$4 kind=$5 name rep out
  name=$(basename "$file" .sql)
  mkdir -p "$OUT/$dir/$db"
  for rep in 1 2 3; do
    out="$OUT/$dir/$db/$name.$ledger.$kind.$rep.txt"
    cat "$file" "$file" "$file" | perfsql -At -d "$db" -v ledger_no="$ledger" > /dev/null
    dc restart db > /dev/null 2>&1
    wait_ready
    if [ "$kind" = evict ]; then evict_files; fi
    mark "$dir $db $name $ledger $kind $rep"
    { printf 'SET track_io_timing = on;\n%s\n' "$IO_MARK"; cat "$file"; printf '%s\n' "$IO_MARK"; } \
      | perfsql -At -d "$db" -v ledger_no="$ledger" > "$out"
  done
}

cold_cells() {
  local dir=$1 db=$2 kind=$3 file ledger
  shift 3
  for file in "$@"; do
    for ledger in "$BIG" "$NORMAL"; do cold "$dir" "$db" "$file" "$ledger" "$kind"; done
  done
}

# 사본은 파일째 복사라 저장 순서와 통계까지 원본과 같다.
clone_db() {
  case "$2" in perf_*) ;; *) echo "perf_로 시작하는 DB만 만든다: $2" >&2; exit 1 ;; esac
  sql postgres -c "DROP DATABASE IF EXISTS $2" -c "CREATE DATABASE $2 TEMPLATE $1 STRATEGY FILE_COPY"
}
drop_db() {
  case "$1" in perf_*_e6 | perf_*_e7) sql postgres -c "DROP DATABASE $1" ;; *) echo "사본만 지운다: $1" >&2; exit 1 ;; esac
}

mkdb() {
  local f
  sql postgres -c "CREATE DATABASE $1"
  for f in $(ls server/src/main/resources/db/migration/V*.sql | sort -V); do perfsql -d "$1" < "$f"; done
}

facts() { # facts <결과 파일> <db> <SQL...>: 크기나 통계 같은 사실을 남긴다
  local out="$OUT/$1" db=$2
  shift 2
  mkdir -p "$(dirname "$out")"
  { for q in "$@"; do printf -- '-- %s\n' "$q"; perfsql -d "$db" -c "$q" < /dev/null; done; } >> "$out"
}

SIZES="SELECT c.relname, c.relkind, pg_relation_size(c.oid) AS bytes, pg_size_pretty(pg_relation_size(c.oid)) AS size, c.reltuples::bigint, c.relallvisible, c.relpages
         FROM pg_class c
        WHERE c.oid IN ('transaction'::regclass, 'transaction_line'::regclass)
           OR c.oid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN ('transaction'::regclass, 'transaction_line'::regclass))
        ORDER BY c.relkind DESC, c.relname"
# 장부의 라인이 흩어진 블록 수(겹치지 않게 센 것)와 라인 수
scatter_sql() {
  echo "SELECT '장부 $1' AS ledger, count(*) AS lines, count(DISTINCT (l.ctid::text::point)[0]) AS distinct_blocks
          FROM transaction_line l JOIN account a ON a.id = l.account_id
         WHERE a.ledger_id = md5('perf-ledger-$1')::uuid"
}
VACUUMS="SELECT relname, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, n_dead_tup FROM pg_stat_user_tables WHERE relname IN ('transaction', 'transaction_line', 'account') ORDER BY 1"

do_up() { dc up -d; wait_ready; }

do_seed() {
  local db
  step seed
  for db in "${DBS[@]}"; do
    mkdb "$db"
    mark "seed $db"
    case "$db" in
      perf_mix_50k) perfsql -d "$db" -v ledgers=1000 -v tx_per_ledger=3000 -v big_ledger_tx=50000 < perf/seed.sql ;;
      perf_mix_200k) perfsql -d "$db" -v ledgers=1000 -v tx_per_ledger=3000 -v big_ledger_tx=200000 -v big_one_account=on < perf/seed.sql ;;
      *) perfsql -d "$db" -v ledgers=1000 -v tx_per_ledger="${TX_PER_LEDGER:-20}" -v big_ledger_tx="${BIG_TX:-500}" < perf/seed.sql ;;
    esac | tee "$OUT/seed.$db.txt"
    grep -v flyway_schema_history docs/db/integrity-checks.sql | perfsql -d "$db" > "$OUT/integrity.$db.txt"
    facts "seed-facts.$db.txt" "$db" "SELECT pg_size_pretty(pg_database_size(current_database()))" "$SIZES" \
      "$(scatter_sql "$BIG")" "$(scatter_sql "$NORMAL")" \
      "SELECT count(*) AS accounts, count(DISTINCT ledger_id) AS ledgers FROM account"
  done
  sql postgres -c CHECKPOINT
}

do_base() {
  local dir=${1:-base} db
  step "$dir"
  for db in "${DBS[@]}"; do
    cells "$dir" "$db" "" "$BALANCES" "$BALANCE"
    facts "$dir.vacuum.$db.txt" "$db" "$VACUUMS"
  done
}

do_e1() {
  local db
  step e1
  dc exec -T db pg_test_timing -d 3 < /dev/null > "$OUT/pg_test_timing.txt"
  for db in "${DBS[@]}"; do cells e1 "$db" "SET track_io_timing = on;" "$BALANCES" "$BALANCE"; done
}

# (가) restart: PostgreSQL만 재시작. (나)의 VM 전체 캐시 비우기는 하지 않는다.
# evict: 재시작한 뒤 측정용 DB 파일만 OS 캐시에서 내린다.
do_e2() {
  local db kind
  step e2
  for kind in restart evict; do
    for db in "${DBS[@]}"; do cold_cells e2 "$db" "$kind" "$BALANCES" "$BALANCE"; done
  done
}

do_e3() {
  local db
  step e3
  COMPOSE_FILES+=(-f perf/compose.big-cache.yaml)
  dc up -d
  wait_ready
  facts e3.settings.txt postgres "SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers', 'effective_cache_size')"
  for db in "${DBS[@]}"; do
    # 앞 DB의 블록이 남아 자리를 다투지 않게 비우고 시작한다.
    dc restart db > /dev/null 2>&1
    wait_ready
    cells e3 "$db" "" "$BALANCES" "$BALANCE"
    cells e3-io "$db" "SET track_io_timing = on;" "$BALANCES" "$BALANCE"
  done
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' akkimpyo-perf-db-1 > "$OUT/e3.docker-stats.txt"
  COMPOSE_FILES=(-f compose.yaml -f compose.perf.yaml)
  dc up -d
  wait_ready
}

# 쿼리 파일의 문장을 한 번 PREPARE하고 기본 설정(auto)으로 10번 EXECUTE하는 psql 입력을 만든다.
auto_session() {
  local file=$1 sequence=$2 exec_line reset_lines count
  local plans="SELECT 'plans generic=' || generic_plans || ' custom=' || custom_plans FROM pg_prepared_statements WHERE name = 'q';"
  exec_line=$(grep -E '^ *:explain EXECUTE' "$file")
  # 장부 번호에서 나오는 값을 다시 만드는 줄
  reset_lines=$(grep -E '^SELECT .*:ledger_no.*\\gset' "$file")
  echo 'SET plan_cache_mode = auto;'
  awk '$0 == "\\if :generic" {n++} n < 2' "$file"
  for count in 1 2 3 4 5 6 7 8 9 10; do
    if [ "$sequence" = mix ] && [ "$count" = 6 ]; then printf '\\set ledger_no %s\n%s\n' "$BIG" "$reset_lines"; fi
    printf '%s\n%s\n' "$exec_line" "$plans"
  done
}

do_e4() {
  local db file sequence first name
  step e4
  for db in "${DBS[@]}"; do
    mkdir -p "$OUT/e4/$db"
    for file in "$BALANCES" "$BALANCE" "$MONTHLY" "$TRASH"; do
      name=$(basename "$file" .sql)
      for sequence in big normal mix; do
        case $sequence in big) first=$BIG ;; *) first=$NORMAL ;; esac
        # 캐시 데우기: 쓸 장부마다 리터럴로 세 번
        if [ "$sequence" = mix ]; then
          cat "$file" "$file" "$file" | perfsql -At -d "$db" -v ledger_no="$BIG" > /dev/null
        fi
        cat "$file" "$file" "$file" | perfsql -At -d "$db" -v ledger_no="$first" > /dev/null
        mark "e4 $db $name $sequence"
        auto_session "$file" "$sequence" | perfsql -At -d "$db" -v ledger_no="$first" -v generic=on > "$OUT/e4/$db/$name.$sequence.txt"
      done
    done
  done
}

do_e5() {
  local db
  step e5
  for db in "${DBS[@]}"; do cells e5 "$db" "SET random_page_cost = 1.1;" "$BALANCES" "$BALANCE"; done
}

do_e6() {
  local db copy
  local stats="SELECT attname, n_distinct, correlation, array_length(most_common_vals, 1) AS mcv_count, array_length(histogram_bounds, 1) AS histogram_bounds FROM pg_stats WHERE tablename = 'transaction_line' AND attname IN ('account_id', 'transaction_id')"
  step e6
  for db in "${DBS[@]}"; do
    copy=${db}_e6
    clone_db "$db" "$copy"
    facts "e6.stats.$db.txt" "$copy" "$stats"
    sql "$copy" -c "ALTER TABLE transaction_line ALTER COLUMN account_id SET STATISTICS 1000" -c "ANALYZE transaction_line" -c CHECKPOINT
    facts "e6.stats.$db.txt" "$copy" "$stats"
    cells e6 "$copy" "" "$BALANCES" "$BALANCE"
    facts "e6.vacuum.$db.txt" "$copy" "$VACUUMS"
    drop_db "$copy"
  done
}

# 지금 쿼리와 후보 쿼리의 결과를 행 단위로 비교한다.
same_result() {
  local db=$1 out="$OUT/e7.same.$1.txt" ledger account accounts
  {
    echo "[모든 장부] now_count | candidate_count | only_now | only_candidate"
    perfsql -At -F ' | ' -d "$db" < perf/queries/candidates/check-same-result.sql
    for ledger in "$BIG" "$NORMAL"; do
      if diff <(perfsql -At -d "$db" -v explain= -v ledger_no="$ledger" < "$BALANCES" | sort) \
              <(perfsql -At -d "$db" -v explain= -v ledger_no="$ledger" < "$C_BALANCES" | sort); then
        echo "장부 전체 잔액, 장부 $ledger: 같다"
      else
        echo "장부 전체 잔액, 장부 $ledger: 다르다"
      fi
      accounts=$(sql "$db" -c "SELECT count(*) FROM account WHERE ledger_id = md5('perf-ledger-$ledger')::uuid")
      for account in $(seq "$accounts"); do
        if diff <(perfsql -At -d "$db" -v explain= -v ledger_no="$ledger" -v account_no="$account" < "$BALANCE") \
                <(perfsql -At -d "$db" -v explain= -v ledger_no="$ledger" -v account_no="$account" < "$C_BALANCE"); then
          echo "계좌 하나 잔액, 장부 $ledger 계좌 $account: 같다"
        else
          echo "계좌 하나 잔액, 장부 $ledger 계좌 $account: 다르다"
        fi
      done
    done
  } > "$out"
}

add_ledger_id() {
  local db=$1
  mark "e7 $db ledger_id 넣기"
  sql "$db" -c "ALTER TABLE transaction_line ADD COLUMN ledger_id uuid" \
    -c "UPDATE transaction_line l SET ledger_id = t.ledger_id FROM transaction t WHERE t.id = l.transaction_id" \
    -c "ALTER TABLE transaction_line ALTER COLUMN ledger_id SET NOT NULL" \
    -c "VACUUM (FULL, ANALYZE) transaction_line"
  # VACUUM FULL은 visibility map을 만들지 않는다. 뒤의 조합과 같게 맞춘다.
  sql "$db" -c "VACUUM (ANALYZE)" -c CHECKPOINT
}

after_index() { sql "$1" -c "VACUUM (ANALYZE)" -c CHECKPOINT; }

insert_cost() { # insert_cost <db> <이름> <첫 회차>: 첫 번째는 데우기, 뒤의 5번을 센다
  local db=$1 label=$2 first=$3 i
  mkdir -p "$OUT/e7/insert/$db"
  for i in 0 1 2 3 4 5; do
    mark "e7 $db insert $label $i"
    perfsql -At -d "$db" -v run_no=$((first + i)) < perf/insert-cost.sql > "$OUT/e7/insert/$db/$label.$i.txt"
  done
}

do_e7() {
  local db copy
  step e7
  for db in "${DBS[@]}"; do
    copy=${db}_e7
    clone_db "$db" "$copy"
    facts "e7.sizes.$db.txt" "$copy" "SELECT 'ledger_id 넣기 전' AS state" "$SIZES" "$(scatter_sql "$BIG")" "$(scatter_sql "$NORMAL")"
    add_ledger_id "$copy"
    facts "e7.sizes.$db.txt" "$copy" "SELECT 'ledger_id 넣고 VACUUM FULL 뒤' AS state" "$SIZES" "$(scatter_sql "$BIG")" "$(scatter_sql "$NORMAL")"
    same_result "$copy"

    # (0) 열만 넣음, 쿼리와 인덱스는 그대로. 월별 통계와 휴지통은 B 교체 시험의 기준
    cells e7/0-now "$copy" "" "$BALANCES" "$BALANCE" "$MONTHLY" "$TRASH"
    # (가) 쿼리만
    cells e7/1-query "$copy" "" "$C_BALANCES" "$C_BALANCE"

    # (나) 쿼리 + A
    sql "$copy" -c "$INDEX_A"
    after_index "$copy"
    cells e7/2-query-A "$copy" "" "$C_BALANCES" "$C_BALANCE"

    # (다) 쿼리 + B
    sql "$copy" -c "DROP INDEX ix_transaction_line_ledger_account" -c "$INDEX_B"
    after_index "$copy"
    cells e7/3-query-B "$copy" "" "$C_BALANCES" "$C_BALANCE"

    # B가 옛 인덱스를 대신할 수 있는지: 옛 인덱스를 지우고 B만 있는 상태.
    # 세션마다 트랜잭션 안에서 지우고 커밋하지 않는다. 세션이 끝나면 되돌아가, 옛 인덱스가 새로 만들어져 작아지는 일이 없다.
    cells e7/B-only "$copy" "BEGIN; DROP INDEX ix_transaction_ledger_occurred_on;" "$MONTHLY" "$TRASH"
    # 옛 인덱스를 지금 새로 만들면 얼마인지(되돌린다)
    perfsql -At -d "$copy" <<SQL > "$OUT/e7.old-index-rebuilt.$db.txt"
BEGIN;
DROP INDEX ix_transaction_ledger_occurred_on;
$INDEX_OLD;
SELECT pg_relation_size('ix_transaction_ledger_occurred_on');
ROLLBACK;
SQL

    # (라) 쿼리 + A + B
    sql "$copy" -c "$INDEX_A"
    after_index "$copy"
    facts "e7.sizes.$db.txt" "$copy" "SELECT 'A와 B를 만든 뒤' AS state" "$SIZES"
    cells e7/4-query-A-B "$copy" "" "$C_BALANCES" "$C_BALANCE"
    cold_cells e7/4-query-A-B-cold "$copy" restart "$C_BALANCES" "$C_BALANCE"

    # 큰 장부 거래의 약 1%를 고친 뒤 VACUUM 없이
    facts "e7.update.$db.txt" "$copy" \
      "SELECT n_tup_upd, n_tup_hot_upd, n_tup_newpage_upd FROM pg_stat_user_tables WHERE relname = 'transaction'" \
      "WITH u AS (UPDATE transaction SET memo = '시험 수정', version = version + 1, updated_at = now() WHERE ledger_id = md5('perf-ledger-$BIG')::uuid AND hashtext(id::text) % 100 = 0 RETURNING 1) SELECT count(*) AS updated FROM u" \
      "SELECT pg_stat_force_next_flush()" "SELECT pg_sleep(2)" \
      "SELECT n_tup_upd, n_tup_hot_upd, n_tup_newpage_upd FROM pg_stat_user_tables WHERE relname = 'transaction'" \
      "SELECT relname, relpages, relallvisible FROM pg_class WHERE relname = 'transaction'"
    cells e7/5-after-update "$copy" "" "$C_BALANCES" "$C_BALANCE"
    facts "e7.vacuum.$db.txt" "$copy" "$VACUUMS"

    # 대가: 거래 1,000건 넣기
    insert_cost "$copy" with-A-B 10
    sql "$copy" -c "DROP INDEX ix_transaction_line_ledger_account" -c "DROP INDEX ix_transaction_ledger_live"
    after_index "$copy"
    insert_cost "$copy" without 20
    drop_db "$copy"
  done
}

# 측정 구간의 절전 기록(맥에서만)
do_sleep_log() {
  local start
  start=$(head -1 "$OUT/timeline.tsv" | cut -f1)
  pmset -g log | awk -v s="$start" '$1 ~ /^20[0-9][0-9]-/ && ($1 " " $2) >= s && ($4 == "Sleep" || $4 == "Wake" || $4 == "DarkWake")' \
    | tee "$OUT/sleep-log.txt"
  [ -s "$OUT/sleep-log.txt" ] || echo "절전 기록 없음(${start} 이후)"
}

if command -v caffeinate > /dev/null; then caffeinate -dims -w $$ & fi

for arg in "$@"; do
  case "$arg" in
    up) do_up ;;
    seed) do_seed ;;
    base) do_base base ;;
    base-again) do_base base-again ;;
    e1 | e2 | e3 | e4 | e5 | e6 | e7) "do_$arg" ;;
    sleep-log) do_sleep_log ;;
    down) dc down -v ;;
    *) echo "모르는 단계: $arg" >&2; exit 1 ;;
  esac
done
mark "== 끝: $*"
