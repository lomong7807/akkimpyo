#!/usr/bin/env bash
# 큰 장부 잔액 진단 측정. 사용법은 perf/README.md의 "진단 측정"에 있다.
#
#   OUT=<결과 폴더> perf/run-diagnosis.sh <단계> [단계...]
#   단계: up seed base e1 e2 e3 e4 e5 e6 e7 base-again down
#   #58(V10~V12) 앞뒤 비교(새로 띄운 DB에서): DBS="perf_mix_50k perf_l1000_3m" ... up v12-seed v12 insert cand sleep-log down
#   #6(V6) 앞뒤 비교(v6-seed, v6)와 ledger_id를 손으로 넣는 옛 e7은 c415677의 이 스크립트에만 있다.
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
# #58(PR #170) 앞의 문장. V9 DB에서만 쓴다.
B_BALANCE=perf/queries/before-58/balance.sql
B_BALANCES=perf/queries/before-58/balances.sql
# 후보: account 조인을 없앤 장부 전체 잔액
C_UNNEST=perf/queries/candidates/balances-unnest.sql
C_LATERAL=perf/queries/candidates/balances-lateral.sql

# 재는 문장 하나의 시간 제한. 시드, 마이그레이션, VACUUM, 인덱스 만들기에는 걸지 않는다.
STATEMENT_TIMEOUT=${STATEMENT_TIMEOUT:-120s}

INDEX_A="CREATE INDEX ix_transaction_line_ledger_account ON transaction_line (ledger_id, account_id) INCLUDE (transaction_id, amount)"
INDEX_B="CREATE INDEX ix_transaction_ledger_live ON transaction (ledger_id, occurred_on) INCLUDE (id, status) WHERE deleted_at IS NULL"
INDEX_OLD="CREATE INDEX ix_transaction_ledger_occurred_on ON transaction (ledger_id, occurred_on)"

# 컨테이너가 블록 장치에서 실제로 읽은 바이트(누적). 실행 사이에 넣어 OS 캐시 읽기와 디스크 읽기를 가른다.
IO_MARK="SELECT 'io ' || (regexp_match(pg_read_file('/sys/fs/cgroup/io.stat'), 'rbytes=([0-9]+)'))[1];"

COMPOSE_FILES=(-f compose.yaml -f compose.perf.yaml -f perf/compose.diag.yaml)
dc() { docker compose -p akkimpyo-perf "${COMPOSE_FILES[@]}" "$@"; }
perfsql() { dc exec -T db psql -X -q -v ON_ERROR_STOP=1 -U accountbook "$@"; }
sql() { local db=$1; shift; perfsql -At -F ' | ' -d "$db" "$@" < /dev/null; }
timedsql() { dc exec -T -e PGOPTIONS="-c statement_timeout=$STATEMENT_TIMEOUT" db psql -X -q -v ON_ERROR_STOP=1 -U accountbook "$@"; }

# timed <결과 파일(.txt)> <db> [psql 인자...]: 표준 입력을 시간 제한을 걸고 돌린다.
# 제한에 걸리면 그때까지의 출력을 .timeout으로 남기고 1을 돌려준다. 다른 오류면 멈춘다.
timed() {
  local out=$1 db=$2 rc=0
  shift 2
  mkdir -p "$(dirname "$out")"
  timedsql -At -d "$db" "$@" > "$out" 2> "$out.err" || rc=$?
  if [ "$rc" = 0 ]; then rm -f "$out.err"; return 0; fi
  cat "$out.err" >&2
  grep -q 'statement timeout' "$out.err" || return 2
  { cat "$out"; echo "-- $STATEMENT_TIMEOUT 안에 끝나지 않음"; cat "$out.err"; } > "${out%.txt}.timeout"
  rm -f "$out" "$out.err"
  return 1
}

