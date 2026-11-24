# 쿼리 기준선 (2026-11-24)

> **한계를 먼저 읽는다.**
> - 맥 로컬 Docker에서 **DB 실행 시간만** 잰 것이다. API 지연이 아니다(네트워크, Hibernate, 권한 확인 쿼리가 빠져 있다).
> - **운영 서버 수치가 아니다.** 운영은 Ampere A1(4 OCPU)이고, 여기서는 Apple M5 Pro이며 CPU 상한이 없다. 컨테이너 메모리와 `shared_buffers`만 운영 초안과 같다.
> - 쿼리를 한 번에 하나씩만 돌렸다. 동시 요청은 재지 않았다.
> - 측정하는 동안 맥에서 다른 작업이 돌고 있었다(load average는 3장). 같은 절차를 두 번 돌렸고 중앙값이 최대 2.3배까지 달랐다(1회차 1.422ms, 2회차 3.213ms). 계획 모양은 두 회차가 같았다.
> - 앱은 값을 바인드 변수로 보내지만 여기서는 문장에 값을 직접 넣었다. 바인드 변수일 때 계획이 같은지는 재지 않았다.
> - 시간은 `EXPLAIN (ANALYZE, BUFFERS)`의 `Execution Time`이다. 노드마다 시간을 재는 비용이 들어 있고, 계획 시간은 빠져 있다.
> - 장부 1개짜리 DB는 테이블의 모든 행이 그 장부의 것이다. 여러 장부가 섞인 것은 300만 건 DB뿐이다.

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-24 |
| 잰 사람 | perf가 맡긴 작업자. 원인 해석과 개선안은 perf가 검수하며 쓴다 |
| 커밋 | 서버 코드와 마이그레이션은 main 48aa00e. `compose.perf.yaml`, `perf/`는 `perf/local-measure-env` 브랜치의 26d0bda |

## 1. 결과 요약

- **월별 통계**: 잰 크기 모두에서 상한 100ms 안이다. 두 회차를 합친 최댓값은 14.659ms(계좌 하나 라인 20만)다. 장부 1개짜리 DB에서는 `transaction_line` 전체 훑기가 있다. 300만 건 DB에서는 없다.
- **장부 전체 잔액**: 잰 크기 모두에서 상한 200ms 안이다. 최댓값은 85.092ms(계좌 하나 라인 20만)다. 장부 1개짜리 DB에서는 `transaction`과 `transaction_line` 전체 훑기가 있다. 300만 건 DB에서는 두 테이블 전체 훑기가 없고 `account`만 훑는다.
- **거래 목록 50건**: 쿼리 없음. 재지 못했다.
- 상한이 정해지지 않은 쿼리 가운데 가장 오래 걸린 것은 300만 건 DB의 카테고리 사용 여부(거래 없는 카테고리)로 중앙값 120.602ms(1회차), 131.987ms(2회차)다. 이 쿼리는 잰 크기 모두에서 `transaction_line` 전체 훑기가 있다.

## 2. 환경

| 항목 | 값 |
|---|---|
| 장비 | 맥, Apple M5 Pro(CPU 15개), 메모리 48GB, macOS 27.0.1 |
| Docker | Docker Desktop, Docker 29.9.2, Compose 5.6.1. Docker VM에 CPU 10개, 메모리 8,214,786,048바이트(약 7.7GB) |
| PostgreSQL | 17.12, arm64 (`postgres:17@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac`) |
| 컨테이너 한도 | 메모리 1GB(`mem_limit`), 스왑은 Docker 기본값(메모리와 합쳐 2GB), CPU 상한 없음, `/dev/shm` 64MB |
| DB 설정 | `shared_buffers` 256MB, `shared_preload_libraries` pg_stat_statements. 나머지는 기본값: `work_mem` 4MB, `effective_cache_size` 4GB, `random_page_cost` 4, `max_parallel_workers_per_gather` 2, `jit` on, `track_io_timing` off |
| 쿼리 | main 48aa00e에서 테스트의 SQL 로그로 가져온 문장(Spring Boot 3.5.16, Hibernate 6.6.53.Final) |

데이터는 `perf/seed.sql`로 만들었다. 크기마다 DB를 따로 두었고 날짜는 모두 2016-11-01부터 2026-10-31까지 10년이다.

| DB | 만든 변수 | 거래 | 라인 | 삭제 | 취소 | 대상 장부·계좌 |
|---|---|---|---|---|---|---|
| `perf_l1_12k` | 기본값 | 12,000 | 13,195 | 219 | 124 | 장부 1(계좌 6개), 계좌 1(라인 3,732) |
| `perf_l1_50k` | `tx_per_ledger=50000` | 50,000 | 55,032 | 1,002 | 490 | 장부 1, 계좌 1(라인 15,681) |
| `perf_l1000_3m` | `ledgers=1000`, `tx_per_ledger=3000` | 3,000,000 | 3,300,166 | 59,866 | 30,211 | 장부 1(거래 3,000, 라인 3,289), 계좌 1(라인 924) |
| `perf_one_10k` | `one_account=on`, `tx_per_ledger=10000` | 10,000 | 10,990 | 181 | 93 | 장부 1, 계좌 1(라인 10,000) |
| `perf_one_50k` | `one_account=on`, `tx_per_ledger=50000` | 50,000 | 55,032 | 1,002 | 490 | 장부 1, 계좌 1(라인 50,000) |
| `perf_one_200k` | `one_account=on`, `tx_per_ledger=200000` | 200,000 | 220,041 | 4,001 | 1,987 | 장부 1, 계좌 1(라인 200,000) |

- 거래 종류는 여섯 DB 모두 지출 85%, 수입 5%, 이체 10% 안팎이다(84.9~85.0%, 4.9~5.2%, 9.9~10.1%).
- 300만 건을 넣는 데 102초 걸렸다(`VACUUM (ANALYZE)` 포함). 이 DB의 `transaction`은 인덱스와 합쳐 814MB, `transaction_line`은 623MB다.
- 여섯 DB 모두 `docs/db/integrity-checks.sql`의 점검 쿼리가 0건이다(`flyway_schema_history`를 읽는 명세표 한 줄은 빼고 돌렸다).
- 같은 변수로 두 번 만든 DB(1만 2천 건)에서 모든 테이블의 내용 해시와 `transaction_line`의 저장 순서가 같았다.
- 월별 통계는 2026-10, 카테고리 사용 여부는 지출 24번(거래 없음)과 지출 1번(거래 있음)으로 쟀다.

## 3. 방법

`perf/README.md`의 절차와 같다. 다른 점은 요약값만 뽑지 않고 실행 계획 원문을 파일로 남겨 계산한 것뿐이다.

```sh
dc() { docker compose -p akkimpyo-perf -f compose.yaml -f compose.perf.yaml "$@"; }
perfsql() { dc exec -T db psql -X -q -v ON_ERROR_STOP=1 -U accountbook "$@"; }
# 한 세션에서 같은 쿼리를 10번. 앞의 3번(캐시 데우기)은 버리고 뒤의 7번만 센다.
for i in 1 2 3 4 5 6 7 8 9 10; do cat perf/queries/balance.sql; done | perfsql -At -d perf_l1_12k
```

- 300만 건 DB는 데이터를 넣은 뒤 `CHECKPOINT`를 하고 쟀다.
- 크기 6개, 쿼리 6개(카테고리 사용 여부는 두 가지), 10번씩, 두 회차로 모두 720번 돌렸고 실패는 0번이다.
- 표본이 7개라 p95는 말할 수 없다. 최솟값, 중앙값, 최댓값만 적는다.

