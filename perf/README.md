# 로컬 성능 측정

측정용 PostgreSQL을 따로 띄워 쿼리 실행 시간을 재는 절차다. 무엇을 왜 재는지는 [docs/perf](../docs/perf/README.md), 잰 결과는 [docs/perf/results](../docs/perf/results/)에 있다.

| 파일 | 하는 일 |
|---|---|
| [`../compose.perf.yaml`](../compose.perf.yaml) | `compose.yaml`을 덮어써 측정용 DB를 따로 띄운다 |
| [`seed.sql`](seed.sql) | 시험 데이터를 만든다 |
| [`queries/`](queries/) | 지금 코드가 보내는 SQL 그대로. `EXPLAIN (ANALYZE, BUFFERS)`로 감싸 돌린다 |
| [`queries/before-58/`](queries/before-58/) | #58(V10~V12) 앞의 잔액 문장 두 개. 지금 앱이 보내는 SQL이 아니다. 8번만 쓴다 |
| [`queries/candidates/`](queries/candidates/) | 후보 쿼리. 앱이 보내는 SQL이 아니다. 8번의 `cand`만 쓴다 |
| [`run-diagnosis.sh`](run-diagnosis.sh) | 진단 측정(7번)과 #58 앞뒤 비교(8번)를 단계별로 돌린다 |
| [`summarize-diagnosis.mjs`](summarize-diagnosis.mjs) | 진단 측정이 남긴 실행 계획 원문에서 숫자를 뽑는다 |
| [`insert-cost.sql`](insert-cost.sql) | 거래 1,000건을 넣는 시간(진단 측정 E7, 8번의 `insert`). V9까지와 V12에서 모두 돈다 |
| [`compose.diag.yaml`](compose.diag.yaml) | 진단 측정용 덮어쓰기. 셸이 PostgreSQL을 감싸 컨테이너를 유지한 채 `pg_ctl`로만 재시작한다. `PG_SHARED_BUFFERS`, `PG_MEM_LIMIT` 환경변수로 E3의 설정을 준다 |
| [`PrepareThresholdCheck.java`](PrepareThresholdCheck.java) | pgJDBC가 몇 번째 실행부터 서버 쪽 준비된 문장을 쓰는지 본다(진단 측정 E4) |

> 여기서 얻는 수치는 맥 로컬 Docker에서 DB 실행 시간만 잰 것이다. API 지연도 운영 서버 수치도 아니다.

## 개발용 DB를 건드리지 않는 근거

| 항목 | 개발용(`compose.yaml`만) | 측정용(`compose.perf.yaml`을 덮어씀) |
|---|---|---|
| 프로젝트 이름 | 폴더 이름 | `akkimpyo-perf` (파일의 `name:`에도 있어 `-p`를 빠뜨려도 같다) |
| 호스트 포트 | 5433 | 5434 (`127.0.0.1`에만 연다) |
| 볼륨 | `<프로젝트>_db-data` | `akkimpyo-perf_perf-db-data` |
| DB 이름 | `accountbook` | `perf_`로 시작하는 DB를 새로 만든다 |

- compose의 `ports`는 합쳐지는 값이라 그냥 적으면 5433도 같이 열린다. 그래서 `ports: !override`로 바꿔 적었다. `docker compose ... config`로 5434 하나만 남는 것을 확인했다.
- `volumes`는 컨테이너 안 경로가 같으면 나중 파일의 값이 이긴다. `config` 결과에 `db-data`가 남지 않는 것을 확인했다. `COMPOSE_PROJECT_NAME=account-book`으로 이름을 억지로 바꿔도 볼륨은 `account-book_perf-db-data`라 개발용 `db-data`와 다르다.
- `seed.sql`은 DB 이름이 `perf_`로 시작하고 비어 있을 때만 넣는다. 아니면 오류를 내고 멈춘다. 지우는 문장은 없다.

## 준비

명령은 모두 레포 루트에서 실행한다. 먼저 셸 함수 두 개를 만든다(zsh, bash 공통).

