# 로컬 성능 측정

측정용 PostgreSQL을 따로 띄워 쿼리 실행 시간을 재는 절차다. 무엇을 왜 재는지는 [docs/perf](../docs/perf/README.md), 잰 결과는 [docs/perf/results](../docs/perf/results/)에 있다.

| 파일 | 하는 일 |
|---|---|
| [`../compose.perf.yaml`](../compose.perf.yaml) | `compose.yaml`을 덮어써 측정용 DB를 따로 띄운다 |
| [`seed.sql`](seed.sql) | 시험 데이터를 만든다 |
| [`queries/`](queries/) | 지금 코드가 보내는 SQL 그대로. `EXPLAIN (ANALYZE, BUFFERS)`로 감싸 돌린다 |

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

컨테이너 한도는 운영 초안과 같다. 메모리 1GB, `shared_buffers` 256MB, CPU 상한 없음. 스왑은 따로 정하지 않아 Docker 기본값(메모리와 합쳐 2GB)이다.

## 2. 스키마 넣기

크기마다 DB를 따로 만들고 마이그레이션 SQL을 번호 순서대로 넣는다. Flyway는 쓰지 않는다.

```sh
mkdb() {
  perfsql -d postgres -c "CREATE DATABASE $1"
  for f in $(ls server/src/main/resources/db/migration/V*.sql | sort -V); do perfsql -d "$1" < "$f"; done
}
mkdb perf_l1_12k
```

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
| `seed` | 난수 씨앗. 변수가 같으면 다시 만들어도 값이 같다 | 0.42 |

측정 계획 2장의 크기는 이렇게 만든다.

```sh
mkdb perf_l1_50k    && perfsql -d perf_l1_50k    -v tx_per_ledger=50000 < perf/seed.sql
mkdb perf_one_10k   && perfsql -d perf_one_10k   -v one_account=on -v tx_per_ledger=10000 < perf/seed.sql
mkdb perf_one_50k   && perfsql -d perf_one_50k   -v one_account=on -v tx_per_ledger=50000 < perf/seed.sql
mkdb perf_one_200k  && perfsql -d perf_one_200k  -v one_account=on -v tx_per_ledger=200000 < perf/seed.sql
mkdb perf_l1000_3m  && perfsql -d perf_l1000_3m  -v ledgers=1000 -v tx_per_ledger=3000 < perf/seed.sql
```

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

| 파일 | 코드 | 변수(기본값) |
|---|---|---|
| `balance.sql` | `BalanceQuery.balance` (계좌 하나 잔액) | `ledger_no`(1), `account_no`(1) |
| `balances.sql` | `BalanceQuery.balances` (장부 전체 잔액) | `ledger_no`(1) |
| `monthly-stats.sql` | `MonthlyStatsQuery.monthly` (월별 통계) | `ledger_no`(1), `month`(2026-10) |
| `trash-list.sql` | `TransactionService.listDeleted` (휴지통 목록) | `ledger_no`(1) |
| `category-in-use.sql` | `TransactionLineRepository.existsByCategoryId` (카테고리 사용 여부) | `ledger_no`(1), `category_kind`(EXPENSE), `category_no`(24) |

`category_no`의 기본값 24는 거래가 없는 카테고리다. 거래가 있는 카테고리는 `-v category_no=1`로 잰다.

한 세션에서 10번 돌려 앞의 3번(캐시 데우기)을 버리고 7번의 최솟값, 중앙값, 최댓값을 낸다.

```sh
measure() {
  db=$1; query=$2; shift 2
  for i in 1 2 3 4 5 6 7 8 9 10; do cat "$query"; done | perfsql -At -d "$db" "$@" \
    | awk '/^Execution Time/ {print $3}' | tail -n 7 | sort -n \
    | awk '{v[NR] = $1} END {print "min " v[1] " median " v[4] " max " v[7] " (ms, n=" NR ")"}'
}
measure perf_l1_12k perf/queries/balance.sql
measure perf_l1_12k perf/queries/category-in-use.sql -v category_no=1
```

7번으로는 p95를 말할 수 없다. 백분위라고 적지 않는다.

## 6. 내리기

측정용 컨테이너와 볼륨만 지운다.

```sh
dc down -v
```

DB 하나만 다시 만들 때는 `perfsql -d postgres -c "DROP DATABASE perf_l1_12k"` 뒤에 2번부터 한다.

## 쿼리 파일을 다시 가져오는 법

SQL은 손으로 쓰지 않았다. 기존 테스트를 SQL 로그를 켜고 돌려 Hibernate가 보낸 문장을 가져왔고, `?`만 psql 변수로 바꿨다. 로그 설정은 환경변수로만 주고 커밋하지 않는다.

```sh
(cd server && SPRING_APPLICATION_JSON='{"logging.level.org.hibernate.SQL":"debug","logging.level.org.hibernate.orm.jdbc.bind":"trace"}' \
  ./gradlew test --rerun-tasks --tests '*BalanceQueryTest' --tests '*MonthlyStatsQueryTest' \
  --tests '*CategoryServiceTest' --tests '*TransactionServiceTest.delete_thenRestore_roundTrips')
grep -h org.hibernate.SQL server/build/test-results/test/*.xml | sed 's/.*org.hibernate.SQL[^:]*: //' | sort -u
```

지금 파일은 main 48aa00e(Spring Boot 3.5.16, Hibernate 6.6.53.Final, PostgreSQL JDBC 42.7.11)에서 가져왔다.

## 고쳐야 하는 때

- **이슈 #58**(`transaction_line`에 `ledger_id` 추가)이 머지되면 `seed.sql`의 `transaction_line` INSERT에 `ledger_id`를 넣어야 한다. 안 고치면 NOT NULL 위반으로 멈춘다.
- Spring Boot 4.2 이전(이슈 #17)이 머지되면 Hibernate 버전이 바뀐다. 쿼리 파일을 다시 가져와 같은지 본다.
- 쿼리 코드(`BalanceQuery`, `MonthlyStatsQuery`, 리포지토리)가 바뀌면 그 파일을 다시 가져온다.

## 확인한 날짜와 환경

위 명령은 2026-11-24에 아래 환경에서 실행해 확인했다.

- 맥(Apple M5 Pro, 메모리 48GB), macOS 27.0.1, zsh
- Docker Desktop(Docker 29.9.2, Compose 5.6.1). Docker VM에 CPU 10개, 메모리 약 7.7GB
- PostgreSQL 17.12 (`postgres:17`, arm64)
- `ports: !override`는 위 Compose 5.6.1에서만 확인했다. 2.24.4보다 낮은 버전은 이 문법을 모른다(Docker 문서 기준, 직접 확인하지 않음)