| 회차 | 시각(KST) | 잰 DB | 맥 load average(1분) |
|---|---|---|---|
| 1회차 | 17:34:34~17:34:39 | 300만 건을 뺀 5개 | 4.97 → 4.89 |
| 1회차 | 17:36:39~17:36:41 | `perf_l1000_3m` | 6.21 → 6.21 |
| 2회차 | 17:37:21~17:37:30 | 6개 모두 | 7.95 → 12.26 |

## 4. 결과

### 크기별 중앙값과 전체 훑기

한 칸은 "1회차 중앙값 / 2회차 중앙값 (ms)"이고, 아랫줄은 `transaction`과 `transaction_line` 가운데 전체 훑기(Seq Scan)가 있는 테이블이다. 계획 모양은 두 회차가 같다.

| 쿼리 | 장부 1개, 1만 2천 건 | 장부 1개, 5만 건 | 장부 1,000개, 300만 건 |
|---|---|---|---|
| 계좌 하나 잔액 | 2.408 / 2.359<br>훑기: `transaction` | 8.789 / 16.230<br>훑기: `transaction` | 3.387 / 5.232<br>훑기 없음 |
| 장부 전체 잔액 | 4.494 / 5.861<br>훑기: `transaction`, `transaction_line` | 20.734 / 23.352<br>훑기: `transaction`, `transaction_line` | 9.298 / 10.838<br>훑기 없음 |
| 월별 통계 | 0.989 / 0.997<br>훑기: `transaction_line` | 4.060 / 4.274<br>훑기: `transaction_line` | 0.085 / 0.107<br>훑기 없음 |
| 휴지통 목록 | 1.495 / 1.682<br>훑기: `transaction`, `transaction_line` | 6.953 / 7.527<br>훑기: `transaction`, `transaction_line` | 1.422 / 3.213<br>훑기 없음 |
| 카테고리 사용 여부(거래 없음) | 0.274 / 0.288<br>훑기: `transaction_line` | 1.140 / 1.408<br>훑기: `transaction_line` | 120.602 / 131.987<br>훑기: `transaction_line` |
| 카테고리 사용 여부(거래 있음) | 0.003 / 0.003<br>훑기: `transaction_line` | 0.004 / 0.003<br>훑기: `transaction_line` | 0.004 / 0.004<br>훑기: `transaction_line` |

| 쿼리 | 계좌 하나 라인 1만 | 계좌 하나 라인 5만 | 계좌 하나 라인 20만 |
|---|---|---|---|
| 계좌 하나 잔액 | 2.549 / 2.561<br>훑기: `transaction`, `transaction_line` | 14.122 / 16.756<br>훑기: `transaction`, `transaction_line` | 42.156 / 59.130<br>훑기: `transaction`, `transaction_line` |
| 장부 전체 잔액 | 3.816 / 3.950<br>훑기: `transaction`, `transaction_line` | 20.686 / 26.843<br>훑기: `transaction`, `transaction_line` | 52.632 / 71.806<br>훑기: `transaction`, `transaction_line` |
| 월별 통계 | 0.817 / 0.831<br>훑기: `transaction_line` | 3.910 / 5.064<br>훑기: `transaction_line` | 11.722 / 13.756<br>훑기: `transaction_line` |
| 휴지통 목록 | 1.246 / 1.296<br>훑기: `transaction`, `transaction_line` | 6.791 / 8.106<br>훑기: `transaction`, `transaction_line` | 20.269 / 27.398<br>훑기: `transaction`, `transaction_line` |
| 카테고리 사용 여부(거래 없음) | 0.236 / 0.232<br>훑기: `transaction_line` | 1.106 / 1.592<br>훑기: `transaction_line` | 4.553 / 6.527<br>훑기: `transaction_line` |
| 카테고리 사용 여부(거래 있음) | 0.004 / 0.004<br>훑기: `transaction_line` | 0.003 / 0.004<br>훑기: `transaction_line` | 0.004 / 0.005<br>훑기: `transaction_line` |

### 크기별 자세한 값

- 시간은 `Execution Time`(ms)의 최솟값 / 중앙값 / 최댓값이다(7번). 계획 시간은 넣지 않았다.
- 행 수는 1회차 중앙값 실행의 "예상 / 실제"다. `×`는 loops이고, 실제 행 수는 루프 한 번의 평균이다. 병렬 계획이면 프로세스마다 한 루프다. "조인"은 집계나 정렬에 들어가기 직전의 조인 결과다.
- 버퍼는 실행 전체에서 찾은 8KB 블록 수다(hit = `shared_buffers`에 있던 것, read = 거기 없어서 OS에서 읽은 것). 7번이 서로 다르면 범위로 적었다.

#### 장부 1개, 1만 2천 건 (`perf_l1_12k`)

| 쿼리 | 1회차 최소 / 중앙 / 최대 | 2회차 최소 / 중앙 / 최대 | 행 수(예상 / 실제) | 쓰인 인덱스 | 전체 훑기 | 버퍼 hit / read (1회차) |
|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 2.306 / 2.408 / 3.245 | 2.131 / 2.359 / 2.483 | 조인 3,626 / 3,633<br>`transaction` 11,658 / 11,657<br>`transaction_line` 3,732 / 3,732 | `ix_transaction_line_account` | `transaction` | 432 / 0 |
| 장부 전체 잔액 | 4.324 / 4.494 / 4.736 | 5.499 / 5.861 / 6.688 | 조인 4,273 / 12,823<br>`transaction_line` 13,195 / 13,195<br>`transaction` 11,659 / 11,657<br>`account` 6 / 6 | 없음 | `account`<br>`transaction`<br>`transaction_line` | 429 / 0 |
| 월별 통계 | 0.912 / 0.989 / 1.030 | 0.955 / 0.997 / 1.230 | 조인 108 / 88<br>`transaction_line` 13,195 / 13,195<br>`transaction` 98 / 101<br>`category` 30 / 30 | `ix_transaction_ledger_occurred_on` | `category`<br>`transaction_line` | 177 / 0 |
| 휴지통 목록 | 1.428 / 1.495 / 1.597 | 1.512 / 1.682 / 1.948 | 조인 241 / 243<br>`transaction_line` 13,195 / 13,195<br>`transaction` 219 / 219 | 없음 | `transaction`<br>`transaction_line` | 428 / 0 |
| 카테고리 사용 여부(거래 없음) | 0.258 / 0.274 / 0.292 | 0.268 / 0.288 / 0.327 | `transaction_line` 1 / 0 | 없음 | `transaction_line` | 171 / 0 |
| 카테고리 사용 여부(거래 있음) | 0.003 / 0.003 / 0.005 | 0.002 / 0.003 / 0.005 | `transaction_line` 2,068 / 1 | 없음 | `transaction_line` | 2 / 0 |

#### 장부 1개, 5만 건 (`perf_l1_50k`)