```sh
dc() { docker compose -p akkimpyo-perf -f compose.yaml -f compose.perf.yaml "$@"; }
perfsql() { dc exec -T db psql -X -q -v ON_ERROR_STOP=1 -U accountbook "$@"; }
```

## 1. 띄우기

```sh
dc up -d
until dc exec -T db pg_isready -q -h localhost -U accountbook -d accountbook; do sleep 1; done
```

컨테이너 한도는 운영 초안(#52)과 같다. 메모리 1GB(`mem_limit`), 스왑 없음(`memswap_limit` 1g), `/dev/shm` 256MB(`shm_size`), `shared_buffers` 256MB, CPU 상한 없음. 메모리 한도를 넘으면 느려지지 않고 OOM으로 드러난다.

## 2. 스키마 넣기

크기마다 DB를 따로 만들고 마이그레이션 SQL을 번호 순서대로 넣는다. Flyway는 쓰지 않는다.

```sh
mkdb() {
  perfsql -d postgres -c "CREATE DATABASE $1"
  for f in $(ls server/src/main/resources/db/migration/V*.sql | sort -V); do perfsql -d "$1" < "$f"; done
}
mkdb perf_l1_12k
```

`seed.sql`과 `queries/`는 V12 스키마 기준이다. V9까지의 스키마로 만들 때는 시드를 `git show c415677:perf/seed.sql`로 넣는다(8번의 `v12-seed`가 그렇게 한다). 만드는 값은 `transaction_line.ledger_id`를 빼면 같다.

## 3. 시험 데이터 넣기

```sh
perfsql -d perf_l1_12k < perf/seed.sql
```

| 변수 | 뜻 | 기본값 |
|---|---|---|
| `ledgers` | 장부 수 | 1 |
| `tx_per_ledger` | 장부당 거래 수 | 12000 |
| `start_date` | 거래 날짜의 시작 | 2016-11-01 |
| `years` | 시작 날짜부터 몇 년에 걸칠지 | 10 |
| `one_account` | `on`이면 모든 거래의 라인 하나가 장부의 첫 계좌에 붙는다. 첫 계좌의 라인 수가 `tx_per_ledger`와 같아진다(잔액 기준선용) | off |
| `big_ledger_tx` | 0보다 크면 그만큼의 거래를 가진 큰 장부를 하나 더 만든다. 장부 번호는 `ledgers` + 1. 다른 장부의 값은 바뀌지 않고, 큰 장부의 거래는 날짜 순서로 섞여 쌓인다 | 0 |
| `big_one_account` | `on`이면 큰 장부의 모든 거래의 라인 하나가 첫 계좌에 붙는다(`one_account`는 큰 장부에 적용되지 않는다) | off |
| `seed` | 난수 씨앗. 변수가 같으면 다시 만들어도 값이 같다 | 0.42 |

측정 계획 2장의 크기는 이렇게 만든다.

```sh
mkdb perf_l1_50k    && perfsql -d perf_l1_50k    -v tx_per_ledger=50000 < perf/seed.sql
mkdb perf_one_10k   && perfsql -d perf_one_10k   -v one_account=on -v tx_per_ledger=10000 < perf/seed.sql
mkdb perf_one_50k   && perfsql -d perf_one_50k   -v one_account=on -v tx_per_ledger=50000 < perf/seed.sql
mkdb perf_one_200k  && perfsql -d perf_one_200k  -v one_account=on -v tx_per_ledger=200000 < perf/seed.sql
mkdb perf_l1000_3m  && perfsql -d perf_l1000_3m  -v ledgers=1000 -v tx_per_ledger=3000 < perf/seed.sql
```

여러 장부가 섞인 DB 안의 큰 장부는 이렇게 만든다. 큰 장부의 번호는 1001이다(`-v ledger_no=1001`).

```sh
mkdb perf_mix_50k   && perfsql -d perf_mix_50k   -v ledgers=1000 -v tx_per_ledger=3000 -v big_ledger_tx=50000 < perf/seed.sql
mkdb perf_mix_200k  && perfsql -d perf_mix_200k  -v ledgers=1000 -v tx_per_ledger=3000 -v big_ledger_tx=200000 -v big_one_account=on < perf/seed.sql
```

장부 1,000개짜리 DB를 만드는 명령은 하나가 2분 안쪽이었다(80~102초).

분포는 아래와 같다. 앞의 세 줄과 삭제·취소 비율은 dba와 합의한 값이고, 나머지 비율은 이 스크립트를 만들며 정했다.

| 항목 | 값 |
|---|---|
| 날짜 | `start_date`부터 `years`년에 고르게. 여러 장부의 거래가 날짜 순서로 섞여 쌓인다 |
| 계좌 | 장부당 5~10개. 첫 계좌에 많이 몰린다. 기준일은 `start_date`라 모든 거래가 잔액에 들어간다 |
| 카테고리 | 장부당 30개. 지출은 미분류 1개, 상위 6개, 하위 18개. 수입은 미분류 1개, 상위 2개, 하위 2개 |
| 상태 | 삭제 2%, 취소 1% (겹치지 않는다) |
| 거래 종류 | 지출 85%, 수입 5%, 이체 10%. 월 100건이면 수입 5건, 이체(카드대금 포함) 10건꼴이다 |
| 라인 | 지출과 수입은 1개, 이체는 2개(카테고리 없음, 합 0). 부호는 `TransactionService`를 따라 지출 음수, 수입 양수. 환불은 넣지 않는다 |
| 미분류 | 지출과 수입의 5% |
| 카테고리 쏠림 | 지출은 앞 번호에 많이 몰린다. 지출 24번은 거래가 없다(카테고리 사용 여부 쿼리용) |
| 시각 | 30%가 NULL |
| 가맹점/내용 | 지출과 수입의 10%가 NULL. 이름은 `시험가맹점 1`~`200`처럼 만든 값이다 |
| 메모 | 20%만 있다 |

- 비율은 난수로 뽑으므로 정확히 2%가 아니라 2% 안팎이다. 실제 건수는 스크립트가 끝에 출력한다.
- `transaction_line.ledger_id`는 거래의 장부다(V12의 복합 FK가 어긋난 값을 거부한다).
- `change_log`는 넣지 않는다. 재는 쿼리가 읽지 않는다.
- 넣은 뒤 `VACUUM (ANALYZE)`를 한다. `ANALYZE`만 하면 측정 도중에 autovacuum이 돌아 수치가 흔들린다.
- 데이터가 맞는지는 [`docs/db/integrity-checks.sql`](../docs/db/integrity-checks.sql)로 본다. 측정용 DB에는 `flyway_schema_history`가 없어 그 명세표 한 줄은 빼고 돌린다. "점검" 쿼리는 모두 0건이어야 한다.

```sh
grep -v flyway_schema_history docs/db/integrity-checks.sql | perfsql -d perf_l1_12k
```

## 4. pg_stat_statements 켜기

라이브러리는 `compose.perf.yaml`이 올려 둔다. 확장은 볼 DB에서 손으로 만든다(Flyway에 넣지 않는다).

```sh
perfsql -d perf_l1_12k -c "CREATE EXTENSION pg_stat_statements"
perfsql -d perf_l1_12k -c "SELECT pg_stat_statements_reset()"
for q in perf/queries/*.sql; do perfsql -d perf_l1_12k -v explain= < "$q" > /dev/null; done
perfsql -d perf_l1_12k -c "
SELECT calls, round(total_exec_time::numeric, 3) AS total_ms, rows, left(query, 70) AS query
  FROM pg_stat_statements
 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
 ORDER BY total_exec_time DESC LIMIT 10"
```

`-v explain=`로 비우면 `EXPLAIN` 없이 쿼리만 돈다. `EXPLAIN`으로 감싸 돌리면 통계에 `EXPLAIN ...` 문장으로 따로 잡힌다.

## 5. 쿼리 재기

한 번 볼 때:

```sh
perfsql -At -d perf_l1_12k < perf/queries/balance.sql
```

큰 DB에서는 문장에 시간 제한을 건다. 나쁜 계획 하나가 30분 동안 끝나지 않은 일이 있다(PR #170 dba 댓글). `run-diagnosis.sh`는 재는 문장마다 `statement_timeout`을 120초(`STATEMENT_TIMEOUT`으로 바꾼다)로 건다.

```sh
timedsql() { dc exec -T -e PGOPTIONS='-c statement_timeout=120s' db psql -X -q -v ON_ERROR_STOP=1 -U accountbook "$@"; }
timedsql -At -d perf_l1_12k < perf/queries/balance.sql
```

| 파일 | 코드 | 변수(기본값) |
|---|---|---|
| `balance.sql` | `BalanceQuery.balance` (계좌 하나 잔액) | `ledger_no`(1), `account_no`(1) |
| `balances.sql` | `BalanceQuery.balances` (장부 전체 잔액) | `ledger_no`(1) |
| `monthly-stats.sql` | `MonthlyStatsQuery.monthly` (월별 통계) | `ledger_no`(1), `month`(2026-10) |
| `trash-list.sql` | `TransactionService.listDeleted` (휴지통 목록) | `ledger_no`(1) |
| `category-in-use.sql` | `TransactionLineRepository.existsByCategoryId` (카테고리 사용 여부) | `ledger_no`(1), `category_kind`(EXPENSE), `category_no`(24) |

값을 문장에 넣지 않고 앱처럼 바인드 변수로 보낼 때의 계획을 보려면 `-v generic=on`을 준다. `PREPARE`한 뒤 `plan_cache_mode = force_generic_plan`으로 `EXECUTE`한다.

```sh
perfsql -At -d perf_l1_12k -v generic=on < perf/queries/balance.sql
```

`category_no`의 기본값 24는 거래가 없는 카테고리다. 거래가 있는 카테고리는 `-v category_no=1`로 잰다.

한 세션에서 10번 돌려 앞의 3번(캐시 데우기)을 버리고 7번의 최솟값, 중앙값, 최댓값을 낸다.

```sh
measure() {
  db=$1; query=$2; shift 2
  for i in 1 2 3 4 5 6 7 8 9 10; do cat "$query"; done | timedsql -At -d "$db" "$@" \
    | awk '/^Execution Time/ {print $3}' | tail -n 7 | sort -n \
    | awk '{v[NR] = $1} END {print "min " v[1] " median " v[4] " max " v[7] " (ms, n=" NR ")"}'
}
measure perf_l1_12k perf/queries/balance.sql
measure perf_l1_12k perf/queries/category-in-use.sql -v category_no=1
```

7번으로는 p95를 말할 수 없다. 백분위라고 적지 않는다.

맥이 절전에 들어가면 측정이 멈추거나 깨진다. 오래 잴 때는 `caffeinate -dims`로 감싸 돌리고, 끝난 뒤 `pmset -g log`에 그 시간대의 Sleep 기록이 없는지 본다.

## 6. 내리기

측정용 컨테이너와 볼륨만 지운다.

```sh
dc down -v
```

DB 하나만 다시 만들 때는 `perfsql -d postgres -c "DROP DATABASE perf_l1_12k"` 뒤에 2번부터 한다.

## 7. 진단 측정 (큰 장부 잔액)

큰 장부의 잔액이 느린 원인을 가설별로 재고, dba가 정한 후보(쿼리와 인덱스)를 재는 절차다. 결과는 [2026-11-25 잔액 진단](../docs/perf/results/2026-11-25-balance-diagnosis.md)에 있다. 쿼리를 한 번에 하나씩 10번 돌려 뒤의 7번을 세는 방법은 5번과 같다.

```sh
OUT=~/akkimpyo-perf-out perf/run-diagnosis.sh up seed base e1 e2 e3 e4 e5 e6 e7 base-again sleep-log
node perf/summarize-diagnosis.mjs ~/akkimpyo-perf-out
OUT=~/akkimpyo-perf-out perf/run-diagnosis.sh down
```

`OUT`은 결과를 둘 폴더다. 레포 밖에 둔다. 단계를 나눠 돌려도 된다(`up`, `seed`가 먼저다). `down`은 측정용 컨테이너와 볼륨을 지운다.

| 단계 | 하는 일 | 바꾸는 것 |
|---|---|---|
| `up`, `seed` | 측정용 DB를 띄우고 `perf_mix_50k`, `perf_mix_200k`를 만든다(점검 쿼리까지) | 없음 |
| `base`, `base-again` | 기준. 처음과 끝에 한 번씩 | 없음 |
| `e1` | 읽기 시간 | 세션 `track_io_timing=on` |
| `e2` | 식은 캐시의 첫 실행. `pgrestart`는 PostgreSQL만 재시작(같은 컨테이너), `evict`는 재시작 뒤 측정용 DB 파일만 OS 캐시에서 내린다(`dd iflag=nocache`) | 캐시 상태, 세션 `track_io_timing=on` |
| `e3` | 캐시 크기. 끝나면 원래 설정으로 다시 띄운다 | `PG_SHARED_BUFFERS=2GB`, `PG_MEM_LIMIT=4g`(`compose.diag.yaml`) |
| `e4` | `plan_cache_mode=auto`에서 `PREPARE` 한 번, `EXECUTE` 10번 | 없음(기본값) |
| `e5` | 인덱스 읽기 비용 | 세션 `random_page_cost=1.1` |
| `e6` | 통계 대상 수. 사본 DB에서 하고 지운다 | `account_id SET STATISTICS 1000` |
| `e7` | 후보 인덱스 A와 B(이슈 #113). 쿼리는 지금 main의 것이다. 사본 DB에서 하고 지운다 | 후보 인덱스 A와 B |
| `sleep-log` | 측정 구간의 절전 기록을 보여 준다(맥) | 없음 |

- `e7`은 #58이 머지된 뒤(V12)에 맞춘 것이다. `ledger_id`를 손으로 넣고 지금 쿼리와 후보 쿼리를 견주던 옛 `e7`((0)과 (가), 결과 동일 확인)은 V10과 겹쳐 뺐다. 다시 쓰려면 c415677을 체크아웃한다(V1~V9 스키마).
- 재는 문장에 `statement_timeout`이 걸린다. `base`, `e1`, `e3`, `e5`~`e7`, 8번에서 제한에 걸리면 그 파일을 `.txt` 대신 `.timeout`으로 남기고(그때까지의 출력 + 실행하지 않은 `EXPLAIN` 계획) 다음으로 넘어간다. `e2`, `e4`, 넣기 비용은 제한에 걸리면 멈춘다.
- 컨테이너 안의 페이지 캐시는 메모리 한도(1GB)를 같이 쓴다. 컨테이너째 재시작하면 이전 컨테이너의 페이지 캐시가 한도 밖에 남아 값이 달라지므로, 재시작은 `pg_ctl`로만 한다. 잴 때마다 PostgreSQL을 재시작하고 측정용 DB 파일의 OS 캐시를 내려 상태를 맞춘 뒤(`fresh`) 세 번을 버린다.
- 스크립트는 스스로 `caffeinate -dims`를 건다. 시각, load average, 다른 컨테이너는 `OUT/timeline.tsv`에 남는다.
- 사본 DB는 `CREATE DATABASE ... TEMPLATE ... STRATEGY FILE_COPY`로 만든다. 저장 순서와 통계가 원본과 같다.
- 실행 사이에 컨테이너의 블록 장치 읽기 바이트(`/sys/fs/cgroup/io.stat`)를 남긴다. `read` 버퍼가 OS 캐시에서 왔는지 블록 장치에서 왔는지 가르는 데 쓴다.
- VM 전체의 페이지 캐시(`/proc/sys/vm/drop_caches`)는 비우지 않는다. 같은 VM의 다른 컨테이너에 영향을 준다. `docker ps`는 Docker Desktop의 Kubernetes 컨테이너를 숨기므로 `docker info`의 실행 중 개수도 같이 본다.
- 큰 장부와 보통 장부의 번호는 `BIG`(1001), `NORMAL`(1)로 바꿀 수 있다. `DBS`로 다른 DB 이름을 주면 작은 시험 데이터(`TX_PER_LEDGER`, `BIG_TX`)로 흐름만 확인할 수 있다.

앱과 같은 pgJDBC가 언제 준비된 문장을 쓰는지는 이렇게 본다(JDK 21, 서버 의존성을 한 번 받은 뒤). jar 이름의 버전은 `server`의 `./gradlew dependencies`에 나오는 것으로 맞춘다.

```sh
java -cp "$(find ~/.gradle/caches/modules-2 -name 'postgresql-42.7.14.jar' | head -1)" \
  perf/PrepareThresholdCheck.java jdbc:postgresql://localhost:5434/perf_mix_50k 1001
```

## 8. #58(V10~V12) 앞뒤 비교와 후보

이슈 #58(PR #170)의 V10~V12가 `transaction_line`에 `ledger_id`와 복합 FK를, `transaction`·`account`·`category`에 `(id, ledger_id)` 유니크를 더했고 잔액 쿼리 두 개가 장부 조건으로 바뀌었다. 같은 DB에서 앞뒤를 잰다. 결과는 [2026-11-26 #58 뒤 다시 재기](../docs/perf/results/2026-11-26-remeasure-line-ledger.md)에 있다. 띄우는 방법과 캐시 상태를 맞추는 방법(`fresh`)은 7번과 같다.

```sh
OUT=~/akkimpyo-perf-out DBS="perf_mix_50k perf_l1000_3m" perf/run-diagnosis.sh up v12-seed v12
OUT=~/akkimpyo-perf-out DBS="perf_mix_50k_new perf_l1000_3m_new" perf/run-diagnosis.sh seed base
OUT=~/akkimpyo-perf-out DBS=perf_mix_50k perf/run-diagnosis.sh insert cand judge sleep-log
node perf/summarize-diagnosis.mjs ~/akkimpyo-perf-out
OUT=~/akkimpyo-perf-out perf/run-diagnosis.sh down
```

| 단계 | 하는 일 |
|---|---|
| `v12-seed` | `DBS`의 DB를 만들 때 V1~V9까지만 적용하고 c415677의 시드를 넣는다(점검 쿼리까지) |
| `v12` | DB마다 차례로: V9에서 `before-58`의 문장으로 두 회차, `VACUUM (FULL, ANALYZE)` 뒤 한 회차, V10·V11·V12를 한 파일씩 한 트랜잭션으로 적용(`v12.apply.<DB>.V<번호>.txt`에 문장별 시간), `VACUUM (FULL, ANALYZE)` 뒤 지금 문장으로 두 회차. 앞뒤의 건수·해시·크기는 `v12.state.<DB>.txt`에 남긴다 |
| `seed base`(이름이 `_new`로 끝나는 DB) | V12에 바로 지금 시드를 넣은 DB. 이관한 DB와 내용·계획이 같은지 본다 |
| `insert` | `v12`가 남긴 V9 사본(`<DB>_ins9`)과 V12 사본에서 거래 1,000건 넣기. 번갈아 두 번, 한 번에 여섯 회(첫 회는 데우기) |
| `cand` | dba 후보(PR #170 댓글). 결과가 모든 장부에서 같은지 본 뒤 account 조인을 없앤 문장 둘과, 확장 통계(`dependencies`)를 잰다. 사본 DB에서 하고 지운다 |
| `judge` | 큰 장부 상한 판정용으로 장부 전체 잔액만 한 회차. `MAX_LOAD`를 주지 않으면 기다리지 않는다 |

- 저장 상태를 맞추려고 V9에서도 `VACUUM (FULL, ANALYZE)` 뒤의 회차를 하나 둔다. `VACUUM FULL`은 visibility map을 만들지 않으므로 뒤에 `VACUUM (ANALYZE)`와 `CHECKPOINT`를 한 번 더 한다(7번의 `e7`과 같다).
- 해시의 `content`는 `transaction_line.ledger_id`를 뺀 값이라 V9와 V12를 견줄 수 있다. `content_all`은 모든 열이다.
- `perf_l1000_3m`에는 큰 장부(1001)가 없어 보통 장부만 잰다.
- `v12`는 되돌리지 않는다. 다시 재려면 DB를 지우고 `v12-seed`부터 한다.
- 맥에서 다른 worker가 같이 돌면 `MAX_LOAD`(1분 load average의 상한)를 줘서 회차마다 그 아래로 내려올 때까지(최대 `MAX_WAIT`초, 기본 1800) 기다릴 수 있다. 회차마다의 load는 `OUT/timeline.tsv`에 남는다.
- **V6 앞뒤 비교**(`v6-seed`, `v6`)는 뺐다. 지금의 `seed.sql`과 `queries/`가 V10보다 앞의 스키마에서 돌지 않기 때문이다. 다시 쓰려면 c415677을 체크아웃한다.

## 쿼리 파일을 다시 가져오는 법

SQL은 손으로 쓰지 않았다. 기존 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 가져왔고, `?`만 psql 변수로 바꿨다. 로그 설정은 환경변수로만 주고 커밋하지 않는다.

```sh
(cd server && SPRING_APPLICATION_JSON='{"logging.level.org.hibernate.SQL":"debug","logging.level.org.hibernate.orm.jdbc.bind":"trace"}' \
  ./gradlew test --rerun-tasks --tests '*BalanceQueryTest' --tests '*MonthlyStatsQueryTest' \
  --tests '*CategoryServiceTest' --tests '*TransactionServiceTest.delete_thenRestore_roundTrips')
grep -h org.hibernate.SQL server/build/test-results/test/*.xml | sed 's/.*org.hibernate.SQL[^:]*: //' | sort -u
```

지금 파일은 2026-11-26에 main a55e96f(V12, Spring Boot 4.2.0, Hibernate 7.4.15.Final, PostgreSQL JDBC 42.7.14)에서 가져왔다. 다섯 문장이 로그의 문장과 글자 단위로 같고 `PREPARE`의 타입은 로그의 바인드 타입과 같다. 앞의 파일(main 48aa00e)과 달라진 것은 넷이다.

- `balance.sql`, `balances.sql`: PR #154의 `cast(... as numeric(38,0))`와 PR #170의 장부 조건(바인드가 5개, 3개로 늘었다)
- `monthly-stats.sql`: PR #154의 `cast`
- `trash-list.sql`: 라인의 `ledger_id` 열

`queries/before-58/`의 두 문장은 bc91001(a55e96f의 바로 앞)에서 같은 명령으로 가져왔다.

## 고쳐야 하는 때

- 마이그레이션이 시드가 넣는 테이블의 열이나 제약을 바꾸면 `seed.sql`과 `insert-cost.sql`을 같이 본다.
- Spring Boot나 Hibernate 버전이 바뀌면 쿼리 파일을 다시 가져와 같은지 본다. pgJDBC 버전이 바뀌면 위의 `PrepareThresholdCheck.java` 명령에서 jar 버전을 맞춰 다시 돌려 본다(4.2.0에서는 `perf/queries/`가 그대로였다).
- 쿼리 코드(`BalanceQuery`, `MonthlyStatsQuery`, 리포지토리)나 라인 엔터티(휴지통 목록이 라인의 열을 읽는다)가 바뀌면 그 파일을 다시 가져온다.
- 후보가 채택되거나 버려지면 `queries/candidates/`와 `run-diagnosis.sh`의 `cand`를 지운다. #58 앞뒤를 다시 잴 일이 없으면 `queries/before-58/`과 `v12-seed`, `v12`, `insert`도 지운다.

## 확인한 날짜와 환경

1~6번의 명령은 2026-11-24에, 7번(진단 측정)은 2026-11-25에 아래 환경에서 처음 실행해 확인했다. 2026-11-26에 main a55e96f(V12)에서 시드와 7번의 모든 단계(작은 DB `perf_small`), 8번의 모든 단계를 돌렸다.

- 맥(Apple M5 Pro, 메모리 48GB), macOS 27.0.1, zsh
- Docker Desktop(Docker 29.9.2, Compose 5.6.1). Docker VM에 CPU 10개, 메모리 약 7.7GB
- PostgreSQL 17.12 (`postgres:17`, arm64)
- `ports: !override`는 위 Compose 5.6.1에서만 확인했다. 2.24.4보다 낮은 버전은 이 문법을 모른다(Docker 문서 기준, 직접 확인하지 않음)