load1() { uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ,; }
mark() { printf '%s\t%s\t%s\n' "$(date '+%F %T')" "$(load1)" "$*" | tee -a "$OUT/timeline.tsv"; }
# 컨테이너의 메모리 사용. file은 페이지 캐시(shmem 포함), shmem은 shared_buffers 등 공유 메모리다.
mem() {
  printf '%s\t%s\t%s\n' "$(date '+%F %T')" "$*" "$(dc exec -T db bash -c 'egrep "^(anon|file|shmem|workingset_refault_file) " /sys/fs/cgroup/memory.stat | tr "\n" " "; echo -n "current $(cat /sys/fs/cgroup/memory.current)"' < /dev/null)" >> "$OUT/memstat.tsv"
}
# PostgreSQL만 재시작한다. 컨테이너와 cgroup은 남는다(compose.diag.yaml이 셸로 감쌌다).
pg_restart() {
  # shellcheck disable=SC2016
  dc exec -T db bash -c 'gosu postgres pg_ctl -D "$PGDATA" -m fast -w -t 120 -l /tmp/pg_restart.log restart' < /dev/null > /dev/null
  wait_ready
}
wait_ready() { until dc exec -T db pg_isready -q -h localhost -U accountbook -d accountbook < /dev/null; do sleep 1; done; }

# MAX_LOAD를 주면 1분 load average가 그 아래로 내려올 때까지(최대 MAX_WAIT초) 기다린다. 다른 worker가 같이 도는 맥에서 쓴다.
wait_quiet() {
  local waited=0
  [ -n "${MAX_LOAD:-}" ] || return 0
  while [ "$waited" -lt "${MAX_WAIT:-1800}" ]; do
    if awk -v now="$(load1)" -v max="$MAX_LOAD" 'BEGIN { exit !(now < max) }'; then return 0; fi
    sleep 10
    waited=$((waited + 10))
  done
  mark "load가 MAX_LOAD=$MAX_LOAD 아래로 내려오지 않아 그대로 잰다"
}

# 단계가 시작될 때 그때의 조건을 남긴다.
step() {
  # docker ps는 Docker Desktop의 Kubernetes 컨테이너를 숨긴다. docker info의 수에는 들어 있다.
  mem "$* 시작"
  mark "== $* 시작. 다른 컨테이너(docker ps): [$(docker ps --format '{{.Names}}' | grep -v '^akkimpyo-perf' | tr '\n' ' ' || true)], 실행 중 전체(docker info): $(docker info --format '{{.ContainersRunning}}')"
}

# run10 <결과 폴더> <db> <쿼리 파일> <장부> <lit|gen> [세션 SET 문]
# 한 세션에서 10번. 버리는 것(앞 3번)은 요약할 때 한다.
# 시간 제한에 걸리면 거기서 멈추고, 실행하지 않은 EXPLAIN 계획을 .timeout 파일에 덧붙인다.
run10() {
  local dir=$1 db=$2 file=$3 ledger=$4 mode=$5 prelude=${6:-}
  local name generic=off out rc=0
  name=$(basename "$file" .sql)
  [ "$mode" = gen ] && generic=on
  out="$OUT/$dir/$db/$name.$ledger.$mode.txt"
  mark "$dir $db $name $ledger $mode"
  {
    printf '%s\n%s\n' "$prelude" "$IO_MARK"
    for _ in 1 2 3 4 5 6 7 8 9 10; do cat "$file"; printf '%s\n' "$IO_MARK"; done
  } | timed "$out" "$db" -v ledger_no="$ledger" -v generic=$generic || rc=$?
  case $rc in
    0) ;;
    1)
      mark "$dir $db $name $ledger $mode: $STATEMENT_TIMEOUT 안에 끝나지 않음"
      { printf '%s\n' "$prelude"; cat "$file"; } \
        | perfsql -At -d "$db" -v ledger_no="$ledger" -v generic=$generic -v explain=EXPLAIN >> "${out%.txt}.timeout"
      ;;
    *) exit 1 ;;
  esac
}

# perf_l1000_3m에는 큰 장부가 없다.
ledgers_of() { case "$1" in perf_l1000_3m*) echo "$NORMAL" ;; *) echo "$BIG $NORMAL" ;; esac; }

# cells <결과 폴더> <db> <세션 SET 문> <쿼리 파일...>: 큰 장부와 보통 장부를 리터럴과 일반 계획으로
cells() {
  local dir=$1 db=$2 prelude=$3 file ledger mode
  shift 3
  fresh
  for file in "$@"; do
    for ledger in $(ledgers_of "$db"); do
      for mode in lit gen; do run10 "$dir" "$db" "$file" "$ledger" "$mode" "$prelude"; done
    done
  done
  mem "$dir $db 끝"
  mark "$dir $db 끝"
}

# 측정용 DB 파일만 OS 페이지 캐시에서 내린다(posix_fadvise DONTNEED). VM 전체 캐시는 비우지 않는다.
# PostgreSQL을 재시작(종료 체크포인트)한 뒤라 더러운 페이지가 없다.
evict_files() {
  # shellcheck disable=SC2016
  dc exec -T db bash -c 'find "$PGDATA/base" "$PGDATA/global" -type f -exec dd if={} iflag=nocache count=0 status=none \;' < /dev/null
}