| 쿼리 | 1회차 최소 / 중앙 / 최대 | 2회차 최소 / 중앙 / 최대 | 행 수(예상 / 실제) | 쓰인 인덱스 | 전체 훑기 | 버퍼 hit / read (1회차) |
|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 8.456 / 8.789 / 8.997 | 11.655 / 16.230 / 19.879 | 조인 15,260 / 15,224<br>`transaction` 48,561 / 48,508<br>`transaction_line` 15,712 / 15,681 | `ix_transaction_line_account` | `transaction` | 1,797 / 0 |
| 장부 전체 잔액 | 19.778 / 20.734 / 22.066 | 22.495 / 23.352 / 23.725 | 조인 17,818 / 53,392<br>`transaction_line` 55,032 / 55,032<br>`transaction` 48,566 / 48,508<br>`account` 6 / 6 | 없음 | `account`<br>`transaction`<br>`transaction_line` | 1,784 / 0 |
| 월별 통계 | 3.764 / 4.060 / 4.203 | 4.142 / 4.274 / 4.435 | 조인 455 / 370<br>`transaction_line` 55,032 / 55,032<br>`transaction` 413 / 408<br>`category` 30 / 30 | `ix_transaction_ledger_occurred_on` | `category`<br>`transaction_line` | 729 / 0 |
| 휴지통 목록 | 6.846 / 6.953 / 7.205 | 7.366 / 7.527 / 8.415 | 조인 1,087 / 1,108<br>`transaction_line` 55,032 / 55,032<br>`transaction` 988 / 1,002 | 없음 | `transaction`<br>`transaction_line` | 1,783 / 0 |
| 카테고리 사용 여부(거래 없음) | 1.102 / 1.140 / 1.212 | 1.382 / 1.408 / 1.588 | `transaction_line` 1 / 0 | 없음 | `transaction_line` | 712 / 0 |
| 카테고리 사용 여부(거래 있음) | 0.003 / 0.004 / 0.005 | 0.003 / 0.003 / 0.005 | `transaction_line` 8,297 / 1 | 없음 | `transaction_line` | 2 / 0 |

#### 장부 1,000개, 300만 건 (`perf_l1000_3m`)

