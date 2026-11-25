# 쿼리 기준선 (2026-11-24)

> **한계를 먼저 읽는다.**
> - 맥 로컬 Docker에서 **DB 실행 시간만** 잰 것이다. API 지연이 아니다(네트워크, Hibernate, 권한 확인 쿼리가 빠져 있다).
> - **운영 서버 수치가 아니다.** 운영은 Ampere A1(4 OCPU)이고, 여기서는 Apple M5 Pro이며 CPU 상한이 없다. 컨테이너 메모리와 `shared_buffers`만 운영 초안과 같다.
> - 쿼리를 한 번에 하나씩만 돌렸다. 동시 요청은 재지 않았다.
> - 처음 여섯 DB를 재는 동안 맥에서 다른 작업이 돌고 있었다(load average는 3장). 같은 절차를 두 번 돌렸고 중앙값이 최대 2.3배까지 달랐다(1회차 1.422ms, 2회차 3.213ms). 계획 모양은 두 회차가 같았다.
> - 앱은 값을 바인드 변수로 보낸다. 처음 여섯 DB는 값을 문장에 직접 넣어(리터럴) 쟀다. 바인드 변수일 때의 일반 계획은 큰 장부 DB 두 개의 네 쿼리와 300만 건 DB의 보통 장부에서만 비교했다(4장). 앱(pgjdbc)이 언제 일반 계획을 고르는지는 재지 않았다.
> - 시간은 `EXPLAIN (ANALYZE, BUFFERS)`의 `Execution Time`이다. 노드마다 시간을 재는 비용이 들어 있고, 계획 시간은 빠져 있다.
> - 장부 1개짜리 DB는 테이블의 모든 행이 그 장부의 것이다. 여러 장부가 섞인 것은 300만 건 DB와 큰 장부 DB 두 개뿐이다. "전체 훑기 없음" 기준은 여러 장부가 섞인 DB에서만 판정한다(perf 검수 의견, dba 동의).
> - 거래를 날짜 순으로 넣어 `occurred_on`과 저장 위치가 거의 일치한다. `(ledger_id, occurred_on)` 범위 조회가 실제보다 유리하게 나온다. 실제로는 지난 날짜를 나중에 넣는 경우(엑셀 가져오기, 밀린 입력)가 있다(dba).
> - 수정 흔적이 없는 테이블이다. 최종 상태로 한 번에 넣고 `VACUUM`까지 해서 죽은 행이 없다. 실제 `transaction`은 수정할 때마다 `version`과 `updated_at`이 바뀌어 새 행 버전이 생긴다. 지금 수치는 가장 좋은 상태의 값이다(dba).
> - 휴지통 2%는 실제보다 훨씬 많다. 삭제가 10년에 고르게 퍼져 있다. 30일 자동 삭제(#9)가 들어가면 휴지통에는 최근 30일치만 남는다. 휴지통 목록 수치는 #9 전의 상한으로 읽어야 하고, #9의 부분 인덱스 효과는 이 데이터로는 실제보다 작게 보인다(dba).
> - "거래 있는 카테고리" 0.003ms는 인덱스가 없어도 빠르다는 뜻이 아니다. 전체 훑기가 앞쪽에서 맞는 행을 바로 만나 끝난 것이다. 그 카테고리의 거래가 테이블 뒤쪽에만 있으면 "거래 없음"과 같은 시간이 걸린다(dba).
> - `change_log`가 비어 있다. 재는 쿼리가 읽지 않으니 지금은 맞다. 변경 이력 조회(#47)와 #60을 잴 때는 거래마다 1~3행을 넣어야 한다(dba).
> - `jit`이 켜져 있고 표본은 7개다. 계획 출력의 JIT 줄은 처음 여섯 DB의 720번 실행에는 하나도 없다. 추가 측정에서는 20만 건 큰 장부의 리터럴 계좌 하나 잔액과 휴지통 목록에만 있다(두 회차 모두). 나머지에는 없다.

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-24 |
| 잰 사람 | perf가 맡긴 작업자. 원인 해석과 개선안은 perf가 검수하며 쓴다 |
| 커밋 | 서버 코드와 마이그레이션은 main 48aa00e. 처음 여섯 DB의 `compose.perf.yaml`, `perf/`는 `perf/local-measure-env` 브랜치의 26d0bda. 추가 측정은 a07f04f |

## 1. 결과 요약

- **여러 장부가 섞인 DB에서 큰 장부(5만 건, 20만 건)의 장부 전체 잔액은 상한 200ms를 넘었다**(최댓값 2,906.1ms, 2,701.2ms). 같은 DB의 보통 장부(3,000건)는 5~8ms다. 이유는 6장.
- 초기 규모에서는 문제가 없다고 본다(추정). 공개 뒤 규모에서 문제가 되므로 공개 전에 풀어야 한다.
- **월별 통계**: 처음 여섯 DB와 큰 장부 DB 두 개 모두에서 상한 100ms 안이다. 처음 여섯 DB에서 두 회차를 합친 최댓값은 14.659ms(계좌 하나 라인 20만)다. 장부 1개짜리 DB에서는 `transaction_line` 전체 훑기가 있다. 300만 건 DB에서는 없다.
- **장부 전체 잔액**: 처음 여섯 DB에서는 상한 200ms 안이다. 최댓값은 85.092ms(계좌 하나 라인 20만)다. 큰 장부 DB 두 개는 맨 위 줄과 아래를 본다. 장부 1개짜리 DB에서는 `transaction`과 `transaction_line` 전체 훑기가 있다. 300만 건 DB에서는 두 테이블 전체 훑기가 없고 `account`만 훑는다.
- **여러 장부 DB 안의 큰 장부(추가 측정)**: 1,000개 장부가 섞인 DB의 장부 하나가 크다.
  - 장부 전체 잔액: 5만 건 장부는 중앙값 2,637.4 / 2,894.2ms, 20만 건 장부는 1,876.0 / 2,633.0ms(1회차 / 2회차)다. 같은 DB의 보통 장부(3,000건)는 5.466ms(5만 건 DB), 6.163ms(20만 건 DB)다. 계획은 중첩 루프이고 `transaction`·`transaction_line` 전체 훑기는 없다(`account`는 훑는다).
  - 월별 통계: 5만 건 0.861 / 0.711ms, 20만 건 3.657 / 3.591ms로 상한 안이다. 전체 훑기 없음.
  - 일반 계획(바인드 변수)으로 바꾸면 5만 건과 20만 건 장부의 계좌 하나 잔액, 휴지통 목록, 월별 통계에서 계획 모양이 리터럴과 다르다. 20만 건 장부의 계좌 하나 잔액은 307.6 / 306.4ms(리터럴)에서 1,895.9 / 1,900.1ms가 되고, 휴지통 목록은 105.0 / 109.7ms에서 1,691.8 / 1,689.7ms가 된다. 장부 전체 잔액은 계획 모양이 같다. 자세한 값은 4장에 있다.
- **거래 목록 50건**: 쿼리 없음. 재지 못했다.
- 처음 여섯 DB에서 상한이 정해지지 않은 쿼리 가운데 가장 오래 걸린 것은 300만 건 DB의 카테고리 사용 여부(거래 없는 카테고리)로 중앙값 120.602ms(1회차), 131.987ms(2회차)다. 이 쿼리는 잰 크기 모두에서 `transaction_line` 전체 훑기가 있다.

## 2. 환경

| 항목 | 값 |
|---|---|
| 장비 | 맥, Apple M5 Pro(CPU 15개), 메모리 48GB, macOS 27.0.1 |
| Docker | Docker Desktop, Docker 29.9.2, Compose 5.6.1. Docker VM에 CPU 10개, 메모리 8,214,786,048바이트(약 7.7GB) |
| PostgreSQL | 17.12, arm64 (`postgres:17@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac`) |
| 컨테이너 한도 | 메모리 1GB(`mem_limit`), CPU 상한 없음. 처음 여섯 DB는 스왑 기본값(메모리와 합쳐 2GB)과 `/dev/shm` 64MB에서, 추가 측정은 `memswap_limit` 1g(스왑 없음)와 `shm_size` 256m에서 쟀다 |
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
| `perf_mix_50k` | `ledgers=1000`, `tx_per_ledger=3000`, `big_ledger_tx=50000` | 3,050,000 | 3,355,147 | 60,843 | 30,735 | 큰 장부 1001(거래 50,000, 라인 54,981, 삭제 977, 취소 524), 계좌 1(라인 11,247). 보통 장부 1(거래 3,000) |
| `perf_mix_200k` | `ledgers=1000`, `tx_per_ledger=3000`, `big_ledger_tx=200000`, `big_one_account=on` | 3,200,000 | 3,520,092 | 63,894 | 32,236 | 큰 장부 1001(거래 200,000, 라인 219,926, 삭제 4,028, 취소 2,025), 계좌 1(라인 200,000). 보통 장부 1(거래 3,000) |

- 거래 종류는 처음 여섯 DB 모두 지출 85%, 수입 5%, 이체 10% 안팎이다(84.9~85.0%, 4.9~5.2%, 9.9~10.1%).
- 300만 건을 넣는 데 102초 걸렸다(`VACUUM (ANALYZE)` 포함). 이 DB의 `transaction`은 인덱스와 합쳐 814MB, `transaction_line`은 623MB다.
- `perf_mix_50k`, `perf_mix_200k`의 장부 1~1,000은 거래와 라인의 내용 해시가 `perf_l1000_3m`과 같다. 큰 장부의 거래는 날짜 순서로 다른 장부의 거래 사이에 섞여 있다. 큰 장부를 뺀 기존 변수 조합 4가지(기본값, `one_account=on`, 장부 7개·3년, 장부 1,000개 3,000건)는 새 스크립트로 만든 내용 해시와 저장 순서 해시가 이전 스크립트와 같다.
- 큰 장부 DB는 각각 넣는 데 80초, 92초 걸렸다(장부 1,000개 300만 건은 새 설정에서 96초).
- 여덟 DB 모두 `docs/db/integrity-checks.sql`의 점검 쿼리가 0건이다(`flyway_schema_history`를 읽는 명세표 한 줄은 빼고 돌렸다).
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

### 추가 측정(여러 장부 DB 안의 큰 장부)의 방법

- 컨테이너 설정은 2장과 같다(스왑 없음, `/dev/shm` 256MB). 큰 장부 쿼리 4개는 `-v ledger_no=1001`, 보통 장부는 `-v ledger_no=1`, 월별 통계는 2026-10으로 쟀다. 10번 중 뒤 7번, 큰 장부 리터럴과 일반 계획은 두 회차, 보통 장부는 한 번이다.
- 일반 계획은 쿼리 파일에 `-v generic=on`을 주어 같은 문장을 `PREPARE`하고 `SET plan_cache_mode = force_generic_plan` 뒤 `EXPLAIN (ANALYZE, BUFFERS) EXECUTE`로 쟀다. 바인드 타입은 테스트의 SQL 로그에 찍힌 타입(UUID, DATE, VARCHAR, INTEGER)이다.
- 300만 건 DB의 보통 장부는 새 설정에서 리터럴과 일반 계획을 함께 다시 쟀다(앞의 여섯 DB 표는 그대로 두었다).
- 맥은 AC 전원이었다. 22:44~22:48에 잰 것은 덮개가 닫힌 DarkWake 상태, 일반 계획 2회차(23:31~23:33)는 깨어 있는 상태였다(`pmset -g log`). `caffeinate -dims`로 절전을 막았고 측정 구간에 절전 기록은 없다. 22:29과 00:08에 확인했을 때 다른 컨테이너는 없었다.
- 처음 한 번은 18:01:40에 맥이 덮개 닫힘 절전에 들어가 중단됐다. 그 결과는 전부 버리고 22:44부터 다시 쟀다.

| 회차 | 시각(KST) | 내용 | 맥 load average(1분) |
|---|---|---|---|
| 1회차 리터럴 | 22:44:08~22:45:05 | 큰 장부(5만, 20만) | 3.35 → 3.25 |
| 보통 장부 | 22:45:05~22:45:06 | 같은 DB의 장부 1 | 3.25 → 3.15 |
| 2회차 리터럴 | 22:45:06~22:46:10 | 큰 장부 | 3.15 → 3.37 |
| 1회차 일반 계획 | 22:46:10~22:47:54 | 큰 장부 | 3.37 → 2.20 |
| 비교 | 22:47:54~22:47:57 | 300만 건 DB 보통 장부 | 2.20 → 2.27 |
| 2회차 일반 계획 | 23:31:18~23:33:04 | 큰 장부 | 2.18 → 2.13 |

- 일반 계획 2회차는 1회차가 이전 시도의 값과 크게 달라 안정적인지 보려고 추가했다. 1회차와 2회차의 중앙값 차이는 최대 4.5%(계좌 하나 잔액 19.090 → 19.947)다. 버린 첫 시도에서 5만 건 장부의 휴지통 목록은 같은 계획과 같은 read 수로 중앙값 82.196ms였고, 이번 두 회차는 1,085.4ms와 1,092.5ms다. 무엇이 달랐는지 확인하지 못했다.

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

### 여러 장부 DB 안의 큰 장부 (추가 측정)

장부 1,000개에 큰 장부 하나를 더한 DB다. 큰 장부의 거래는 다른 장부의 거래 사이에 날짜 순서로 섞여 있다. 계획 칸은 조인 방식과, Seq Scan 노드가 있는 테이블이다("훑기 없음"은 Seq Scan 노드가 하나도 없다는 뜻이다). 큰 장부 리터럴은 두 회차의 계획 모양이 같다. 조인 예상/실제는 1회차 중앙값 실행의 값이다(`×`는 loops, 병렬이면 프로세스마다 한 루프).

#### 큰 장부 5만 건 (`perf_mix_50k`)

| 쿼리 | 큰 장부 1회차 최소 / 중앙 / 최대 | 큰 장부 2회차 최소 / 중앙 / 최대 | 보통 장부 최소 / 중앙 / 최대 | 큰 장부 버퍼 hit / read | 보통 장부 버퍼 | 큰 장부 계획 | 큰 장부 조인 예상 / 실제 |
|---|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 15.808 / 16.139 / 20.168 | 16.293 / 16.640 / 21.180 | 1.093 / 1.139 / 1.233 | 55,925 / 0 | 4,623 / 0 | 중첩 루프<br>훑기 없음 | 4,834 / 3,644 ×3 |
| 장부 전체 잔액 | 2,561.3 / 2,637.4 / 2,707.7 | 2,799.2 / 2,894.2 / 2,906.1 | 5.326 / 5.466 / 5.644 | 148,564~148,630 / 125,522~125,588 | 16,564 / 0 | 중첩 루프<br>`account` 훑기 | 1,444 / 53,326 |
| 월별 통계 | 0.819 / 0.861 / 0.966 | 0.702 / 0.711 / 0.772 | 0.058 / 0.063 / 0.074 | 3,185 / 0 | 197 / 0 | 중첩 루프<br>훑기 없음 | 487 / 373 |
| 휴지통 목록 | 140.7 / 148.7 / 155.5 | 218.4 / 236.2 / 292.9 | 1.096 / 1.130 / 1.173 | 1,990~1,998 / 51,956~51,964 | 3,271 / 0 | 중첩 루프 Left Join<br>훑기 없음 | 487 / 357 ×3 |

#### 큰 장부 20만 건 (`perf_mix_200k`)

| 쿼리 | 큰 장부 1회차 최소 / 중앙 / 최대 | 큰 장부 2회차 최소 / 중앙 / 최대 | 보통 장부 최소 / 중앙 / 최대 | 큰 장부 버퍼 hit / read | 보통 장부 버퍼 | 큰 장부 계획 | 큰 장부 조인 예상 / 실제 |
|---|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 298.4 / 307.6 / 327.2 | 295.6 / 306.4 / 316.1 | 1.138 / 1.172 / 1.209 | 50~58 / 114,280~114,288 | 4,623 / 0 | 병렬 해시 조인<br>`transaction` 훑기 | 80,408 / 64,649 ×3 |
| 장부 전체 잔액 | 1,814.5 / 1,876.0 / 1,910.7 | 2,581.0 / 2,633.0 / 2,701.2 | 5.531 / 6.163 / 7.865 | 749,647~749,710 / 195,385~195,448<br>temp read=888 written=891 | 16,564 / 0 | 중첩 루프<br>`account` 훑기 | 1,516 / 213,272 |
| 월별 통계 | 3.486 / 3.657 / 3.844 | 3.469 / 3.591 / 3.788 | 0.063 / 0.065 / 0.073 | 11,696 / 0 | 197 / 0 | 중첩 루프<br>훑기 없음 | 1,309 / 745 ×2 |
| 휴지통 목록 | 97.864 / 105.0 / 114.4 | 102.7 / 109.7 / 122.0 | 1.040 / 1.141 / 1.176 | 25,864~26,440 / 58,272~58,848 | 3,271 / 0 | 중첩 루프 Left Join<br>`transaction` 훑기 | 1,935 / 1,473 ×3 |

### 리터럴과 일반 계획 비교

같은 문장을 `PREPARE`한 뒤 일반 계획을 강제해 `EXECUTE`한 값이다. "계획 모양"은 1회차 중앙값 실행의 노드 구성(노드 이름, 테이블, 인덱스)을 비교한 것이다. 조인 예상 행 수는 일반 계획에서 크게 다르다.

#### 큰 장부 5만 건 (`perf_mix_50k`)

| 쿼리 | 리터럴 중앙 (1회차 / 2회차) | 일반 계획 중앙 (1회차 / 2회차) | 일반 계획 최소~최대 (두 회차) | 일반 계획 버퍼 hit / read (1회차) | 계획 모양 | 일반 계획 | 일반 계획 조인 예상 / 실제 |
|---|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 16.139 / 16.640 | 19.090 / 19.947 | 18.303~21.753 | 55,923 / 0 | **다르다** | 중첩 루프<br>훑기 없음 | 74 / 10,932 |
| 장부 전체 잔액 | 2,637.4 / 2,894.2 | 2,901.0 / 2,918.1 | 2,846.6~2,942.7 | 148,589~148,608 / 125,544~125,563 | 같다 | 중첩 루프<br>`account` 훑기 | 584 / 53,326 |
| 월별 통계 | 0.861 / 0.711 | 0.691 / 0.700 | 0.675~0.742 | 3,185 / 0 | **다르다** | 중첩 루프<br>훑기 없음 | 8 / 373 |
| 휴지통 목록 | 148.7 / 236.2 | 1,085.4 / 1,092.5 | 1,039.1~1,099.3 | 1,982~1,986 / 51,950~51,954 | **다르다** | 중첩 루프 Left Join<br>훑기 없음 | 68 / 1,071 |

#### 큰 장부 20만 건 (`perf_mix_200k`)

| 쿼리 | 리터럴 중앙 (1회차 / 2회차) | 일반 계획 중앙 (1회차 / 2회차) | 일반 계획 최소~최대 (두 회차) | 일반 계획 버퍼 hit / read (1회차) | 계획 모양 | 일반 계획 | 일반 계획 조인 예상 / 실제 |
|---|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 307.6 / 306.4 | 1,895.9 / 1,900.1 | 1,850.8~1,938.4 | 690,347~690,441 / 155,257~155,351 | **다르다** | 중첩 루프<br>훑기 없음 | 78 / 193,947 |
| 장부 전체 잔액 | 1,876.0 / 2,633.0 | 2,665.2 / 2,680.0 | 2,629.8~2,717.0 | 749,660~749,716 / 195,379~195,435<br>temp read=888 written=891 | 같다 | 중첩 루프<br>`account` 훑기 | 612 / 213,272 |
| 월별 통계 | 3.657 / 3.591 | 2.821 / 2.833 | 2.725~3.107 | 11,683 / 0 | **다르다** | 중첩 루프<br>훑기 없음 | 9 / 1,490 |
| 휴지통 목록 | 105.0 / 109.7 | 1,691.8 / 1,689.7 | 1,640.4~1,699.1 | 8,595~8,597 / 76,430~76,432 | **다르다** | 중첩 루프 Left Join<br>훑기 없음 | 73 / 4,418 |

#### 300만 건 DB의 보통 장부 (`perf_l1000_3m`, 장부 1)

이 표의 리터럴 값은 추가 측정 때 새 컨테이너 설정에서 다시 잰 값이다. 앞의 여섯 DB 표와 다른 때, 다른 설정이다.

| 쿼리 | 리터럴 최소 / 중앙 / 최대 | 일반 계획 최소 / 중앙 / 최대 | 리터럴 버퍼 | 일반 계획 버퍼 | 계획 모양 | 리터럴 계획 | 일반 계획 |
|---|---|---|---|---|---|---|---|
| 계좌 하나 잔액 | 1.170 / 1.218 / 1.329 | 1.157 / 1.184 / 1.267 | 4,623 / 0 | 4,623 / 0 | 같다 | 중첩 루프<br>훑기 없음<br>조인 416 / 899 | 중첩 루프<br>훑기 없음<br>조인 73 / 899 |
| 장부 전체 잔액 | 5.204 / 5.374 / 5.504 | 5.390 / 5.516 / 5.608 | 16,563 / 0 | 16,563 / 0 | 같다 | 중첩 루프<br>`account` 훑기<br>조인 995 / 3,192 | 중첩 루프<br>`account` 훑기<br>조인 574 / 3,192 |
| 월별 통계 | 0.060 / 0.064 / 0.076 | 0.058 / 0.068 / 0.076 | 197 / 0 | 197 / 0 | **다르다** | 중첩 루프<br>훑기 없음<br>조인 28 / 23 | 중첩 루프<br>훑기 없음<br>조인 8 / 23 |
| 휴지통 목록 | 1.076 / 1.139 / 1.233 | 1.031 / 1.121 / 1.206 | 3,270 / 0 | 3,270 / 0 | 같다 | 중첩 루프 Left Join<br>훑기 없음<br>조인 70 / 69 | 중첩 루프 Left Join<br>훑기 없음<br>조인 72 / 69 |
| 카테고리 사용 여부(거래 없음) | 79.454 / 80.030 / 80.403 | 41.543 / 44.584 / 45.972 | 3,101~3,293 / 39,400~39,592 | 3,613~4,189 / 38,504~39,080 | **다르다** | 조인 없음<br>`transaction_line` 훑기 | 조인 없음<br>`transaction_line` 훑기 |

다른 쿼리의 일반 계획에서 바뀐 노드는 다음과 같다(계획 원문은 10장에 있다).

- 5만 건 계좌 하나 잔액: 리터럴은 작업자 2개의 병렬 중첩 루프, 일반 계획은 병렬이 아닌 중첩 루프. 쓰인 인덱스는 같다.
- 5만 건 월별 통계: `transaction`을 읽는 노드가 리터럴은 Bitmap Heap Scan, 일반 계획은 Index Scan.
- 5만 건 휴지통 목록: 리터럴은 작업자 2개의 병렬 Bitmap Heap Scan, 일반 계획은 병렬이 아닌 Bitmap Heap Scan. 시간은 리터럴 148.7 / 236.2ms, 일반 계획 1,085.4 / 1,092.5ms(1회차 / 2회차).
- 20만 건 계좌 하나 잔액: 리터럴은 `transaction` 병렬 전체 훑기와 병렬 해시 조인(JIT 있음), 일반 계획은 `transaction_pkey`를 쓰는 중첩 루프. 시간은 리터럴 307.6 / 306.4ms, 일반 계획 1,895.9 / 1,900.1ms. 버퍼는 리터럴 hit 50~58, read 114,280~114,288, 일반 계획 hit 690,347~690,441, read 155,257~155,351.
- 20만 건 월별 통계: 리터럴은 병렬(작업자 1개)이고 `transaction`을 Bitmap Heap Scan으로 읽는다. 일반 계획은 병렬이 아니고 Index Scan으로 읽는다. 시간은 3.657 / 3.591ms에서 2.821 / 2.833ms.
- 20만 건 휴지통 목록: 리터럴은 `transaction` 병렬 전체 훑기(JIT 있음), 일반 계획은 병렬이 아닌 Bitmap Heap Scan(`Rows Removed by Index Recheck` 1,444,788). 시간은 105.0 / 109.7ms에서 1,691.8 / 1,689.7ms.
- 20만 건 장부 전체 잔액: 계획 모양이 같다. 조인 결과 예상은 1,516행(리터럴)과 612행(일반 계획), 실제 213,272행.
- 300만 건 DB 보통 장부: 월별 통계(Bitmap Heap Scan이 Index Scan으로)와 카테고리 사용 여부(Seq Scan이 작업자 2개의 Parallel Seq Scan으로)만 모양이 다르다. 카테고리 사용 여부(거래 없음)는 80.030ms에서 44.584ms다.

## 5. 측정 중 한계였던 자원

**모른다.** 실행하는 동안의 CPU, 디스크 사용률을 따로 재지 않았다. 확인한 사실만 적는다.

- 처음 여섯 DB의 1회차에서 버퍼 read가 0이 아니었던 것은 300만 건 DB의 카테고리 사용 여부 두 가지뿐이다.
- 추가 측정의 큰 장부에서는 세 번 데운 뒤에도 read가 0이 아닌 것이 있다: 장부 전체 잔액(5만, 20만), 휴지통 목록(5만, 20만), 20만 건 계좌 하나 잔액. 월별 통계와 5만 건 계좌 하나 잔액, 보통 장부의 네 쿼리는 read가 0이다. `track_io_timing`이 꺼져 있어 read가 OS 캐시에서 왔는지 디스크에서 왔는지는 모른다.
- 300만 건을 넣은 뒤 컨테이너 메모리는 473.3MiB / 1GiB, 1회차를 잰 뒤는 479.9MiB / 1GiB였다(`docker stats` 한 번씩). 추가 측정이 끝난 뒤에는 298.6MiB / 1GiB였다. OOM으로 죽은 적은 없다(스왑을 막은 뒤에도).

## 6. 왜 이 수치인지

perf가 실행 계획 원문을 읽고 쓴 해석이다. "확인"은 계획 원문에 있는 사실이고 "추정"은 그 사실에서 끌어낸 설명이다. `track_io_timing`이 꺼져 있어 시간이 어디서 쓰였는지는 직접 재지 못했다.

### 6.1 큰 장부의 장부 전체 잔액이 초 단위인 이유

5만 건 장부는 중앙값 2.6~2.9초, 20만 건 장부는 1.9~2.6초다(1회차와 2회차).

- 확인: 계획은 계좌 10개에서 시작해 계좌마다 `ix_transaction_line_account`로 라인을 찾고, 라인 하나마다 `transaction_pkey`로 거래를 찾는 중첩 루프다. 거래 찾기가 54,981번 돌았다(5만 건 장부).
- 확인: 계획기는 계좌 하나에 라인 456개를 예상했는데 실제는 5,498개였다(12배). 조인 결과는 1,444행을 예상했는데 실제는 53,326행이었다(37배). 계좌 id가 실행 중에 정해지는 조인이라 계획기는 전체 계좌의 평균으로 예상한다. 큰 장부는 평균보다 훨씬 크다.
- 확인: 큰 장부의 라인 54,981개를 읽는 데 힙 블록을 54,058번 찾았다(`Heap Blocks: exact=54058`, 계좌 10번의 합이라 다른 계좌의 같은 블록은 겹쳐 센다). 거의 블록 하나에 라인 하나다. 여러 장부의 거래가 날짜 순서로 섞여 저장됐기 때문이다. 운영에서도 여러 사용자가 번갈아 입력하므로 같은 모양이 된다(추정).
- 확인: 한 번 실행에 버퍼 274,152개를 찾았고 그중 125,522개가 `shared_buffers`에 없어 읽어 왔다. 세 번 데운 뒤에도 실행마다 125,522번 안팎(두 회차 125,522~125,590번)을 `shared_buffers` 밖에서 읽었다.
- 추정: 이 쿼리가 건드리는 서로 다른 블록이 `shared_buffers`(256MB, 32,768블록)에 다 들어가지 않기 때문이다. 서로 다른 블록 수는 세지 않았다. `transaction_line`만 42,693블록이다(300만 건 DB에서 전체 훑기가 찾은 블록 수. 이 DB의 블록 수는 재지 않았다).
- 추정: 시간의 대부분은 이 읽기다. 같은 DB에서 5만 건 장부의 계좌 하나 잔액은 같은 중첩 루프로 버퍼 55,925개를 찾았지만 read가 0이었고 16ms였다. 이 계획은 병렬(작업자 2개)이라 시간을 그대로 견줄 수는 없고, read가 0이라는 점만 비교한다. 장부 전체 잔액은 read가 125,522개이고 2,637ms다. 장부 전체 잔액의 실행 시간을 read 수로 나누면 약 20마이크로초다(추정, 읽기 시간은 직접 재지 않았다).
- 확인: 20만 건 장부도 같은 계획이고 조인 예상 1,516행에 실제 213,272행이다.

### 6.2 장부 1개짜리 DB와 보통 장부가 빠른 이유

- 확인: 장부 1개짜리 DB는 가장 큰 것도 테이블 전체가 `shared_buffers`에 들어가 read가 0이었다. 쿼리가 테이블의 거의 모든 행을 읽으므로 전체 훑기가 옳은 계획이다. 그래서 이 DB들의 수치는 운영에서 나올 계획의 수치가 아니다.
- 확인: 여러 장부 DB의 보통 장부(3,000건)는 장부 전체 잔액이 5~6ms이고 버퍼 16,564개를 모두 캐시에서 찾았다.
- 추정: 보통 장부도 캐시가 식은 상태(한동안 열지 않은 장부)에서는 버퍼 1만 6천여 개를 읽어 와야 한다. 6.1에서 나눈 값(약 20마이크로초)을 그대로 쓰면 약 330ms로 상한 200ms를 넘을 수 있다(2차 측정 E2: PostgreSQL만 재시작한 경우 33.6~79.1ms로 이 추정은 틀렸다. OS 캐시까지 비운 경우 231~266ms. [2차 문서](2026-11-25-balance-diagnosis.md) 6.3). 이번에는 데운 뒤에만 쟀으므로 재지 않은 값이다. 다음 측정에서 잰다.

### 6.3 일반 계획에서 더 느려진 쿼리

- 확인: 큰 장부에서 일반 계획은 계좌 하나 잔액(20만: 307.6ms → 1,895.9ms)과 휴지통 목록(5만: 148.7ms → 1,085.4ms, 20만: 105.0ms → 1,691.8ms)이 리터럴보다 느렸다. 값을 모르는 채 평균 장부에 맞춘 계획을 큰 장부에 썼기 때문이다(계획 모양이 다르다).
- 한계: 이 값은 일반 계획을 강제한 것이다. 실제 앱에서 PostgreSQL이 일반 계획을 고를지, JDBC 드라이버가 서버 쪽 준비된 문장을 쓰는지는 재지 않았다. 최악의 경우로 읽는다.
- 휴지통 목록의 일반 계획 값은 버린 첫 시도(82ms)와 이번(1,085ms)이 같은 계획, 같은 read 수인데 13배 다르다. 원인은 확인하지 못했다. read가 OS 캐시에서 왔는지 디스크에서 왔는지에 따라 달라졌을 수 있다(추정).

### 6.4 카테고리 사용 여부(거래 없음) 120ms

- 확인: `transaction_line.category_id`에 인덱스가 없어 라인 테이블 전체를 읽는다. 전체 사용자의 라인 수에 비례한다. 이슈 #67의 인덱스가 들어가면 인덱스 조회 한 번이 된다(효과는 재지 않음).

### 6.5 이 결과가 뜻하는 것

- 초기(가입자 10명 이하): 문제가 없다(추정). DB 전체가 `shared_buffers`에 들어가는 크기이고, 그 조건의 측정값(장부 1개짜리 DB)은 모두 상한 안이다.
- 공개 뒤(DB가 `shared_buffers`보다 훨씬 클 때): 지금 쿼리와 인덱스로는 큰 장부의 장부 전체 잔액이 상한 200ms를 10배 넘게 넘는다(확인, 로컬, 최댓값 기준). 홈 화면을 열 때마다 불리는 쿼리다.
- 지금 수치는 맥 로컬의 값이다. 운영 서버의 디스크와 CPU에서는 달라진다. 배수가 아니라 "캐시에 없는 블록을 라인 수만큼 읽는 구조"(추정, 6.1)라는 점이 결론이다.

### 6.6 다음에 잴 것 (개선안이 아니라 가설 확인)

1. 캐시가 식은 상태의 첫 실행(보통 장부와 큰 장부).
2. `track_io_timing`을 켜고 읽기에 쓴 시간을 직접 잰다.
3. `shared_buffers`를 DB 크기보다 크게 했을 때(같은 계획에서 읽기가 사라지면 얼마인지). 운영 컨테이너 한도 초안(DB 1GB)을 정하는 근거가 된다.
4. 이슈 #58로 라인에 `ledger_id`가 들어간 뒤, 장부의 라인을 한 곳에 모아 읽는 인덱스를 썼을 때. 인덱스 모양은 dba가 정한다.
5. 다시 잴 때는 같은 방법, 같은 데이터(`perf_mix_50k`, `perf_mix_200k`)로 잰다.

개선안(인덱스, 쿼리 변경, 잔액 스냅샷)은 위 측정 뒤에 증거, 기대 효과, 비용과 함께 dba에게 낸다. 잔액 스냅샷을 넣지 않는다는 dba 결정은 지금 그대로다.

## 7. 목표 대비 판정

기준은 [docs/perf/README.md](../README.md) 2장의 쿼리 상한이다. 시간은 두 회차를 합친 14번의 최댓값으로 비교했다. "전체 훑기 없음"은 여러 장부가 섞인 DB에서만 판정한다. 장부 1개짜리 DB는 값만 적고 판정하지 않는다(perf 검수 의견, dba 동의).

### 여러 장부가 섞인 DB

| 대상 | 상한 | 300만 건 DB의 보통 장부 | 큰 장부 5만 건 | 큰 장부 20만 건 | 시간 | `transaction`·`transaction_line` 전체 훑기 없음 |
|---|---|---|---|---|---|---|
| 거래 목록 50건 | 50ms | 쿼리 없음 | 쿼리 없음 | 쿼리 없음 | 판정 못 함 | 판정 못 함 |
| 월별 통계 | 100ms | 0.151ms | 0.966ms | 3.844ms | 상한 안 | 없음(300만 건, 5만, 20만) |
| 장부 전체 잔액 | 200ms | 11.103ms | **2,906.1ms** | **2,701.2ms** | 300만 건 보통 장부는 상한 안. **큰 장부 두 개는 상한을 넘었다** | 없음(300만 건, 5만, 20만). `account`는 훑는다 |

- 큰 장부의 시간은 리터럴 두 회차 14번의 최댓값이다. 일반 계획의 최댓값은 장부 전체 잔액 2,942.7ms(5만), 2,717.0ms(20만), 월별 통계 0.742ms(5만), 3.107ms(20만)다.
- 같은 DB의 보통 장부(거래 3,000건)는 장부 전체 잔액 최댓값이 5.644ms(`perf_mix_50k`), 7.865ms(`perf_mix_200k`), 월별 통계는 0.074ms, 0.073ms다.
- 300만 건 DB의 값은 처음 측정(컨테이너 설정이 다름)이다.

### 처음 여섯 DB(장부 1개짜리와 300만 건)

| 대상 | 상한 | 1만 2천 건 | 5만 건 | 300만 건 | 시간 | `transaction`·`transaction_line` 전체 훑기 없음 |
|---|---|---|---|---|---|---|
| 거래 목록 50건 | 50ms | 쿼리 없음 | 쿼리 없음 | 쿼리 없음 | 판정 못 함 | 판정 못 함 |
| 월별 통계 | 100ms | 1.230ms | 4.435ms | 0.151ms | 상한 안 | 1만 2천 건, 5만 건: 있음(`transaction_line`, 판정하지 않음). 300만 건: 없음 |
| 장부 전체 잔액 | 200ms | 6.688ms | 23.725ms | 11.103ms | 상한 안 | 1만 2천 건, 5만 건: 있음(`transaction`, `transaction_line`, 판정하지 않음). 300만 건: 없음(`account`만 있음) |

계좌 하나 라인 1만 / 5만 / 20만 DB(잔액 기준선용)의 같은 쿼리는 다음과 같다.

| 대상 | 상한 | 라인 1만 | 라인 5만 | 라인 20만 | 시간 | 전체 훑기 |
|---|---|---|---|---|---|---|
| 월별 통계 | 100ms | 0.910ms | 5.587ms | 14.659ms | 상한 안 | 세 크기 모두 있음(`transaction_line`, 판정하지 않음) |
| 장부 전체 잔액 | 200ms | 4.200ms | 29.956ms | 85.092ms | 상한 안 | 세 크기 모두 있음(`transaction`, `transaction_line`, 판정하지 않음) |
| 계좌 하나 잔액 | 없음 | 3.043ms | 26.056ms | 64.740ms | 상한 없음 | 세 크기 모두 있음(`transaction`, `transaction_line`) |

휴지통 목록, 카테고리 사용 여부, 계좌 하나 잔액은 상한이 정해져 있지 않아 값만 적었다. 큰 장부의 값은 계좌 하나 잔액 16.139 / 16.640ms(5만), 307.6 / 306.4ms(20만), 휴지통 목록 148.7 / 236.2ms(5만), 105.0 / 109.7ms(20만)다(리터럴 중앙값, 1회차 / 2회차).

## 8. 확인과 추정

- 확인: 이 문서의 시간, 행 수, 버퍼, 인덱스, 전체 훑기는 모두 직접 잰 값이다.
- 추정: 데이터 크기(장부당 1만 2천 건, 장부 1,000개 300만 건, 큰 장부 5만 건과 20만 건)와 거래 종류 비율은 실제 사용에서 얻은 것이 아니라 정해 둔 가정이다.

## 9. 못 잰 것

- 거래 목록 50건: 쿼리가 아직 없다.
- API 지연, 화면 지표, 동시 요청, 운영과 같은 사양: 이번 범위가 아니다.
- 처음 여섯 DB 가운데 300만 건 DB의 보통 장부를 뺀 것의 일반 계획, 앱이 실제로 언제 일반 계획을 고르는지, 캐시가 빈 상태의 첫 실행.
- 큰 장부 DB에서 카테고리 사용 여부는 재지 않았다(요청한 네 쿼리가 아니다).
- 지난 날짜를 늦게 넣은 거래, 갱신으로 생기는 죽은 행, 30일 자동 삭제 뒤의 휴지통, `change_log`를 채운 상태.
- 잔액·통계 메서드가 함께 보내는 다른 SQL(권한 확인, 계좌 조회, 계좌 목록).
- pg_stat_statements는 켜지고 집계되는 것까지 확인했다. 이 문서의 수치에는 쓰지 않았다.

## 10. 대표 실행 계획 원문

1회차 7번 가운데 중앙값인 실행의 원문이다(추가 측정은 큰 장부의 리터럴과 일반 계획, 300만 건 DB 보통 장부의 일반 계획).

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

<details>
<summary>큰 장부 5만 건 큰 장부, 리터럴 (<code>perf_mix_50k</code>)</summary>

계좌 하나 잔액

```text
Finalize Aggregate  (cost=62791.22..62791.23 rows=1 width=32) (actual time=13.444..16.126 rows=1 loops=1)
  Buffers: shared hit=55925
  ->  Gather  (cost=62791.00..62791.21 rows=2 width=32) (actual time=13.358..16.123 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=55925
        ->  Partial Aggregate  (cost=61791.00..61791.01 rows=1 width=32) (actual time=12.468..12.469 rows=1 loops=3)
              Buffers: shared hit=55925
              ->  Nested Loop  (cost=149.60..61778.91 rows=4834 width=8) (actual time=0.980..12.360 rows=3644 loops=3)
                    Buffers: shared hit=55925
                    ->  Parallel Bitmap Heap Scan on transaction_line tl1_0  (cost=149.17..26748.32 rows=4986 width=24) (actual time=0.969..4.499 rows=3749 loops=3)
                          Recheck Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                          Heap Blocks: exact=4775
                          Buffers: shared hit=10935
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..146.18 rows=11966 width=0) (actual time=1.011..1.011 rows=11247 loops=1)
                                Index Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                                Buffers: shared hit=11
                    ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..7.03 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=11247)
                          Index Cond: (id = tl1_0.transaction_id)
                          Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 0
                          Buffers: shared hit=44990
Planning:
  Buffers: shared hit=16
Planning Time: 0.098 ms
Execution Time: 16.139 ms
```

장부 전체 잔액

```text
GroupAggregate  (cost=19009.93..19038.81 rows=1444 width=48) (actual time=2634.575..2637.270 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=148630 read=125522
  ->  Sort  (cost=19009.93..19013.54 rows=1444 width=24) (actual time=2634.353..2635.436 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=148630 read=125522
        ->  Nested Loop  (cost=8.39..18934.15 rows=1444 width=24) (actual time=1.839..2620.959 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=148630 read=125522
              ->  Nested Loop  (cost=7.96..16435.14 rows=4467 width=44) (actual time=1.746..789.278 rows=54981 loops=1)
                    Buffers: shared hit=4365 read=49863
                    ->  Seq Scan on account a1_0  (cost=0.00..194.88 rows=10 width=20) (actual time=0.324..0.337 rows=10 loops=1)
                          Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Rows Removed by Filter: 7500
                          Buffers: shared hit=1 read=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.96..1619.47 rows=456 width=40) (actual time=0.782..77.903 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4364 read=49763
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.85 rows=456 width=0) (actual time=0.421..0.421 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=10 read=59
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.033..0.033 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=144265 read=75659
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 0.669 ms
Execution Time: 2637.441 ms
```

월별 통계

```text
GroupAggregate  (cost=5630.40..5642.58 rows=485 width=55) (actual time=0.822..0.851 rows=28 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=3185
  ->  Sort  (cost=5630.40..5631.62 rows=487 width=31) (actual time=0.818..0.827 rows=373 loops=1)
        Sort Key: tl1_0.category_id, c1_0.kind
        Sort Method: quicksort  Memory: 42kB
        Buffers: shared hit=3185
        ->  Nested Loop  (cost=22.97..5608.66 rows=487 width=31) (actual time=0.045..0.783 rows=373 loops=1)
              Buffers: shared hit=3185
              ->  Nested Loop  (cost=22.68..5459.80 rows=487 width=24) (actual time=0.040..0.601 rows=445 loops=1)
                    Buffers: shared hit=2066
                    ->  Bitmap Heap Scan on transaction t1_0  (cost=22.25..1741.13 rows=443 width=16) (actual time=0.038..0.162 rows=409 loops=1)
                          Recheck Cond: ((ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 16
                          Heap Blocks: exact=425
                          Buffers: shared hit=428
                          ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..22.14 rows=457 width=0) (actual time=0.017..0.017 rows=425 loops=1)
                                Index Cond: ((ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                                Buffers: shared hit=3
                    ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.38 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=409)
                          Index Cond: (transaction_id = t1_0.id)
                          Buffers: shared hit=1638
              ->  Index Scan using category_pkey on category c1_0  (cost=0.29..0.31 rows=1 width=23) (actual time=0.000..0.000 rows=1 loops=445)
                    Index Cond: (id = tl1_0.category_id)
                    Buffers: shared hit=1119
Planning:
  Buffers: shared hit=22
Planning Time: 0.100 ms
Execution Time: 0.861 ms
```

휴지통 목록

```text
Gather Merge  (cost=71730.07..71843.72 rows=974 width=242) (actual time=146.347..148.695 rows=1071 loops=1)
  Workers Planned: 2
  Workers Launched: 2
  Buffers: shared hit=1990 read=51964
  ->  Sort  (cost=70730.05..70731.27 rows=487 width=242) (actual time=144.614..144.632 rows=357 loops=3)
        Sort Key: t1_0.deleted_at DESC
        Sort Method: quicksort  Memory: 121kB
        Buffers: shared hit=1990 read=51964
        Worker 0:  Sort Method: quicksort  Memory: 105kB
        Worker 1:  Sort Method: quicksort  Memory: 103kB
        ->  Nested Loop Left Join  (cost=2073.08..70708.31 rows=487 width=242) (actual time=10.291..144.326 rows=357 loops=3)
              Buffers: shared hit=1979 read=51959
              ->  Parallel Bitmap Heap Scan on transaction t1_0  (cost=2072.65..67034.99 rows=443 width=162) (actual time=10.170..113.652 rows=326 loops=3)
                    Recheck Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                    Filter: (deleted_at IS NOT NULL)
                    Rows Removed by Filter: 16341
                    Heap Blocks: exact=18980
                    Buffers: shared read=50027
                    ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..2072.38 rows=52260 width=0) (actual time=7.968..7.968 rows=50000 loops=1)
                          Index Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Buffers: shared read=113
              ->  Index Scan using ix_transaction_line_transaction on transaction_line l1_0  (cost=0.43..8.28 rows=1 width=80) (actual time=0.093..0.093 rows=1 loops=977)
                    Index Cond: (transaction_id = t1_0.id)
                    Buffers: shared hit=1979 read=1932
Planning:
  Buffers: shared hit=6 read=10
Planning Time: 0.372 ms
Execution Time: 148.731 ms
```

</details>

<details>
<summary>큰 장부 5만 건 큰 장부, 일반 계획 (<code>perf_mix_50k</code>)</summary>

계좌 하나 잔액

```text
Aggregate  (cost=5516.89..5516.90 rows=1 width=32) (actual time=18.996..18.996 rows=1 loops=1)
  Buffers: shared hit=55923
  ->  Nested Loop  (cost=8.39..5516.70 rows=74 width=8) (actual time=1.276..18.688 rows=10932 loops=1)
        Buffers: shared hit=55923
        ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.96..1690.36 rows=456 width=24) (actual time=1.272..5.066 rows=11247 loops=1)
              Recheck Cond: (account_id = $1)
              Heap Blocks: exact=10924
              Buffers: shared hit=10935
              ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.85 rows=456 width=0) (actual time=0.572..0.572 rows=11247 loops=1)
                    Index Cond: (account_id = $1)
                    Buffers: shared hit=11
        ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..8.39 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=11247)
              Index Cond: (id = tl1_0.transaction_id)
              Filter: ((deleted_at IS NULL) AND (occurred_on >= $2) AND ((status)::text <> ($3)::text))
              Rows Removed by Filter: 0
              Buffers: shared hit=44988
Planning:
  Buffers: shared hit=16
Planning Time: 0.068 ms
Execution Time: 19.090 ms
```

장부 전체 잔액

```text
GroupAggregate  (cost=15326.92..15338.60 rows=584 width=48) (actual time=2898.098..2900.843 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=148600 read=125552
  ->  Sort  (cost=15326.92..15328.38 rows=584 width=24) (actual time=2897.852..2898.956 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=148600 read=125552
        ->  Nested Loop  (cost=8.39..15300.09 rows=584 width=24) (actual time=1.822..2883.281 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=148600 read=125552
              ->  Nested Loop  (cost=7.96..13300.66 rows=3574 width=44) (actual time=1.716..723.724 rows=54981 loops=1)
                    Buffers: shared hit=4374 read=49854
                    ->  Seq Scan on account a1_0  (cost=0.00..194.88 rows=8 width=20) (actual time=0.334..0.347 rows=10 loops=1)
                          Filter: (ledger_id = $1)
                          Rows Removed by Filter: 7500
                          Buffers: shared hit=1 read=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.96..1633.66 rows=456 width=40) (actual time=0.740..71.406 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4373 read=49754
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.85 rows=456 width=0) (actual time=0.400..0.400 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=10 read=59
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.039..0.039 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> ($2)::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=144226 read=75698
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 0.701 ms
Execution Time: 2901.004 ms
```

월별 통계

```text
GroupAggregate  (cost=126.57..126.77 rows=8 width=55) (actual time=0.660..0.686 rows=28 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=3185
  ->  Sort  (cost=126.57..126.59 rows=8 width=31) (actual time=0.658..0.665 rows=373 loops=1)
        Sort Key: tl1_0.category_id, c1_0.kind
        Sort Method: quicksort  Memory: 42kB
        Buffers: shared hit=3185
        ->  Nested Loop  (cost=1.15..126.45 rows=8 width=31) (actual time=0.016..0.629 rows=373 loops=1)
              Buffers: shared hit=3185
              ->  Nested Loop  (cost=0.86..124.01 rows=8 width=24) (actual time=0.012..0.455 rows=445 loops=1)
                    Buffers: shared hit=2066
                    ->  Index Scan using ix_transaction_ledger_occurred_on on transaction t1_0  (cost=0.43..64.80 rows=7 width=16) (actual time=0.004..0.088 rows=409 loops=1)
                          Index Cond: ((ledger_id = $1) AND (occurred_on >= $2) AND (occurred_on <= $3))
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> ($4)::text))
                          Rows Removed by Filter: 16
                          Buffers: shared hit=428
                    ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.45 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=409)
                          Index Cond: (transaction_id = t1_0.id)
                          Buffers: shared hit=1638
              ->  Index Scan using category_pkey on category c1_0  (cost=0.29..0.31 rows=1 width=23) (actual time=0.000..0.000 rows=1 loops=445)
                    Index Cond: (id = tl1_0.category_id)
                    Buffers: shared hit=1119
Planning:
  Buffers: shared hit=22
Planning Time: 0.062 ms
Execution Time: 0.691 ms
```

휴지통 목록

```text
Sort  (cost=10692.87..10693.04 rows=68 width=242) (actual time=1085.047..1085.112 rows=1071 loops=1)
  Sort Key: t1_0.deleted_at DESC
  Sort Method: quicksort  Memory: 304kB
  Buffers: shared hit=1982 read=51954
  ->  Nested Loop Left Join  (cost=123.73..10690.80 rows=68 width=242) (actual time=9.916..1084.547 rows=1071 loops=1)
        Buffers: shared hit=1982 read=51954
        ->  Bitmap Heap Scan on transaction t1_0  (cost=123.30..10166.44 rows=62 width=162) (actual time=9.813..1015.905 rows=977 loops=1)
              Recheck Cond: (ledger_id = $1)
              Filter: (deleted_at IS NOT NULL)
              Rows Removed by Filter: 49023
              Heap Blocks: exact=49914
              Buffers: shared read=50027
              ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..123.28 rows=3047 width=0) (actual time=6.242..6.242 rows=50000 loops=1)
                    Index Cond: (ledger_id = $1)
                    Buffers: shared read=113
        ->  Index Scan using ix_transaction_line_transaction on transaction_line l1_0  (cost=0.43..8.45 rows=1 width=80) (actual time=0.069..0.070 rows=1 loops=977)
              Index Cond: (transaction_id = t1_0.id)
              Buffers: shared hit=1982 read=1927
Planning:
  Buffers: shared hit=6 read=10
Planning Time: 0.353 ms
Execution Time: 1085.355 ms
```

</details>

<details>
<summary>큰 장부 20만 건 큰 장부, 리터럴 (<code>perf_mix_200k</code>)</summary>

계좌 하나 잔액

```text
Finalize Aggregate  (cost=145033.70..145033.71 rows=1 width=32) (actual time=304.288..307.381 rows=1 loops=1)
  Buffers: shared hit=58 read=114280
  ->  Gather  (cost=145033.48..145033.69 rows=2 width=32) (actual time=303.742..307.370 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=58 read=114280
        ->  Partial Aggregate  (cost=144033.48..144033.49 rows=1 width=32) (actual time=297.580..297.582 rows=1 loops=3)
              Buffers: shared hit=58 read=114280
              ->  Parallel Hash Join  (cost=50067.55..143832.46 rows=80408 width=8) (actual time=92.708..295.763 rows=64649 loops=3)
                    Hash Cond: (t1_0.id = tl1_0.transaction_id)
                    Buffers: shared hit=58 read=114280
                    ->  Parallel Seq Scan on transaction t1_0  (cost=0.00..88578.71 rows=1293644 width=16) (actual time=0.054..100.387 rows=1034623 loops=3)
                          Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 32043
                          Buffers: shared read=68580
                    ->  Parallel Hash  (cost=49031.67..49031.67 rows=82870 width=24) (actual time=92.374..92.375 rows=66667 loops=3)
                          Buckets: 262144  Batches: 1  Memory Usage: 13056kB
                          Buffers: shared read=45698
                          ->  Parallel Bitmap Heap Scan on transaction_line tl1_0  (cost=2457.80..49031.67 rows=82870 width=24) (actual time=11.303..83.961 rows=66667 loops=3)
                                Recheck Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                                Heap Blocks: exact=17710
                                Buffers: shared read=45698
                                ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..2408.08 rows=198887 width=0) (actual time=10.726..10.726 rows=200000 loops=1)
                                      Index Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                                      Buffers: shared read=160
Planning:
  Buffers: shared hit=2 read=14
Planning Time: 0.542 ms
JIT:
  Functions: 50
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 1.080 ms (Deform 0.337 ms), Inlining 0.000 ms, Optimization 0.501 ms, Emission 8.403 ms, Total 9.984 ms
Execution Time: 307.630 ms
```

장부 전체 잔액

```text
GroupAggregate  (cost=19921.16..19951.48 rows=1516 width=48) (actual time=1861.275..1875.599 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=749647 read=195448, temp read=888 written=891
  ->  Sort  (cost=19921.16..19924.95 rows=1516 width=24) (actual time=1861.116..1868.289 rows=213272 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: external merge  Disk: 7104kB
        Buffers: shared hit=749647 read=195448, temp read=888 written=891
        ->  Nested Loop  (cost=8.56..19841.07 rows=1516 width=24) (actual time=11.684..1837.941 rows=213272 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=749647 read=195448
              ->  Nested Loop  (cost=8.13..17219.34 rows=4687 width=44) (actual time=11.679..522.470 rows=219926 loops=1)
                    Buffers: shared hit=3365 read=62026
                    ->  Seq Scan on account a1_0  (cost=0.00..194.88 rows=10 width=20) (actual time=0.322..0.333 rows=10 loops=1)
                          Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Rows Removed by Filter: 7500
                          Buffers: shared hit=1 read=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=8.13..1697.67 rows=478 width=40) (actual time=1.428..50.503 rows=21993 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=65094
                          Buffers: shared hit=3364 read=61926
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..8.02 rows=478 width=0) (actual time=0.984..0.984 rows=21993 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=11 read=185
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.006..0.006 rows=1 loops=219926)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=746282 read=133422
Planning:
  Buffers: shared hit=14 read=16
Planning Time: 0.640 ms
Execution Time: 1875.978 ms
```

월별 통계

```text
Finalize GroupAggregate  (cost=18439.04..18662.23 rows=2215 width=55) (actual time=2.822..3.646 rows=29 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=11696
  ->  Gather Merge  (cost=18439.04..18615.75 rows=1309 width=55) (actual time=2.816..3.634 rows=57 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=11696
        ->  Partial GroupAggregate  (cost=17439.03..17468.48 rows=1309 width=55) (actual time=2.152..2.211 rows=28 loops=2)
              Group Key: tl1_0.category_id, c1_0.kind
              Buffers: shared hit=11696
              ->  Sort  (cost=17439.03..17442.30 rows=1309 width=31) (actual time=2.148..2.169 rows=745 loops=2)
                    Sort Key: tl1_0.category_id, c1_0.kind
                    Sort Method: quicksort  Memory: 99kB
                    Buffers: shared hit=11696
                    Worker 0:  Sort Method: quicksort  Memory: 44kB
                    ->  Nested Loop  (cost=95.72..17371.26 rows=1309 width=31) (actual time=0.110..2.073 rows=745 loops=2)
                          Buffers: shared hit=11681
                          ->  Nested Loop  (cost=95.43..16971.19 rows=1309 width=24) (actual time=0.106..1.607 rows=910 loops=2)
                                Buffers: shared hit=7210
                                ->  Parallel Bitmap Heap Scan on transaction t1_0  (cost=95.00..7269.12 rows=1190 width=16) (actual time=0.101..0.374 rows=828 loops=2)
                                      Recheck Cond: ((ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                                      Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                                      Rows Removed by Filter: 21
                                      Heap Blocks: exact=419
                                      Buffers: shared hit=588
                                      ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..94.49 rows=2085 width=0) (actual time=0.160..0.160 rows=1697 loops=1)
                                            Index Cond: ((ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid) AND (occurred_on >= '2026-10-01'::date) AND (occurred_on <= '2026-10-31'::date))
                                            Buffers: shared hit=5
                                ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.14 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=1655)
                                      Index Cond: (transaction_id = t1_0.id)
                                      Buffers: shared hit=6622
                          ->  Index Scan using category_pkey on category c1_0  (cost=0.29..0.31 rows=1 width=23) (actual time=0.000..0.000 rows=1 loops=1820)
                                Index Cond: (id = tl1_0.category_id)
                                Buffers: shared hit=4471
Planning:
  Buffers: shared hit=22
Planning Time: 0.113 ms
Execution Time: 3.657 ms
```

휴지통 목록

```text
Gather Merge  (cost=100154.51..100606.04 rows=3870 width=242) (actual time=100.650..104.718 rows=4418 loops=1)
  Workers Planned: 2
  Workers Launched: 2
  Buffers: shared hit=26152 read=58560
  ->  Sort  (cost=99154.48..99159.32 rows=1935 width=242) (actual time=94.568..94.623 rows=1473 loops=3)
        Sort Key: t1_0.deleted_at DESC
        Sort Method: quicksort  Memory: 436kB
        Buffers: shared hit=26152 read=58560
        Worker 0:  Sort Method: quicksort  Memory: 373kB
        Worker 1:  Sort Method: quicksort  Memory: 389kB
        ->  Nested Loop Left Join  (cost=0.43..99048.85 rows=1935 width=242) (actual time=3.349..94.149 rows=1473 loops=3)
              Buffers: shared hit=26136 read=58560
              ->  Parallel Seq Scan on transaction t1_0  (cost=0.00..85245.59 rows=1759 width=162) (actual time=3.328..89.393 rows=1343 loops=3)
                    Filter: ((deleted_at IS NOT NULL) AND (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid))
                    Rows Removed by Filter: 1065324
                    Buffers: shared hit=10020 read=58560
              ->  Index Scan using ix_transaction_line_transaction on transaction_line l1_0  (cost=0.43..7.84 rows=1 width=80) (actual time=0.003..0.003 rows=1 loops=4028)
                    Index Cond: (transaction_id = t1_0.id)
                    Buffers: shared hit=16116
Planning:
  Buffers: shared hit=16
Planning Time: 0.087 ms
JIT:
  Functions: 24
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 0.663 ms (Deform 0.399 ms), Inlining 0.000 ms, Optimization 0.525 ms, Emission 9.290 ms, Total 10.478 ms
Execution Time: 105.032 ms
```

</details>

<details>
<summary>큰 장부 20만 건 큰 장부, 일반 계획 (<code>perf_mix_200k</code>)</summary>

계좌 하나 잔액

```text
Aggregate  (cost=5784.60..5784.61 rows=1 width=32) (actual time=1895.925..1895.926 rows=1 loops=1)
  Buffers: shared hit=690413 read=155285
  ->  Nested Loop  (cost=8.56..5784.41 rows=78 width=8) (actual time=11.184..1886.261 rows=193947 loops=1)
        Buffers: shared hit=690413 read=155285
        ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=8.13..1772.11 rows=478 width=24) (actual time=11.144..226.219 rows=200000 loops=1)
              Recheck Cond: (account_id = $1)
              Heap Blocks: exact=45538
              Buffers: shared read=45698
              ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..8.02 rows=478 width=0) (actual time=7.969..7.970 rows=200000 loops=1)
                    Index Cond: (account_id = $1)
                    Buffers: shared read=160
        ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..8.39 rows=1 width=16) (actual time=0.008..0.008 rows=1 loops=200000)
              Index Cond: (id = tl1_0.transaction_id)
              Filter: ((deleted_at IS NULL) AND (occurred_on >= $2) AND ((status)::text <> ($3)::text))
              Rows Removed by Filter: 0
              Buffers: shared hit=690413 read=109587
Planning:
  Buffers: shared hit=6 read=10
Planning Time: 0.414 ms
Execution Time: 1895.942 ms
```

장부 전체 잔액

```text
GroupAggregate  (cost=16053.95..16066.19 rows=612 width=48) (actual time=2649.238..2664.375 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=749689 read=195406, temp read=888 written=891
  ->  Sort  (cost=16053.95..16055.48 rows=612 width=24) (actual time=2649.085..2656.435 rows=213272 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: external merge  Disk: 7104kB
        Buffers: shared hit=749689 read=195406, temp read=888 written=891
        ->  Nested Loop  (cost=8.56..16025.63 rows=612 width=24) (actual time=12.710..2619.293 rows=213272 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=749689 read=195406
              ->  Nested Loop  (cost=8.13..13928.02 rows=3750 width=44) (actual time=12.703..329.348 rows=219926 loops=1)
                    Buffers: shared hit=3366 read=62025
                    ->  Seq Scan on account a1_0  (cost=0.00..194.88 rows=8 width=20) (actual time=0.339..0.351 rows=10 loops=1)
                          Filter: (ledger_id = $1)
                          Rows Removed by Filter: 7500
                          Buffers: shared hit=1 read=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=8.13..1711.86 rows=478 width=40) (actual time=1.533..31.223 rows=21993 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=65094
                          Buffers: shared hit=3365 read=61925
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..8.02 rows=478 width=0) (actual time=1.092..1.092 rows=21993 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=11 read=185
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.010..0.010 rows=1 loops=219926)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> ($2)::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=746323 read=133381
Planning:
  Buffers: shared hit=14 read=16
Planning Time: 0.698 ms
Execution Time: 2665.175 ms
```

월별 통계

```text
GroupAggregate  (cost=139.38..139.61 rows=9 width=55) (actual time=2.709..2.805 rows=29 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=11683
  ->  Sort  (cost=139.38..139.40 rows=9 width=31) (actual time=2.702..2.733 rows=1490 loops=1)
        Sort Key: tl1_0.category_id, c1_0.kind
        Sort Method: quicksort  Memory: 118kB
        Buffers: shared hit=11683
        ->  Nested Loop  (cost=1.15..139.24 rows=9 width=31) (actual time=0.010..2.558 rows=1490 loops=1)
              Buffers: shared hit=11683
              ->  Nested Loop  (cost=0.86..136.49 rows=9 width=24) (actual time=0.006..1.872 rows=1820 loops=1)
                    Buffers: shared hit=7213
                    ->  Index Scan using ix_transaction_ledger_occurred_on on transaction t1_0  (cost=0.43..68.83 rows=8 width=16) (actual time=0.004..0.284 rows=1655 loops=1)
                          Index Cond: ((ledger_id = $1) AND (occurred_on >= $2) AND (occurred_on <= $3))
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> ($4)::text))
                          Rows Removed by Filter: 42
                          Buffers: shared hit=592
                    ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.45 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=1655)
                          Index Cond: (transaction_id = t1_0.id)
                          Buffers: shared hit=6621
              ->  Index Scan using category_pkey on category c1_0  (cost=0.29..0.31 rows=1 width=23) (actual time=0.000..0.000 rows=1 loops=1820)
                    Index Cond: (id = tl1_0.category_id)
                    Buffers: shared hit=4470
Planning:
  Buffers: shared hit=22
Planning Time: 0.095 ms
Execution Time: 2.821 ms
```

휴지통 목록

```text
Sort  (cost=11223.61..11223.79 rows=73 width=242) (actual time=1690.802..1691.233 rows=4418 loops=1)
  Sort Key: t1_0.deleted_at DESC
  Sort Method: quicksort  Memory: 1245kB
  Buffers: shared hit=8597 read=76430
  ->  Nested Loop Left Join  (cost=124.85..11221.35 rows=73 width=242) (actual time=19.441..1689.027 rows=4418 loops=1)
        Buffers: shared hit=8597 read=76430
        ->  Bitmap Heap Scan on transaction t1_0  (cost=124.42..10663.15 rows=66 width=162) (actual time=19.369..1513.314 rows=4028 loops=1)
              Recheck Cond: (ledger_id = $1)
              Rows Removed by Index Recheck: 1444788
              Filter: (deleted_at IS NOT NULL)
              Rows Removed by Filter: 195972
              Heap Blocks: exact=35554 lossy=33025
              Buffers: shared read=68913
              ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..124.41 rows=3197 width=0) (actual time=16.759..16.759 rows=200000 loops=1)
                    Index Cond: (ledger_id = $1)
                    Buffers: shared read=334
        ->  Index Scan using ix_transaction_line_transaction on transaction_line l1_0  (cost=0.43..8.45 rows=1 width=80) (actual time=0.043..0.043 rows=1 loops=4028)
              Index Cond: (transaction_id = t1_0.id)
              Buffers: shared hit=8597 read=7517
Planning:
  Buffers: shared hit=5 read=11
Planning Time: 0.440 ms
Execution Time: 1691.800 ms
```

</details>

<details>
<summary>300만 건 DB 보통 장부, 일반 계획 (<code>perf_l1000_3m</code>)</summary>

계좌 하나 잔액

```text
Aggregate  (cost=5383.61..5383.62 rows=1 width=32) (actual time=1.176..1.176 rows=1 loops=1)
  Buffers: shared hit=4623
  ->  Nested Loop  (cost=8.31..5383.43 rows=73 width=8) (actual time=0.059..1.150 rows=899 loops=1)
        Buffers: shared hit=4623
        ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.88..1650.06 rows=445 width=24) (actual time=0.057..0.291 rows=924 loops=1)
              Recheck Cond: (account_id = $1)
              Heap Blocks: exact=924
              Buffers: shared hit=927
              ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.77 rows=445 width=0) (actual time=0.027..0.027 rows=924 loops=1)
                    Index Cond: (account_id = $1)
                    Buffers: shared hit=3
        ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..8.39 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=924)
              Index Cond: (id = tl1_0.transaction_id)
              Filter: ((deleted_at IS NULL) AND (occurred_on >= $2) AND ((status)::text <> ($3)::text))
              Rows Removed by Filter: 0
              Buffers: shared hit=3696
Planning:
  Buffers: shared hit=16
Planning Time: 0.043 ms
Execution Time: 1.184 ms
```

장부 전체 잔액

```text
GroupAggregate  (cost=14999.24..15010.72 rows=574 width=48) (actual time=5.343..5.494 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=16563
  ->  Sort  (cost=14999.24..15000.67 rows=574 width=24) (actual time=5.317..5.380 rows=3192 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 221kB
        Buffers: shared hit=16563
        ->  Nested Loop  (cost=8.31..14972.93 rows=574 width=24) (actual time=0.103..5.086 rows=3192 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=16563
              ->  Nested Loop  (cost=7.88..13004.39 rows=3520 width=44) (actual time=0.100..1.571 rows=3289 loops=1)
                    Buffers: shared hit=3407
                    ->  Seq Scan on account a1_0  (cost=0.00..193.75 rows=8 width=20) (actual time=0.002..0.144 rows=6 loops=1)
                          Filter: (ledger_id = $1)
                          Rows Removed by Filter: 7494
                          Buffers: shared hit=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.88..1596.88 rows=445 width=40) (actual time=0.045..0.205 rows=548 loops=6)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=3289
                          Buffers: shared hit=3307
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.77 rows=445 width=0) (actual time=0.020..0.020 rows=548 loops=6)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=18
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.001..0.001 rows=1 loops=3289)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> ($2)::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=13156
Planning:
  Buffers: shared hit=30
Planning Time: 0.108 ms
Execution Time: 5.516 ms
```

월별 통계

```text
GroupAggregate  (cost=126.57..126.77 rows=8 width=55) (actual time=0.057..0.061 rows=15 loops=1)
  Group Key: tl1_0.category_id, c1_0.kind
  Filter: (sum(tl1_0.amount) <> '0'::numeric)
  Buffers: shared hit=197
  ->  Sort  (cost=126.57..126.59 rows=8 width=31) (actual time=0.056..0.056 rows=23 loops=1)
        Sort Key: tl1_0.category_id, c1_0.kind
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=197
        ->  Nested Loop  (cost=1.15..126.45 rows=8 width=31) (actual time=0.006..0.053 rows=23 loops=1)
              Buffers: shared hit=197
              ->  Nested Loop  (cost=0.86..124.01 rows=8 width=24) (actual time=0.005..0.038 rows=27 loops=1)
                    Buffers: shared hit=128
                    ->  Index Scan using ix_transaction_ledger_occurred_on on transaction t1_0  (cost=0.43..64.80 rows=7 width=16) (actual time=0.003..0.009 rows=25 loops=1)
                          Index Cond: ((ledger_id = $1) AND (occurred_on >= $2) AND (occurred_on <= $3))
                          Filter: ((deleted_at IS NULL) AND ((status)::text <> ($4)::text))
                          Buffers: shared hit=28
                    ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.45 rows=1 width=40) (actual time=0.001..0.001 rows=1 loops=25)
                          Index Cond: (transaction_id = t1_0.id)
                          Buffers: shared hit=100
              ->  Index Scan using category_pkey on category c1_0  (cost=0.29..0.31 rows=1 width=23) (actual time=0.000..0.000 rows=1 loops=27)
                    Index Cond: (id = tl1_0.category_id)
                    Buffers: shared hit=69
Planning:
  Buffers: shared hit=22
Planning Time: 0.084 ms
Execution Time: 0.068 ms
```

휴지통 목록

```text
Sort  (cost=10561.93..10562.11 rows=72 width=242) (actual time=1.102..1.105 rows=69 loops=1)
  Sort Key: t1_0.deleted_at DESC
  Sort Method: quicksort  Memory: 41kB
  Buffers: shared hit=3270
  ->  Nested Loop Left Join  (cost=123.38..10559.71 rows=72 width=242) (actual time=0.306..1.090 rows=69 loops=1)
        Buffers: shared hit=3270
        ->  Bitmap Heap Scan on transaction t1_0  (cost=122.95..10009.97 rows=65 width=162) (actual time=0.304..1.023 rows=61 loops=1)
              Recheck Cond: (ledger_id = $1)
              Filter: (deleted_at IS NOT NULL)
              Rows Removed by Filter: 2939
              Heap Blocks: exact=2999
              Buffers: shared hit=3026
              ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..122.93 rows=3000 width=0) (actual time=0.139..0.139 rows=3000 loops=1)
                    Index Cond: (ledger_id = $1)
                    Buffers: shared hit=27
        ->  Index Scan using ix_transaction_line_transaction on transaction_line l1_0  (cost=0.43..8.45 rows=1 width=80) (actual time=0.001..0.001 rows=1 loops=61)
              Index Cond: (transaction_id = t1_0.id)
              Buffers: shared hit=244
Planning:
  Buffers: shared hit=16
Planning Time: 0.049 ms
Execution Time: 1.121 ms
```

카테고리 사용 여부(거래 없음)

```text
Limit  (cost=1000.00..6891.19 rows=12 width=16) (actual time=43.070..44.578 rows=0 loops=1)
  Buffers: shared hit=3997 read=38696
  ->  Gather  (cost=1000.00..60893.74 rows=122 width=16) (actual time=43.069..44.578 rows=0 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=3997 read=38696
        ->  Parallel Seq Scan on transaction_line tl1_0  (cost=0.00..59881.54 rows=51 width=16) (actual time=42.192..42.192 rows=0 loops=3)
              Filter: (category_id = $1)
              Rows Removed by Filter: 1100055
              Buffers: shared hit=3997 read=38696
Planning Time: 0.026 ms
Execution Time: 44.584 ms
```

</details>