# 측정을 시작하기 전의 상태를 맞춘다: PostgreSQL 재시작 + DB 파일의 OS 캐시를 내림.
# 뒤에 세 번 버리고 재는 동안 이 컨테이너의 메모리 한도 안에서만 캐시가 쌓인다.
fresh() { pg_restart; evict_files; }

# cold <결과 폴더> <db> <쿼리 파일> <장부> <pgrestart|evict>: 첫 실행을 세 번 되풀이한다.
# 매번 같은 쿼리를 세 번 돌려 OS 캐시에 올린 뒤 PostgreSQL만 재시작한다. evict면 DB 파일의 OS 캐시까지 내린다.
cold() {
  local dir=$1 db=$2 file=$3 ledger=$4 kind=$5 name rep out
  name=$(basename "$file" .sql)
  mkdir -p "$OUT/$dir/$db"
  for rep in 1 2 3; do
    out="$OUT/$dir/$db/$name.$ledger.$kind.$rep.txt"
    cat "$file" "$file" "$file" | timedsql -At -d "$db" -v ledger_no="$ledger" > /dev/null
    pg_restart
    if [ "$kind" = evict ]; then evict_files; fi
    mark "$dir $db $name $ledger $kind $rep"
    { printf 'SET track_io_timing = on;\n%s\n' "$IO_MARK"; cat "$file"; printf '%s\n' "$IO_MARK"; } \
      | timedsql -At -d "$db" -v ledger_no="$ledger" > "$out"
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
  case "$1" in
    perf_*_e6 | perf_*_e7 | perf_*_ins9 | perf_*_ins12 | perf_*_cand) sql postgres -c "DROP DATABASE $1" ;;
    *) echo "사본만 지운다: $1" >&2; exit 1 ;;
  esac
}

migrations() { ls server/src/main/resources/db/migration/V*.sql | sort -V; }
# V9까지의 스키마에는 transaction_line.ledger_id가 없어 c415677의 시드를 쓴다.
seed_file() { if [ -n "${1:-}" ] && [ "$1" -lt 10 ]; then git show c415677:perf/seed.sql; else cat perf/seed.sql; fi; }
mkdb() { # mkdb <db> [마지막 버전]: 버전을 주면 그 버전까지만 적용한다
  local f version
  sql postgres -c "CREATE DATABASE $1"
  for f in $(migrations); do
    version=$(basename "$f" | sed 's/^V\([0-9]*\)__.*/\1/')
    if [ -z "${2:-}" ] || [ "$version" -le "$2" ]; then perfsql -d "$1" < "$f"; fi
  done
}

facts() { # facts <결과 파일> <db> <SQL...>: 크기나 통계 같은 사실을 남긴다
  local out="$OUT/$1" db=$2
  shift 2
  mkdir -p "$(dirname "$out")"
  { for q in "$@"; do printf -- '-- %s\n' "$q"; perfsql -d "$db" -c "$q" < /dev/null; done; } >> "$out"
}

SIZES="SELECT c.relname, c.relkind, pg_relation_size(c.oid) AS bytes, pg_size_pretty(pg_relation_size(c.oid)) AS size, c.reltuples::bigint, c.relallvisible, c.relpages
         FROM pg_class c
        WHERE c.oid IN ('transaction'::regclass, 'transaction_line'::regclass, 'account'::regclass, 'category'::regclass)
           OR c.oid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN ('transaction'::regclass, 'transaction_line'::regclass, 'account'::regclass, 'category'::regclass))
        ORDER BY c.relkind DESC, c.relname"
# 장부의 라인이 흩어진 블록 수(겹치지 않게 센 것)와 라인 수
scatter_sql() {
  echo "SELECT '장부 $1' AS ledger, count(*) AS lines, count(DISTINCT (l.ctid::text::point)[0]) AS distinct_blocks
          FROM transaction_line l JOIN account a ON a.id = l.account_id
         WHERE a.ledger_id = md5('perf-ledger-$1')::uuid"
}
VACUUMS="SELECT relname, last_vacuum, last_autovacuum, last_analyze, last_autoanalyze, n_dead_tup FROM pg_stat_user_tables WHERE relname IN ('transaction', 'transaction_line', 'account') ORDER BY 1"