| 쿼리 | 1회차 최소 / 중앙 / 최대 | 2회차 최소 / 중앙 / 최대 | 행 수(예상 / 실제) | 쓰인 인덱스 | 전체 훑기 | 버퍼 hit / read (1회차) |
|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 2.954 / 3.387 / 3.624 | 4.018 / 5.232 / 6.057 | 조인 755 / 450 ×2<br>`transaction_line` 776 / 462 ×2<br>`transaction` 1 / 1 ×924 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,624 / 0 |
| 장부 전체 잔액 | 8.107 / 9.298 / 9.655 | 9.807 / 10.838 / 11.103 | 조인 998 / 3,192<br>`account` 7 / 6<br>`transaction_line` 446 / 548 ×6<br>`transaction` 1 / 1 ×3,289 | `ix_transaction_line_account`<br>`transaction_pkey` | `account` | 16,563 / 0 |
| 월별 통계 | 0.065 / 0.085 / 0.116 | 0.088 / 0.107 / 0.151 | 조인 28 / 23<br>`transaction` 25 / 25<br>`transaction_line` 1 / 1 ×25<br>`category` 1 / 1 ×27 | `category_pkey`<br>`ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | 없음 | 197 / 0 |
| 휴지통 목록 | 1.095 / 1.422 / 1.603 | 2.238 / 3.213 / 3.680 | 조인 61 / 69<br>`transaction` 55 / 61<br>`transaction_line` 1 / 1 ×61 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | 없음 | 3,270 / 0 |
| 카테고리 사용 여부(거래 없음) | 118.046 / 120.602 / 133.819 | 122.077 / 131.987 / 138.408 | `transaction_line` 120 / 0 | 없음 | `transaction_line` | 5,427~5,619 / 37,074~37,266 |
| 카테고리 사용 여부(거래 있음) | 0.003 / 0.004 / 0.394 | 0.003 / 0.004 / 0.006 | `transaction_line` 120 / 1 | 없음 | `transaction_line` | 2~17 / 0~65 |

#### 계좌 하나 라인 1만 (`perf_one_10k`)

| 쿼리 | 1회차 최소 / 중앙 / 최대 | 2회차 최소 / 중앙 / 최대 | 행 수(예상 / 실제) | 쓰인 인덱스 | 전체 훑기 | 버퍼 hit / read (1회차) |
|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 2.357 / 2.549 / 3.043 | 2.524 / 2.561 / 2.607 | 조인 9,727 / 9,726<br>`transaction_line` 10,000 / 10,000<br>`transaction` 9,727 / 9,726 | 없음 | `transaction`<br>`transaction_line` | 358 / 0 |
| 장부 전체 잔액 | 3.742 / 3.816 / 4.200 | 3.869 / 3.950 / 4.030 | 조인 3,564 / 10,691<br>`transaction_line` 10,990 / 10,990<br>`transaction` 9,728 / 9,726<br>`account` 6 / 6 | 없음 | `account`<br>`transaction`<br>`transaction_line` | 359 / 0 |
| 월별 통계 | 0.753 / 0.817 / 0.910 | 0.818 / 0.831 / 0.887 | 조인 90 / 78<br>`transaction_line` 10,990 / 10,990<br>`transaction` 82 / 85<br>`category` 30 / 30 | `ix_transaction_ledger_occurred_on` | `category`<br>`transaction_line` | 149 / 0 |
| 휴지통 목록 | 1.168 / 1.246 / 1.494 | 1.261 / 1.296 / 1.370 | 조인 199 / 202<br>`transaction_line` 10,990 / 10,990<br>`transaction` 181 / 181 | 없음 | `transaction`<br>`transaction_line` | 358 / 0 |
| 카테고리 사용 여부(거래 없음) | 0.224 / 0.236 / 0.270 | 0.225 / 0.232 / 0.248 | `transaction_line` 1 / 0 | 없음 | `transaction_line` | 143 / 0 |
| 카테고리 사용 여부(거래 있음) | 0.004 / 0.004 / 0.005 | 0.003 / 0.004 / 0.005 | `transaction_line` 1,708 / 1 | 없음 | `transaction_line` | 2 / 0 |

#### 계좌 하나 라인 5만 (`perf_one_50k`)

| 쿼리 | 1회차 최소 / 중앙 / 최대 | 2회차 최소 / 중앙 / 최대 | 행 수(예상 / 실제) | 쓰인 인덱스 | 전체 훑기 | 버퍼 hit / read (1회차) |
|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 13.557 / 14.122 / 18.488 | 14.777 / 16.756 / 26.056 | 조인 48,474 / 48,508<br>`transaction_line` 49,964 / 50,000<br>`transaction` 48,509 / 48,508 | 없음 | `transaction`<br>`transaction_line` | 1,783 / 0 |
| 장부 전체 잔액 | 19.705 / 20.686 / 23.547 | 25.672 / 26.843 / 29.956 | 조인 17,798 / 53,392<br>`transaction_line` 55,032 / 55,032<br>`transaction` 48,513 / 48,508<br>`account` 6 / 6 | 없음 | `account`<br>`transaction`<br>`transaction_line` | 1,784 / 0 |
| 월별 통계 | 3.787 / 3.910 / 4.098 | 4.847 / 5.064 / 5.587 | 조인 480 / 370<br>`transaction_line` 55,032 / 55,032<br>`transaction` 436 / 408<br>`category` 30 / 30 | `ix_transaction_ledger_occurred_on` | `category`<br>`transaction_line` | 729 / 0 |
| 휴지통 목록 | 6.462 / 6.791 / 6.835 | 7.992 / 8.106 / 8.439 | 조인 1,084 / 1,108<br>`transaction_line` 55,032 / 55,032<br>`transaction` 985 / 1,002 | 없음 | `transaction`<br>`transaction_line` | 1,783 / 0 |
| 카테고리 사용 여부(거래 없음) | 1.055 / 1.106 / 1.180 | 1.578 / 1.592 / 1.705 | `transaction_line` 1 / 0 | 없음 | `transaction_line` | 712 / 0 |
| 카테고리 사용 여부(거래 있음) | 0.002 / 0.003 / 0.005 | 0.003 / 0.004 / 0.009 | `transaction_line` 8,460 / 1 | 없음 | `transaction_line` | 2 / 0 |

#### 계좌 하나 라인 20만 (`perf_one_200k`)

| 쿼리 | 1회차 최소 / 중앙 / 최대 | 2회차 최소 / 중앙 / 최대 | 행 수(예상 / 실제) | 쓰인 인덱스 | 전체 훑기 | 버퍼 hit / read (1회차) |
|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 38.266 / 42.156 / 48.141 | 55.642 / 59.130 / 64.740 | 조인 114,398 / 97,006 ×2<br>`transaction_line` 117,899 / 100,000 ×2<br>`transaction` 80,859 / 97,006 ×2 | 없음 | `transaction`<br>`transaction_line`<br>(병렬) | 7,190 / 0 |
| 장부 전체 잔액 | 51.631 / 52.632 / 57.591 | 63.532 / 71.806 / 85.092 | 조인 41,868 / 106,728 ×2<br>`transaction_line` 129,436 / 110,020 ×2<br>`transaction` 80,867 / 97,006 ×2<br>`account` 6 / 6 ×2 | 없음 | `account`<br>`transaction`<br>`transaction_line`<br>(병렬) | 7,140 / 0 |
| 월별 통계 | 11.238 / 11.722 / 14.659 | 12.574 / 13.756 / 13.967 | 조인 1,037 / 736 ×2<br>`transaction_line` 129,436 / 110,020 ×2<br>`transaction` 1,602 / 1,636 ×2<br>`category` 30 / 30 ×2 | `ix_transaction_ledger_occurred_on` | `category`<br>`transaction_line`<br>(병렬) | 2,999 / 0 |
| 휴지통 목록 | 18.391 / 20.269 / 22.753 | 24.074 / 27.398 / 28.588 | 조인 2,524 / 2,205 ×2<br>`transaction_line` 129,436 / 110,020 ×2<br>`transaction` 1,625 / 2,000 ×2 | 없음 | `transaction`<br>`transaction_line`<br>(병렬) | 7,213 / 0 |
| 카테고리 사용 여부(거래 없음) | 4.430 / 4.553 / 4.917 | 5.840 / 6.527 / 7.474 | `transaction_line` 1 / 0 ×2 | 없음 | `transaction_line`<br>(병렬) | 2,847 / 0 |
| 카테고리 사용 여부(거래 있음) | 0.002 / 0.004 / 0.006 | 0.003 / 0.005 / 0.011 | `transaction_line` 33,820 / 1 | 없음 | `transaction_line` | 2 / 0 |

- "전체 훑기"는 실행 계획에 Seq Scan 노드가 있다는 뜻이다. 카테고리 사용 여부(거래 있음)도 Seq Scan 노드지만 `LIMIT 1`이라 첫 행을 찾고 멈췄다.
- 병렬 계획(계좌 하나 라인 20만의 5개, 300만 건의 계좌 하나 잔액 1개)은 작업자 1개를 띄웠다. 병렬 노드는 예상 행 수도 프로세스 하나의 값이다.

## 5. 측정 중 한계였던 자원

**모른다.** 실행하는 동안의 CPU, 디스크 사용률을 따로 재지 않았다. 확인한 사실만 적는다.

- 1회차에서 버퍼 read가 0이 아니었던 것은 300만 건 DB의 카테고리 사용 여부 두 가지뿐이다.
- 300만 건을 넣은 뒤 컨테이너 메모리는 473.3MiB / 1GiB, 1회차를 잰 뒤는 479.9MiB / 1GiB였다(`docker stats` 한 번씩). OOM으로 죽은 적은 없다.

## 6. 왜 이 수치인지

여기에는 쓰지 않는다. perf가 검수하며 쓴다.

## 7. 목표 대비 판정

기준은 [docs/perf/README.md](../README.md) 2장의 쿼리 상한이다. 시간은 두 회차를 합친 14번의 최댓값으로 비교했다.

| 대상 | 상한 | 1만 2천 건 | 5만 건 | 300만 건 | 시간 | `transaction`·`transaction_line` 전체 훑기 없음 |
|---|---|---|---|---|---|---|
| 거래 목록 50건 | 50ms | 쿼리 없음 | 쿼리 없음 | 쿼리 없음 | 판정 못 함 | 판정 못 함 |
| 월별 통계 | 100ms | 1.230ms | 4.435ms | 0.151ms | 상한 안 | 1만 2천 건, 5만 건: **있음**(`transaction_line`). 300만 건: 없음 |
| 장부 전체 잔액 | 200ms | 6.688ms | 23.725ms | 11.103ms | 상한 안 | 1만 2천 건, 5만 건: **있음**(`transaction`, `transaction_line`). 300만 건: 없음(`account`만 있음) |

계좌 하나 라인 1만 / 5만 / 20만 DB(잔액 기준선용)의 같은 쿼리는 다음과 같다.

| 대상 | 상한 | 라인 1만 | 라인 5만 | 라인 20만 | 시간 | 전체 훑기 |
|---|---|---|---|---|---|---|
| 월별 통계 | 100ms | 0.910ms | 5.587ms | 14.659ms | 상한 안 | 세 크기 모두 **있음**(`transaction_line`) |
| 장부 전체 잔액 | 200ms | 4.200ms | 29.956ms | 85.092ms | 상한 안 | 세 크기 모두 **있음**(`transaction`, `transaction_line`) |
| 계좌 하나 잔액 | 없음 | 3.043ms | 26.056ms | 64.740ms | 상한 없음 | 세 크기 모두 있음(`transaction`, `transaction_line`) |

휴지통 목록, 카테고리 사용 여부, 계좌 하나 잔액은 상한이 정해져 있지 않아 값만 적었다.

## 8. 확인과 추정

- 확인: 이 문서의 시간, 행 수, 버퍼, 인덱스, 전체 훑기는 모두 직접 잰 값이다.
- 추정: 데이터 크기(장부당 1만 2천 건, 장부 1,000개 300만 건)와 거래 종류 비율은 실제 사용에서 얻은 것이 아니라 정해 둔 가정이다.

## 9. 못 잰 것

- 거래 목록 50건: 쿼리가 아직 없다.
- API 지연, 화면 지표, 동시 요청, 운영과 같은 사양: 이번 범위가 아니다.
- 바인드 변수로 보낼 때의 계획, 캐시가 빈 상태의 첫 실행.
- 잔액·통계 메서드가 함께 보내는 다른 SQL(권한 확인, 계좌 조회, 계좌 목록).
- pg_stat_statements는 켜지고 집계되는 것까지 확인했다. 이 문서의 수치에는 쓰지 않았다.

## 10. 대표 실행 계획 원문

1회차 7번 가운데 중앙값인 실행의 원문이다.

<details>
<summary>장부 1개, 1만 2천 건 (<code>perf_l1_12k</code>)</summary>

계좌 하나 잔액

```text
Aggregate  (cost=854.13..854.14 rows=1 width=32) (actual time=2.387..2.389 rows=1 loops=1)
  Buffers: shared hit=432
  ->  Hash Join  (cost=313.51..845.06 rows=3626 width=8) (actual time=0.609..2.273 rows=3633 loops=1)
        Hash Cond: (t1_0.id = tl1_0.transaction_id)
        Buffers: shared hit=432
        ->  Seq Scan on transaction t1_0  (cost=0.00..437.00 rows=11658 width=16) (actual time=0.002..0.892 rows=11657 loops=1)
              Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
              Rows Removed by Filter: 343
              Buffers: shared hit=257
        ->  Hash  (cost=266.86..266.86 rows=3732 width=24) (actual time=0.603..0.604 rows=3732 loops=1)
              Buckets: 4096  Batches: 1  Memory Usage: 237kB
              Buffers: shared hit=175
              ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=49.21..266.86 rows=3732 width=24) (actual time=0.042..0.335 rows=3732 loops=1)
                    Recheck Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                    Heap Blocks: exact=171
                    Buffers: shared hit=175
                    ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..48.27 rows=3732 width=0) (actual time=0.033..0.033 rows=3732 loops=1)
                          Index Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                          Buffers: shared hit=4