# 테이블마다 건수, 내용 해시, 저장 위치(ctid) 해시. 데이터와 저장 순서가 같은지 본다.
# content는 transaction_line의 ledger_id를 뺀 것(V9와 V12에서 견줄 수 있다), content_all은 모든 열이다.
HASHES=""
for t in account category ledger ledger_member transaction transaction_line users; do
  row="x::text"
  if [ "$t" = transaction_line ]; then row="ROW(x.id, x.transaction_id, x.account_id, x.category_id, x.amount, x.created_at)::text"; fi
  HASHES="${HASHES:+$HASHES UNION ALL }SELECT '$t' AS table_name, count(*), sum(hashtextextended($row, 0)::numeric) AS content, sum(hashtextextended(x::text, 0)::numeric) AS content_all, sum(hashtextextended(x.id::text || x.ctid::text, 0)::numeric) AS placement FROM $t x"
done
HASHES="SELECT * FROM ($HASHES) h ORDER BY 1"

do_up() { dc up -d; wait_ready; }

do_seed() { # do_seed [마지막 마이그레이션 버전]
  local db
  step "seed${1:+ V1~V$1}"
  for db in "${DBS[@]}"; do
    mkdb "$db" "${1:-}"
    mark "seed $db"
    seed_file "${1:-}" | case "$db" in
      perf_l1000_3m*) perfsql -d "$db" -v ledgers=1000 -v tx_per_ledger=3000 ;;
      perf_mix_50k*) perfsql -d "$db" -v ledgers=1000 -v tx_per_ledger=3000 -v big_ledger_tx=50000 ;;
      perf_mix_200k*) perfsql -d "$db" -v ledgers=1000 -v tx_per_ledger=3000 -v big_ledger_tx=200000 -v big_one_account=on ;;
      *) perfsql -d "$db" -v ledgers=1000 -v tx_per_ledger="${TX_PER_LEDGER:-20}" -v big_ledger_tx="${BIG_TX:-500}" ;;
    esac | tee "$OUT/seed.$db.txt"
    grep -v flyway_schema_history docs/db/integrity-checks.sql | perfsql -d "$db" > "$OUT/integrity.$db.txt"
    facts "seed-facts.$db.txt" "$db" "SELECT pg_size_pretty(pg_database_size(current_database()))" "$SIZES" \
      "$(scatter_sql "$BIG")" "$(scatter_sql "$NORMAL")" \
      "SELECT count(*) AS accounts, count(DISTINCT ledger_id) AS ledgers FROM account" "$HASHES"
    mark "seed $db 끝"
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

# (가) pgrestart: PostgreSQL만 재시작(같은 컨테이너, 같은 cgroup). (나)의 VM 전체 캐시 비우기는 하지 않는다.
# evict: (가)처럼 재시작한 뒤 측정용 DB 파일만 OS 캐시에서 내린다.
do_e2() {
  local db kind
  step e2
  for kind in pgrestart evict; do
    for db in "${DBS[@]}"; do
      fresh
      cold_cells e2 "$db" "$kind" "$BALANCES" "$BALANCE"
    done
  done
}

do_e3() {
  local db
  step e3
  export PG_SHARED_BUFFERS=2GB PG_MEM_LIMIT=4g
  dc up -d
  wait_ready
  facts e3.settings.txt postgres "SELECT name, setting, unit FROM pg_settings WHERE name IN ('shared_buffers', 'effective_cache_size')"
  for db in "${DBS[@]}"; do
    # 앞 DB의 블록이 남아 자리를 다투지 않게 비우고 시작한다(cells가 fresh를 한다).
    cells e3 "$db" "" "$BALANCES" "$BALANCE"
    cells e3-io "$db" "SET track_io_timing = on;" "$BALANCES" "$BALANCE"
  done
  docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' akkimpyo-perf-db-1 > "$OUT/e3.docker-stats.txt"
  unset PG_SHARED_BUFFERS PG_MEM_LIMIT
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
    fresh
    mkdir -p "$OUT/e4/$db"
    for file in "$BALANCES" "$BALANCE" "$MONTHLY" "$TRASH"; do
      name=$(basename "$file" .sql)
      for sequence in big normal mix; do
        case $sequence in big) first=$BIG ;; *) first=$NORMAL ;; esac
        # 캐시 데우기: 쓸 장부마다 리터럴로 세 번
        if [ "$sequence" = mix ]; then
          cat "$file" "$file" "$file" | timedsql -At -d "$db" -v ledger_no="$BIG" > /dev/null
        fi
        cat "$file" "$file" "$file" | timedsql -At -d "$db" -v ledger_no="$first" > /dev/null
        mark "e4 $db $name $sequence"
        auto_session "$file" "$sequence" | timedsql -At -d "$db" -v ledger_no="$first" -v generic=on > "$OUT/e4/$db/$name.$sequence.txt"
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

after_index() { sql "$1" -c "VACUUM (ANALYZE)" -c CHECKPOINT; }

insert_cost() { # insert_cost <결과 폴더> <db> <이름> <첫 회차>: 첫 번째는 데우기, 뒤의 5번을 센다
  local dir=$1 db=$2 label=$3 first=$4 i
  mkdir -p "$OUT/$dir/$db"
  for i in 0 1 2 3 4 5; do
    mark "$dir $db insert $label $i"
    timedsql -At -d "$db" -v run_no=$((first + i)) < perf/insert-cost.sql > "$OUT/$dir/$db/$label.$i.txt"
  done
}

# 인덱스 후보 A, B(이슈 #113). 쿼리는 지금 main의 것이다.
do_e7() {
  local db copy
  step e7
  for db in "${DBS[@]}"; do
    copy=${db}_e7
    clone_db "$db" "$copy"
    facts "e7.sizes.$db.txt" "$copy" "SELECT '후보 인덱스 없음' AS state" "$SIZES" "$(scatter_sql "$BIG")" "$(scatter_sql "$NORMAL")"

    # (가) 지금 쿼리, 후보 인덱스 없음. 월별 통계와 휴지통은 B 교체 시험의 기준
    cells e7/1-query "$copy" "" "$BALANCES" "$BALANCE" "$MONTHLY" "$TRASH"

    # (나) 쿼리 + A
    sql "$copy" -c "$INDEX_A"
    after_index "$copy"
    cells e7/2-query-A "$copy" "" "$BALANCES" "$BALANCE"

    # (다) 쿼리 + B
    sql "$copy" -c "DROP INDEX ix_transaction_line_ledger_account" -c "$INDEX_B"
    after_index "$copy"
    cells e7/3-query-B "$copy" "" "$BALANCES" "$BALANCE"

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
    cells e7/4-query-A-B "$copy" "" "$BALANCES" "$BALANCE"
    cold_cells e7/4-query-A-B-cold "$copy" pgrestart "$BALANCES" "$BALANCE"

    # 큰 장부 거래의 약 1%를 고친 뒤 VACUUM 없이
    facts "e7.update.$db.txt" "$copy" \
      "SELECT n_tup_upd, n_tup_hot_upd, n_tup_newpage_upd FROM pg_stat_user_tables WHERE relname = 'transaction'" \
      "WITH u AS (UPDATE transaction SET memo = '시험 수정', version = version + 1, updated_at = now() WHERE ledger_id = md5('perf-ledger-$BIG')::uuid AND hashtext(id::text) % 100 = 0 RETURNING 1) SELECT count(*) AS updated FROM u" \
      "SELECT pg_stat_force_next_flush()" "SELECT pg_sleep(2)" \
      "SELECT n_tup_upd, n_tup_hot_upd, n_tup_newpage_upd FROM pg_stat_user_tables WHERE relname = 'transaction'" \
      "SELECT relname, relpages, relallvisible FROM pg_class WHERE relname = 'transaction'"
    cells e7/5-after-update "$copy" "" "$BALANCES" "$BALANCE"
    facts "e7.vacuum.$db.txt" "$copy" "$VACUUMS"

    # 대가: 거래 1,000건 넣기
    insert_cost e7/insert "$copy" with-A-B 10
    sql "$copy" -c "DROP INDEX ix_transaction_line_ledger_account" -c "DROP INDEX ix_transaction_ledger_live"
    after_index "$copy"
    insert_cost e7/insert "$copy" without 20
    drop_db "$copy"
  done
}

# 저장 상태를 맞춘다. VACUUM FULL은 visibility map을 만들지 않으므로 VACUUM을 한 번 더 한다.
vacuum_full() {
  mark "$1 VACUUM (FULL, ANALYZE)"
  sql "$1" -c "VACUUM (FULL, ANALYZE)"
  sql "$1" -c "VACUUM (ANALYZE)" -c CHECKPOINT
  mark "$1 VACUUM 끝"
}