Planning:
  Buffers: shared hit=12
Planning Time: 0.079 ms
Execution Time: 2.408 ms
```

장부 전체 잔액

```text
HashAggregate  (cost=956.20..956.28 rows=6 width=48) (actual time=4.483..4.484 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=429
  ->  Hash Join  (cost=553.89..934.84 rows=4273 width=24) (actual time=1.257..3.705 rows=12823 loops=1)
        Hash Cond: (tl1_0.account_id = a1_0.id)
        Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
        Buffers: shared hit=429
        ->  Hash Join  (cost=552.74..890.34 rows=12820 width=28) (actual time=1.252..2.787 rows=12823 loops=1)
              Hash Cond: (tl1_0.transaction_id = t1_0.id)
              Buffers: shared hit=428
              ->  Seq Scan on transaction_line tl1_0  (cost=0.00..302.95 rows=13195 width=40) (actual time=0.001..0.391 rows=13195 loops=1)
                    Buffers: shared hit=171
              ->  Hash  (cost=407.00..407.00 rows=11659 width=20) (actual time=1.249..1.249 rows=11657 loops=1)
                    Buckets: 16384  Batches: 1  Memory Usage: 720kB
                    Buffers: shared hit=257
                    ->  Seq Scan on transaction t1_0  (cost=0.00..407.00 rows=11659 width=20) (actual time=0.001..0.773 rows=11657 loops=1)
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 343
                          Buffers: shared hit=257
        ->  Hash  (cost=1.07..1.07 rows=6 width=20) (actual time=0.004..0.004 rows=6 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 9kB
              Buffers: shared hit=1
              ->  Seq Scan on account a1_0  (cost=0.00..1.07 rows=6 width=20) (actual time=0.003..0.003 rows=6 loops=1)
                    Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=16
Planning Time: 0.095 ms
Execution Time: 4.494 ms
```

월별 통계

```text
GroupAggregate  (cost=503.40..505.35 rows=58 width=55) (actual time=0.972..0.982 rows=27 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=177
  ->  Sort  (cost=503.40..503.67 rows=108 width=31) (actual time=0.971..0.973 rows=88 loops=1)
        Sort Key: tl1_0.category_id, c1_0.kind
        Sort Method: quicksort  Memory: 29kB
        Buffers: shared hit=177
        ->  Hash Join  (cost=161.83..499.75 rows=108 width=31) (actual time=0.940..0.962 rows=88 loops=1)
              Hash Cond: (tl1_0.category_id = c1_0.id)
              Buffers: shared hit=177
              ->  Hash Join  (cost=160.16..497.76 rows=108 width=24) (actual time=0.934..0.948 rows=114 loops=1)
                    Hash Cond: (tl1_0.transaction_id = t1_0.id)
                    Buffers: shared hit=176
                    ->  Seq Scan on transaction_line tl1_0  (cost=0.00..302.95 rows=13195 width=40) (actual time=0.001..0.398 rows=13195 loops=1)
                          Buffers: shared hit=171
                    ->  Hash  (cost=158.93..158.93 rows=98 width=16) (actual time=0.018..0.018 rows=101 loops=1)
                          Buckets: 1024  Batches: 1  Memory Usage: 13kB
                          Buffers: shared hit=5
                          ->  Index Scan using ix_transaction_ledger_occurred_on on transaction t1_0  (cost=0.29..158.93 rows=98 width=16) (actual time=0.004..0.013 rows=101 loops=1)
                                Index Cond: ((ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                                Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                                Rows Removed by Filter: 1
                                Buffers: shared hit=5
              ->  Hash  (cost=1.30..1.30 rows=30 width=23) (actual time=0.005..0.005 rows=30 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 10kB
                    Buffers: shared hit=1
                    ->  Seq Scan on category c1_0  (cost=0.00..1.30 rows=30 width=23) (actual time=0.002..0.003 rows=30 loops=1)
                          Buffers: shared hit=1
Planning:
  Buffers: shared hit=16
Planning Time: 0.068 ms
Execution Time: 0.989 ms
```

휴지통 목록

```text
Sort  (cost=756.87..757.47 rows=241 width=240) (actual time=1.478..1.484 rows=243 loops=1)
  Sort Key: t1_0.deleted_at DESC
  Sort Method: quicksort  Memory: 82kB
  Buffers: shared hit=428
  ->  Hash Right Join  (cost=409.74..747.34 rows=241 width=240) (actual time=0.505..1.444 rows=243 loops=1)
        Hash Cond: (l1_0.transaction_id = t1_0.id)
        Buffers: shared hit=428
        ->  Seq Scan on transaction_line l1_0  (cost=0.00..302.95 rows=13195 width=80) (actual time=0.001..0.380 rows=13195 loops=1)
              Buffers: shared hit=171
        ->  Hash  (cost=407.00..407.00 rows=219 width=160) (actual time=0.501..0.501 rows=219 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 48kB
              Buffers: shared hit=257
              ->  Seq Scan on transaction t1_0  (cost=0.00..407.00 rows=219 width=160) (actual time=0.003..0.478 rows=219 loops=1)
                    Filter: ((deleted_at IS NOT NULL) AND (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid))
                    Rows Removed by Filter: 11781
                    Buffers: shared hit=257
Planning:
  Buffers: shared hit=12
Planning Time: 0.053 ms
Execution Time: 1.495 ms
```

카테고리 사용 여부(거래 없음)

```text
Limit  (cost=0.00..335.94 rows=1 width=16) (actual time=0.272..0.272 rows=0 loops=1)
  Buffers: shared hit=171
  ->  Seq Scan on transaction_line tl1_0  (cost=0.00..335.94 rows=1 width=16) (actual time=0.272..0.272 rows=0 loops=1)
        Filter: (category_id = '2f893fd7-ab0c-a0a1-abb4-ffeed6703c7d'::uuid)
        Rows Removed by Filter: 13195
        Buffers: shared hit=171
Planning Time: 0.007 ms
Execution Time: 0.274 ms
```

카테고리 사용 여부(거래 있음)

```text
Limit  (cost=0.00..0.16 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=1)
  Buffers: shared hit=2
  ->  Seq Scan on transaction_line tl1_0  (cost=0.00..335.94 rows=2068 width=16) (actual time=0.001..0.001 rows=1 loops=1)
        Filter: (category_id = '94eed33f-637a-10f4-c112-e547d49a3b80'::uuid)
        Rows Removed by Filter: 3
        Buffers: shared hit=2
Planning Time: 0.006 ms
Execution Time: 0.003 ms
```

</details>

<details>
<summary>장부 1개, 5만 건 (<code>perf_l1_50k</code>)</summary>

장부 전체 잔액

```text
HashAggregate  (cost=3980.89..3980.96 rows=6 width=48) (actual time=20.708..20.710 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=1784
  ->  Hash Join  (cost=2304.22..3891.80 rows=17818 width=24) (actual time=5.872..17.415 rows=53392 loops=1)
        Hash Cond: (tl1_0.account_id = a1_0.id)
        Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
        Buffers: shared hit=1784
        ->  Hash Join  (cost=2303.07..3709.87 rows=53454 width=28) (actual time=5.865..13.652 rows=53392 loops=1)
              Hash Cond: (tl1_0.transaction_id = t1_0.id)
              Buffers: shared hit=1783
              ->  Seq Scan on transaction_line tl1_0  (cost=0.00..1262.32 rows=55032 width=40) (actual time=0.001..1.691 rows=55032 loops=1)
                    Buffers: shared hit=712
              ->  Hash  (cost=1696.00..1696.00 rows=48566 width=20) (actual time=5.858..5.859 rows=48508 loops=1)
                    Buckets: 65536  Batches: 1  Memory Usage: 2976kB
                    Buffers: shared hit=1071
                    ->  Seq Scan on transaction t1_0  (cost=0.00..1696.00 rows=48566 width=20) (actual time=0.002..3.587 rows=48508 loops=1)
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 1492
                          Buffers: shared hit=1071
        ->  Hash  (cost=1.07..1.07 rows=6 width=20) (actual time=0.005..0.005 rows=6 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 9kB
              Buffers: shared hit=1
              ->  Seq Scan on account a1_0  (cost=0.00..1.07 rows=6 width=20) (actual time=0.003..0.003 rows=6 loops=1)
                    Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=16
Planning Time: 0.126 ms
Execution Time: 20.734 ms
```

월별 통계

```text
HashAggregate  (cost=2061.85..2062.72 rows=58 width=55) (actual time=4.037..4.040 rows=29 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Batches: 1  Memory Usage: 24kB
  Buffers: shared hit=729
  ->  Hash Join  (cost=650.31..2058.43 rows=455 width=31) (actual time=3.924..4.004 rows=370 loops=1)
        Hash Cond: (tl1_0.category_id = c1_0.id)
        Buffers: shared hit=729
        ->  Hash Join  (cost=648.64..2055.43 rows=455 width=24) (actual time=3.916..3.969 rows=446 loops=1)
              Hash Cond: (tl1_0.transaction_id = t1_0.id)
              Buffers: shared hit=728
              ->  Seq Scan on transaction_line tl1_0  (cost=0.00..1262.32 rows=55032 width=40) (actual time=0.001..1.639 rows=55032 loops=1)
                    Buffers: shared hit=712
              ->  Hash  (cost=643.48..643.48 rows=413 width=16) (actual time=0.078..0.078 rows=408 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 28kB
                    Buffers: shared hit=16
                    ->  Index Scan using ix_transaction_ledger_occurred_on on transaction t1_0  (cost=0.29..643.48 rows=413 width=16) (actual time=0.004..0.056 rows=408 loops=1)
                          Index Cond: ((ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 17
                          Buffers: shared hit=16
        ->  Hash  (cost=1.30..1.30 rows=30 width=23) (actual time=0.005..0.006 rows=30 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 10kB
              Buffers: shared hit=1
              ->  Seq Scan on category c1_0  (cost=0.00..1.30 rows=30 width=23) (actual time=0.002..0.003 rows=30 loops=1)
                    Buffers: shared hit=1
Planning:
  Buffers: shared hit=16
Planning Time: 0.072 ms
Execution Time: 4.060 ms
```

</details>

<details>
<summary>장부 1,000개, 300만 건 (<code>perf_l1000_3m</code>)</summary>

계좌 하나 잔액

```text
Finalize Aggregate  (cost=11953.77..11953.78 rows=1 width=32) (actual time=2.414..3.377 rows=1 loops=1)
  Buffers: shared hit=4624
  ->  Gather  (cost=11953.65..11953.76 rows=1 width=32) (actual time=2.367..3.373 rows=2 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=4624
        ->  Partial Aggregate  (cost=10953.65..10953.66 rows=1 width=32) (actual time=1.669..1.670 rows=1 loops=2)
              Buffers: shared hit=4624
              ->  Nested Loop  (cost=19.09..10951.76 rows=755 width=8) (actual time=0.131..1.654 rows=450 loops=2)
                    Buffers: shared hit=4624
                    ->  Parallel Bitmap Heap Scan on transaction_line tl1_0  (cost=18.66..4547.82 rows=776 width=24) (actual time=0.122..0.544 rows=462 loops=2)
                          Recheck Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                          Heap Blocks: exact=760
                          Buffers: shared hit=927
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..18.33 rows=1320 width=0) (actual time=0.185..0.186 rows=924 loops=1)
                                Index Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                                Buffers: shared hit=3
                    ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..8.25 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=924)
                          Index Cond: (id = tl1_0.transaction_id)
                          Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 0
                          Buffers: shared hit=3697
Planning:
  Buffers: shared hit=16
Planning Time: 0.075 ms
Execution Time: 3.387 ms
```

장부 전체 잔액

```text
GroupAggregate  (cost=13249.98..13269.94 rows=998 width=48) (actual time=9.092..9.261 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=16563
  ->  Sort  (cost=13249.98..13252.48 rows=998 width=24) (actual time=9.055..9.123 rows=3192 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 221kB
        Buffers: shared hit=16563
        ->  Nested Loop  (cost=8.32..13200.27 rows=998 width=24) (actual time=0.126..8.773 rows=3192 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=16563
              ->  Nested Loop  (cost=7.89..11477.80 rows=3080 width=44) (actual time=0.122..2.705 rows=3289 loops=1)
                    Buffers: shared hit=3407
                    ->  Seq Scan on account a1_0  (cost=0.00..193.75 rows=7 width=20) (actual time=0.003..0.175 rows=6 loops=1)
                          Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                          Rows Removed by Filter: 7494
                          Buffers: shared hit=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.89..1607.55 rows=446 width=40) (actual time=0.053..0.384 rows=548 loops=6)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=3289
                          Buffers: shared hit=3307
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.77 rows=446 width=0) (actual time=0.027..0.027 rows=548 loops=6)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=18
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.002..0.002 rows=1 loops=3289)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=13156
Planning:
  Buffers: shared hit=30
Planning Time: 0.169 ms
Execution Time: 9.298 ms
```

월별 통계

```text
GroupAggregate  (cost=328.38..329.08 rows=28 width=55) (actual time=0.071..0.076 rows=15 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=197
  ->  Sort  (cost=328.38..328.45 rows=28 width=31) (actual time=0.070..0.071 rows=23 loops=1)
        Sort Key: tl1_0.category_id, c1_0.kind
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=197
        ->  Nested Loop  (cost=5.48..327.71 rows=28 width=31) (actual time=0.009..0.066 rows=23 loops=1)
              Buffers: shared hit=197
              ->  Nested Loop  (cost=5.19..319.15 rows=28 width=24) (actual time=0.008..0.048 rows=27 loops=1)
                    Buffers: shared hit=128
                    ->  Bitmap Heap Scan on transaction t1_0  (cost=4.76..107.71 rows=25 width=16) (actual time=0.006..0.014 rows=25 loops=1)
                          Recheck Cond: ((ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                          Heap Blocks: exact=25
                          Buffers: shared hit=28
                          ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..4.75 rows=26 width=0) (actual time=0.003..0.003 rows=25 loops=1)
                                Index Cond: ((ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                                Buffers: shared hit=3
                    ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.45 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=25)
                          Index Cond: (transaction_id = t1_0.id)
                          Buffers: shared hit=100
              ->  Index Scan using category_pkey on category c1_0  (cost=0.29..0.31 rows=1 width=23) (actual time=0.001..0.001 rows=1 loops=27)
                    Index Cond: (id = tl1_0.category_id)
                    Buffers: shared hit=69
Planning:
  Buffers: shared hit=22
Planning Time: 0.087 ms
Execution Time: 0.085 ms
```

휴지통 목록

```text
Sort  (cost=10418.77..10418.92 rows=61 width=242) (actual time=1.399..1.401 rows=69 loops=1)
  Sort Key: t1_0.deleted_at DESC
  Sort Method: quicksort  Memory: 41kB
  Buffers: shared hit=3270
  ->  Nested Loop Left Join  (cost=123.22..10416.96 rows=61 width=242) (actual time=0.353..1.387 rows=69 loops=1)
        Buffers: shared hit=3270
        ->  Bitmap Heap Scan on transaction t1_0  (cost=122.79..9951.80 rows=55 width=162) (actual time=0.350..1.292 rows=61 loops=1)
              Recheck Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
              Filter: (deleted_at IS NOT NULL)
              Rows Removed by Filter: 2939
              Heap Blocks: exact=2999
              Buffers: shared hit=3026
              ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..122.78 rows=2980 width=0) (actual time=0.160..0.160 rows=3000 loops=1)
                    Index Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                    Buffers: shared hit=27
        ->  Index Scan using ix_transaction_line_transaction on transaction_line l1_0  (cost=0.43..8.45 rows=1 width=80) (actual time=0.001..0.001 rows=1 loops=61)
              Index Cond: (transaction_id = t1_0.id)
              Buffers: shared hit=244
Planning:
  Buffers: shared hit=16
Planning Time: 0.055 ms
Execution Time: 1.422 ms
```

카테고리 사용 여부(거래 없음)

```text
Limit  (cost=0.00..699.55 rows=1 width=16) (actual time=120.593..120.593 rows=0 loops=1)
  Buffers: shared hit=5523 read=37170
  ->  Seq Scan on transaction_line tl1_0  (cost=0.00..83945.83 rows=120 width=16) (actual time=120.592..120.592 rows=0 loops=1)
        Filter: (category_id = '2f893fd7-ab0c-a0a1-abb4-ffeed6703c7d'::uuid)
        Rows Removed by Filter: 3300166
        Buffers: shared hit=5523 read=37170
Planning Time: 0.030 ms
Execution Time: 120.602 ms
```

카테고리 사용 여부(거래 있음)

```text
Limit  (cost=0.00..699.55 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=1)
  Buffers: shared hit=2
  ->  Seq Scan on transaction_line tl1_0  (cost=0.00..83945.83 rows=120 width=16) (actual time=0.002..0.002 rows=1 loops=1)
        Filter: (category_id = '94eed33f-637a-10f4-c112-e547d49a3b80'::uuid)
        Rows Removed by Filter: 24
        Buffers: shared hit=2
Planning Time: 0.008 ms
Execution Time: 0.004 ms
```

</details>

<details>
<summary>계좌 하나 라인 1만 (<code>perf_one_10k</code>)</summary>

계좌 하나 잔액

```text
Aggregate  (cost=817.54..817.55 rows=1 width=32) (actual time=2.539..2.540 rows=1 loops=1)
  Buffers: shared hit=358
  ->  Hash Join  (cost=486.59..793.22 rows=9727 width=8) (actual time=1.122..2.291 rows=9726 loops=1)
        Hash Cond: (tl1_0.transaction_id = t1_0.id)
        Buffers: shared hit=358
        ->  Seq Scan on transaction_line tl1_0  (cost=0.00..280.38 rows=10000 width=24) (actual time=0.002..0.421 rows=10000 loops=1)
              Filter: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
              Rows Removed by Filter: 990
              Buffers: shared hit=143
        ->  Hash  (cost=365.00..365.00 rows=9727 width=16) (actual time=1.118..1.119 rows=9726 loops=1)
              Buckets: 16384  Batches: 1  Memory Usage: 584kB
              Buffers: shared hit=215
              ->  Seq Scan on transaction t1_0  (cost=0.00..365.00 rows=9727 width=16) (actual time=0.001..0.704 rows=9726 loops=1)
                    Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 274
                    Buffers: shared hit=215
Planning:
  Buffers: shared hit=12
Planning Time: 0.073 ms
Execution Time: 2.549 ms
```

</details>

<details>
<summary>계좌 하나 라인 5만 (<code>perf_one_50k</code>)</summary>

계좌 하나 잔액

```text
Aggregate  (cost=4079.62..4079.63 rows=1 width=32) (actual time=14.103..14.104 rows=1 loops=1)
  Buffers: shared hit=1783
  ->  Hash Join  (cost=2427.36..3958.43 rows=48474 width=8) (actual time=5.878..12.863 rows=48508 loops=1)
        Hash Cond: (tl1_0.transaction_id = t1_0.id)
        Buffers: shared hit=1783
        ->  Seq Scan on transaction_line tl1_0  (cost=0.00..1399.90 rows=49964 width=24) (actual time=0.002..2.393 rows=50000 loops=1)
              Filter: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
              Rows Removed by Filter: 5032
              Buffers: shared hit=712
        ->  Hash  (cost=1821.00..1821.00 rows=48509 width=16) (actual time=5.869..5.870 rows=48508 loops=1)
              Buckets: 65536  Batches: 1  Memory Usage: 2786kB
              Buffers: shared hit=1071
              ->  Seq Scan on transaction t1_0  (cost=0.00..1821.00 rows=48509 width=16) (actual time=0.002..3.598 rows=48508 loops=1)
                    Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 1492
                    Buffers: shared hit=1071
Planning:
  Buffers: shared hit=12
Planning Time: 0.087 ms
Execution Time: 14.122 ms
```

</details>

<details>
<summary>계좌 하나 라인 20만 (<code>perf_one_200k</code>)</summary>

계좌 하나 잔액

```text
Finalize Aggregate  (cost=12602.30..12602.31 rows=1 width=32) (actual time=40.853..42.138 rows=1 loops=1)
  Buffers: shared hit=7190
  ->  Gather  (cost=12602.18..12602.29 rows=1 width=32) (actual time=40.628..42.133 rows=2 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=7190
        ->  Partial Aggregate  (cost=11602.18..11602.19 rows=1 width=32) (actual time=39.769..39.771 rows=1 loops=2)
              Buffers: shared hit=7190
              ->  Parallel Hash Join  (cost=6541.74..11316.18 rows=114398 width=8) (actual time=18.182..37.143 rows=97006 loops=2)
                    Hash Cond: (tl1_0.transaction_id = t1_0.id)
                    Buffers: shared hit=7190
                    ->  Parallel Seq Scan on transaction_line tl1_0  (cost=0.00..4464.95 rows=117899 width=24) (actual time=0.004..5.076 rows=100000 loops=2)
                          Filter: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                          Rows Removed by Filter: 10020
                          Buffers: shared hit=2847
                    ->  Parallel Hash  (cost=5531.00..5531.00 rows=80859 width=16) (actual time=17.765..17.766 rows=97006 loops=2)
                          Buckets: 262144  Batches: 1  Memory Usage: 11168kB
                          Buffers: shared hit=4281
                          ->  Parallel Seq Scan on transaction t1_0  (cost=0.00..5531.00 rows=80859 width=16) (actual time=0.004..7.944 rows=97006 loops=2)
                                Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                                Rows Removed by Filter: 2994
                                Buffers: shared hit=4281
Planning:
  Buffers: shared hit=16
Planning Time: 0.091 ms
Execution Time: 42.156 ms
```

장부 전체 잔액

```text
Finalize GroupAggregate  (cost=12450.08..12450.89 rows=6 width=48) (actual time=51.138..52.612 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=7140
  ->  Gather Merge  (cost=12450.08..12450.77 rows=6 width=48) (actual time=51.133..52.606 rows=12 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=7140
        ->  Sort  (cost=11450.07..11450.09 rows=6 width=48) (actual time=50.354..50.356 rows=6 loops=2)
              Sort Key: tl1_0.account_id
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=7140
              Worker 0:  Sort Method: quicksort  Memory: 25kB
              ->  Partial HashAggregate  (cost=11449.92..11450.00 rows=6 width=48) (actual time=50.346..50.348 rows=6 loops=2)
                    Group Key: tl1_0.account_id
                    Batches: 1  Memory Usage: 24kB
                    Buffers: shared hit=7133
                    Worker 0:  Batches: 1  Memory Usage: 24kB
                    ->  Hash Join  (cost=6334.65..11240.58 rows=41868 width=24) (actual time=16.490..44.265 rows=106728 loops=2)
                          Hash Cond: (tl1_0.account_id = a1_0.id)
                          Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
                          Buffers: shared hit=7133
                          ->  Parallel Hash Join  (cost=6333.50..10814.64 rows=125605 width=28) (actual time=16.479..36.147 rows=106728 loops=2)
                                Hash Cond: (tl1_0.transaction_id = t1_0.id)
                                Buffers: shared hit=7128
                                ->  Parallel Seq Scan on transaction_line tl1_0  (cost=0.00..4141.36 rows=129436 width=40) (actual time=0.001..3.862 rows=110020 loops=2)
                                      Buffers: shared hit=2847
                                ->  Parallel Hash  (cost=5322.67..5322.67 rows=80867 width=20) (actual time=16.142..16.142 rows=97006 loops=2)
                                      Buckets: 262144  Batches: 1  Memory Usage: 12704kB
                                      Buffers: shared hit=4281
                                      ->  Parallel Seq Scan on transaction t1_0  (cost=0.00..5322.67 rows=80867 width=20) (actual time=0.002..7.818 rows=97006 loops=2)
                                            Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                                            Rows Removed by Filter: 2994
                                            Buffers: shared hit=4281
                          ->  Hash  (cost=1.07..1.07 rows=6 width=20) (actual time=0.005..0.005 rows=6 loops=2)
                                Buckets: 1024  Batches: 1  Memory Usage: 9kB
                                Buffers: shared hit=2
                                ->  Seq Scan on account a1_0  (cost=0.00..1.07 rows=6 width=20) (actual time=0.003..0.004 rows=6 loops=2)
                                      Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                                      Buffers: shared hit=2
Planning:
  Buffers: shared hit=20
Planning Time: 0.143 ms
Execution Time: 52.632 ms
```

월별 통계

```text
Finalize GroupAggregate  (cost=8051.73..8119.84 rows=58 width=55) (actual time=10.513..11.698 rows=29 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=2999
  ->  Gather Merge  (cost=8051.73..8118.39 rows=58 width=55) (actual time=10.499..11.684 rows=57 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=2999
        ->  Partial GroupAggregate  (cost=7051.72..7111.85 rows=58 width=55) (actual time=9.449..9.638 rows=28 loops=2)
              Group Key: tl1_0.category_id, c1_0.kind
              Buffers: shared hit=2999
              ->  Incremental Sort  (cost=7051.72..7103.35 rows=1037 width=31) (actual time=9.443..9.592 rows=736 loops=2)
                    Sort Key: tl1_0.category_id, c1_0.kind
                    Presorted Key: tl1_0.category_id
                    Full-sort Groups: 15  Sort Method: quicksort  Average Memory: 26kB  Peak Memory: 26kB
                    Pre-sorted Groups: 5  Sort Method: quicksort  Average Memory: 25kB  Peak Memory: 25kB
                    Buffers: shared hit=2999
                    Worker 0:  Full-sort Groups: 13  Sort Method: quicksort  Average Memory: 26kB  Peak Memory: 26kB
                      Pre-sorted Groups: 5  Sort Method: quicksort  Average Memory: 25kB  Peak Memory: 25kB
                    ->  Merge Join  (cost=7050.40..7063.29 rows=1037 width=31) (actual time=9.423..9.498 rows=736 loops=2)
                          Merge Cond: (tl1_0.category_id = c1_0.id)
                          Buffers: shared hit=2963
                          ->  Sort  (cost=7048.37..7050.96 rows=1037 width=24) (actual time=9.401..9.420 rows=736 loops=2)
                                Sort Key: tl1_0.category_id
                                Sort Method: quicksort  Memory: 60kB
                                Buffers: shared hit=2961
                                Worker 0:  Sort Method: quicksort  Memory: 55kB
                                ->  Hash Join  (cost=2515.28..6996.42 rows=1037 width=24) (actual time=9.203..9.324 rows=900 loops=2)
                                      Hash Cond: (tl1_0.transaction_id = t1_0.id)
                                      Buffers: shared hit=2961
                                      ->  Parallel Seq Scan on transaction_line tl1_0  (cost=0.00..4141.36 rows=129436 width=40) (actual time=0.004..3.828 rows=110020 loops=2)
                                            Buffers: shared hit=2847
                                      ->  Hash  (cost=2495.26..2495.26 rows=1602 width=16) (actual time=0.237..0.237 rows=1636 loops=2)
                                            Buckets: 2048  Batches: 1  Memory Usage: 93kB
                                            Buffers: shared hit=103
                                            ->  Index Scan using ix_transaction_ledger_occurred_on on transaction t1_0  (cost=0.29..2495.26 rows=1602 width=16) (actual time=0.009..0.154 rows=1636 loops=2)
                                                  Index Cond: ((ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                                                  Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                                                  Rows Removed by Filter: 62
                                                  Buffers: shared hit=103
                          ->  Sort  (cost=2.04..2.11 rows=30 width=23) (actual time=0.020..0.021 rows=30 loops=2)
                                Sort Key: c1_0.id
                                Sort Method: quicksort  Memory: 26kB
                                Buffers: shared hit=2
                                Worker 0:  Sort Method: quicksort  Memory: 26kB
                                ->  Seq Scan on category c1_0  (cost=0.00..1.30 rows=30 width=23) (actual time=0.011..0.012 rows=30 loops=2)
                                      Buffers: shared hit=2
Planning:
  Buffers: shared hit=20
Planning Time: 0.144 ms
Execution Time: 11.722 ms
```

</details>