# 마이그레이션 하나를 Flyway처럼 한 트랜잭션으로 적용하고 문장마다의 시간을 남긴다.
apply_migration() { # apply_migration <db> <버전>
  local db=$1 version=$2
  mark "v12 $db V$version 적용 시작"
  {
    printf '\\timing on\nBEGIN;\n'
    cat "$(migrations | grep "/V${version}__")"
    printf '\nCOMMIT;\n'
  } | perfsql -d "$db" > "$OUT/v12.apply.$db.V$version.txt"
  mark "v12 $db V$version 적용 끝"
}

# #58(V10~V12, PR #170) 앞뒤를 같은 DB에서 잰다(이슈 #171). v12-seed가 V1~V9까지 적용하고 옛 시드를 넣은 DB에서 시작한다.
# 앞은 #58 앞의 문장(before-58), 뒤는 지금 main의 문장이다.
do_v12() {
  local db round version
  for db in "${DBS[@]}"; do
    v12_state "$db" "V9, 시드 직후"
    for round in 1-v9 2-v9; do v12_round "$db" "$round" "$B_BALANCES" "$B_BALANCE"; done

    vacuum_full "$db"
    v12_state "$db" "V9, VACUUM (FULL, ANALYZE) 뒤"
    v12_round "$db" 3-v9-full "$B_BALANCES" "$B_BALANCE"
    clone_db "$db" "${db}_ins9" # 넣기 비용(insert 단계)의 앞쪽

    fresh
    for version in 10 11 12; do apply_migration "$db" "$version"; done
    v12_state "$db" "V12, 적용 직후"
    vacuum_full "$db"
    v12_state "$db" "V12, VACUUM (FULL, ANALYZE) 뒤"
    for round in 4-v12 5-v12; do v12_round "$db" "$round" "$BALANCES" "$BALANCE"; done
  done
}
v12_state() { facts "v12.state.$1.txt" "$1" "SELECT '$2' AS state" "$HASHES" "$SIZES" "$(scatter_sql "$BIG")" "$(scatter_sql "$NORMAL")" "$VACUUMS"; }
v12_round() { # v12_round <db> <회차> <쿼리 파일...>
  local db=$1 round=$2
  shift 2
  wait_quiet
  step "v12 $db $round"
  cells "v12/$round" "$db" "" "$@"
  facts "v12.vacuum.$db.txt" "$db" "$VACUUMS"
}

# 큰 장부 상한 판정용: 장부 전체 잔액만 한 회차. load는 timeline.tsv에 남는다.
do_judge() {
  local db dir
  dir="judge/$(date '+%H%M%S')"
  for db in "${DBS[@]}"; do
    wait_quiet
    step "$dir $db"
    cells "$dir" "$db" "" "$BALANCES"
  done
}

# 거래 1,000건 넣기를 #58 앞(V9 사본)과 뒤(V12 사본)에서. 앞뒤를 번갈아 두 번 되풀이한다.
do_insert() {
  local db turn
  step insert
  for db in "${DBS[@]}"; do
    clone_db "$db" "${db}_ins12"
    for turn in 1 2; do
      fresh
      insert_cost insert "${db}_ins9" "turn$turn" $((turn * 10))
      fresh
      insert_cost insert "${db}_ins12" "turn$turn" $((turn * 10))
    done
    facts "insert.sizes.$db.txt" "${db}_ins9" "SELECT 'V9 사본, 넣은 뒤' AS state" "$SIZES" "$VACUUMS"
    facts "insert.sizes.$db.txt" "${db}_ins12" "SELECT 'V12 사본, 넣은 뒤' AS state" "$SIZES" "$VACUUMS"
    drop_db "${db}_ins9"
    drop_db "${db}_ins12"
  done
}

# 장부 전체의 결과를 파일 그대로의 문장으로 구한다. 계좌 id는 장부끼리 겹치지 않으므로 이어 붙여 견준다.
all_ledgers() { # all_ledgers <결과 파일> <db> <쿼리 파일>
  local out=$1 db=$2 file=$3 n ledgers
  ledgers=$(sql "$db" -c "SELECT count(*) FROM ledger")
  for n in $(seq "$ledgers"); do printf '\\set ledger_no %s\n' "$n"; cat "$file"; done \
    | timed "$out" "$db" -v explain=
  sort -o "$out" "$out"
}
same_result() { # same_result <db> <이름>: 지금 문장과 후보 둘의 결과를 모든 장부에서 견준다
  local db=$1 label=$2 name file
  all_ledgers "$OUT/cand.same.$label.now.txt" "$db" "$BALANCES"
  for file in "$C_UNNEST" "$C_LATERAL"; do
    name=$(basename "$file" .sql)
    all_ledgers "$OUT/cand.same.$label.$name.txt" "$db" "$file"
    if diff "$OUT/cand.same.$label.now.txt" "$OUT/cand.same.$label.$name.txt" > "$OUT/cand.same.$label.$name.diff"; then
      echo "$label $name: 같다($(wc -l < "$OUT/cand.same.$label.now.txt" | tr -d ' ')행)"
    else
      echo "$label $name: 다르다($(wc -l < "$OUT/cand.same.$label.$name.diff" | tr -d ' ')줄 차이)"
    fi
  done | tee -a "$OUT/cand.same.txt"
}

# dba 후보(PR #170 댓글). 한 번에 하나만 바꾸고 사본에서 한다.
do_cand() {
  local db copy i
  local stats="SELECT stxname, stxkind, stxkeys, pg_column_size(d.stxddependencies) AS dependencies_bytes, d.stxddependencies::text FROM pg_statistic_ext e LEFT JOIN pg_statistic_ext_data d ON d.stxoid = e.oid"
  local columns="SELECT attname, n_distinct, correlation, array_length(most_common_vals, 1) AS mcv_count FROM pg_stats WHERE tablename = 'transaction_line' AND attname IN ('account_id', 'ledger_id', 'transaction_id') ORDER BY 1"
  step cand
  for db in "${DBS[@]}"; do
    copy=${db}_cand

    # (b) 결과가 같은지 먼저 본다. 기준일이 모두 거래 시작일이라, 기준일을 흩뜨린 사본에서 한 번 더 본다.
    clone_db "$db" "$copy"
    same_result "$copy" seed
    sql "$copy" -c "UPDATE account SET opening_date = opening_date + (hashtext(id::text) & 4095)"
    sql "$copy" -c "VACUUM (ANALYZE)"
    same_result "$copy" spread

    # (0) 지금 문장, (b) account 조인을 없앤 두 문장
    clone_db "$db" "$copy"
    cells cand/0-now "$copy" "" "$BALANCES" "$BALANCE"
    cells cand/b-no-account "$copy" "" "$C_UNNEST" "$C_LATERAL"

    # (a) 확장 통계. ANALYZE만 다시 한 회차(a0)를 사이에 두어 표본이 바뀌는 몫을 가른다.
    facts "cand.stats.$db.txt" "$copy" "SELECT 'ANALYZE 앞' AS state" "$columns"
    for i in 1 2 3; do
      mark "cand $db ANALYZE(확장 통계 없음) $i"
      printf '\\timing on\nANALYZE transaction_line;\n' | perfsql -d "$copy" >> "$OUT/cand.analyze.$db.without.txt"
    done
    sql "$copy" -c CHECKPOINT
    cells cand/a0-analyze "$copy" "" "$BALANCES" "$BALANCE"
    mark "cand $db CREATE STATISTICS"
    printf '\\timing on\nCREATE STATISTICS s (dependencies) ON account_id, ledger_id FROM transaction_line;\n' \
      | perfsql -d "$copy" > "$OUT/cand.create-statistics.$db.txt"
    for i in 1 2 3; do
      mark "cand $db ANALYZE(확장 통계 있음) $i"
      printf '\\timing on\nANALYZE transaction_line;\n' | perfsql -d "$copy" >> "$OUT/cand.analyze.$db.with.txt"
    done
    sql "$copy" -c CHECKPOINT
    facts "cand.stats.$db.txt" "$copy" "SELECT '확장 통계를 만든 뒤' AS state" "$columns" "$stats"
    cells cand/a-dependencies "$copy" "" "$BALANCES" "$BALANCE"
    facts "cand.vacuum.$db.txt" "$copy" "$VACUUMS"
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
    e1 | e2 | e3 | e4 | e5 | e6 | e7 | v12 | insert | cand | judge) "do_$arg" ;;
    v12-seed) do_seed 9 ;;
    fresh) fresh ;;
    sleep-log) do_sleep_log ;;
    down) dc down -v ;;
    *) echo "모르는 단계: $arg" >&2; exit 1 ;;
  esac
done
mark "== 끝: $*"
