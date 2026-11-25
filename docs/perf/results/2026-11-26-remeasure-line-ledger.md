# #58(V10~V12) 뒤 잔액 쿼리와 넣기 비용 다시 재기 (2026-11-26)

> **한계를 먼저 읽는다.**
> - 맥 로컬 Docker에서 **DB 실행 시간만** 잰 것이다. API 지연이 아니다(네트워크, Hibernate, 권한 확인 쿼리가 빠져 있다). **운영 서버 수치가 아니다**(Apple M5 Pro, CPU 상한 없음, 운영은 Ampere A1 4 OCPU).
> - **시간은 참고값이다.** 맥에서 다른 봇의 worker(Gradle 테스트, Testcontainers, 백업 시험)가 같이 돌아 load average(1분)가 회차에 따라 4.99~59.35였고, 앞뒤 회차의 load도 서로 다르다(2장의 회차 표, 각 시간 칸의 load). 판정은 계획 모양, 훑는 테이블, 버퍼 수로 한다.
> - **큰 장부 5만 건의 상한 200ms 시간 판정은 하지 못했다.** 시간 판정은 load 1분이 5 아래일 때만 하기로 했고, planner의 결정으로 조용한 때를 기다리지 않았다. 다른 일을 하는 동안 load를 보며 5 아래면 재도록 해 두었지만, 문서를 올릴 때까지 큰 장부의 장부 전체 잔액을 잰 모든 칸의 load가 5.23 이상이었다(4.8). 다음 측정으로 넘긴다. 큰 장부는 계획, 훑는 테이블, 버퍼로만 판정했다(7장).
> - 쿼리를 한 번에 하나씩 돌렸다. 동시 요청은 재지 않았다. 표본은 7개다(백분위가 아니다). 시간은 `EXPLAIN (ANALYZE, BUFFERS)`의 `Execution Time`이고 노드마다 시간을 재는 비용이 들어 있으며 계획 시간은 빠져 있다.
> - 같은 DB를 V9에서 V12로 올려 앞뒤를 쟀고 되돌리지 않았다. 그래서 앞뒤를 번갈아 재지 않았다. V11은 모든 라인 행의 새 버전을 만들어 **라인의 저장 순서를 바꾼다**. `VACUUM (FULL, ANALYZE)`는 빈 자리를 없애지만 순서를 V9로 되돌리지 않는다(4.2의 확인 표).
> - 통계는 `ANALYZE`의 표본이라 다시 모을 때마다 예상 행 수가 조금씩 다르고, 비용이 비슷한 인덱스 사이의 선택이 바뀌기도 한다(4.6의 (a0)).
> - 시드의 모든 계좌는 기준일이 거래가 시작되는 날이라, 잔액 쿼리의 기준일 조건이 이 데이터에서는 행을 거르지 않는다. 후보의 결과 비교만 기준일을 흩뜨린 사본에서도 했다(4.6). 데이터의 나머지 한계(날짜 순 입력, 수정 흔적 없는 테이블, 휴지통 2%, `change_log` 없음 등)는 [1차 문서](2026-11-24-query-baseline.md)와 같다.
> - 후보(확장 통계, account 조인을 없앤 문장)는 측정용 DB에만 넣었다. 앱 코드와 마이그레이션은 바꾸지 않았다.
> - 6장의 원인 해석과 권고는 perf가 4장과 10장을 읽고 썼다. 다른 장에는 잰 값만 적었다.

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-26 |
| 잰 사람 | perf가 맡긴 작업자. 6장(왜 이 수치인지)은 perf가 썼다 |
| 커밋 | 서버 코드와 마이그레이션(V1~V12), `perf/queries/`는 main a55e96f(PR #170). #58 앞의 문장(`perf/queries/before-58/`)은 bc91001(a55e96f의 바로 앞, V9)에서 가져왔다. V9 DB의 시드는 c415677의 `perf/seed.sql`이다. 측정 스크립트는 이 PR의 89ce89a로 돌렸다. 이 PR에 main c3ef222(V13~V15, `change_log`만 바꾼다)를 merge한 뒤 다섯 문장을 다시 가져와 보았고 글자 단위로 같다. V15에서 `perf_small15`(작은 DB)로 시드와 `base`가 돈다(측정 DB는 V12다) |
| 이슈 | [#171](https://github.com/lomong7807/akkimpyo/issues/171). 앞선 측정: [2026-11-24 쿼리 기준선](2026-11-24-query-baseline.md), [2026-11-25 잔액 진단](2026-11-25-balance-diagnosis.md), [2026-11-25 V6과 Spring Boot 4.2 뒤 다시 재기](2026-11-25-remeasure-v6-boot42.md) |

## 1. 결과 요약

#58 뒤 큰 장부의 장부 전체 잔액은 값에 맞춘 계획에서 버퍼가 약 2.7분의 1이 됐지만 `transaction_line` 전체를 훑고, 200ms 판정은 못 했다. 후보 (a), (b)는 넣지 않는 것을 권한다(6장).

아래는 확인한 사실이다(권고는 6장). "큰 장부"는 `perf_mix_50k`의 장부 1001(거래 5만 건), "보통 장부"는 장부 1(거래 3천 건)이다.

- **도구**: `perf/seed.sql`, `perf/insert-cost.sql`, `perf/run-diagnosis.sh`, `perf/queries/`를 V12에 맞췄다. README의 여덟 변수 조합 모두 V9 + 옛 시드와 V12 + 새 시드의 건수와 내용 해시(`ledger_id`를 뺀 것)가 같다(4.1). `perf/queries/`의 다섯 문장은 main a55e96f의 Hibernate 로그와 글자 단위로 같다.
- **#58 앞뒤, 장부 전체 잔액(큰 장부)**: 리터럴은 중첩 루프(`transaction`, `transaction_line` 훑기 없음)에서 병렬 해시 조인(작업자 2, **`transaction_line`과 `account`를 Seq Scan**)으로 바뀌었다. 버퍼는 hit 148,541~148,657 / read 125,397~125,513(V9), 155,672~155,752 / 118,310~118,390(V9 FULL)에서 hit 329~333 / read 100,108~100,112가 됐다. 일반 계획은 여전히 중첩 루프이고(병렬 작업자 1, 훑기 없음) hit가 14만 9천~15만 6천에서 30만 7천, read가 11만 8천~12만 5천에서 9만 7천이 됐다.
- **#58 앞뒤, 장부 전체 잔액(보통 장부)**: 리터럴은 중첩 루프에서 해시 조인 + 중첩 루프(병렬 작업자 1, `account` Seq Scan)로, 일반 계획은 병렬 중첩 루프(`account_pkey`)로 바뀌었다. 버퍼 hit는 16,466~16,468에서 리터럴 14,890, 일반 계획 24,247~24,249다(read 0). `transaction`·`transaction_line` 훑기는 앞뒤 모두 없다. `perf_l1000_3m`도 같다.
- **`account`를 읽는 방법**: V9은 모든 조건에서 `uq_account_name`을 쓰는 Bitmap Heap Scan(3블록), V12는 리터럴이 Seq Scan(프로세스마다 101블록), 일반 계획이 `account_pkey` Index Scan(라인마다)이다.
- **계좌 하나 잔액**: 앞뒤 모두 중첩 루프이고 훑기가 없다. 큰 장부 리터럴이 병렬(작업자 2)에서 비병렬로 바뀌었고, 거래를 찾는 인덱스가 `transaction_pkey`에서 `uq_transaction_id_ledger`로 바뀌었다. 버퍼 hit는 55,920~55,927에서 55,113(큰), 4,623~4,624에서 4,621~4,622(보통)다.
- **예상 행 수(계좌 하나 잔액의 라인 노드)**: 큰 장부 리터럴 4,986~5,406 ×3(병렬) → 196, 일반 계획 451~453 → 1, 보통 장부 428~453 → 1(실제 11,247 / 924). 이 차이로 바뀐 것은 위의 병렬 여부와 인덱스 이름뿐이고 조인 방식은 그대로다(4.5).
- **V12에 바로 시드한 DB**: 이관한 DB와 모든 테이블의 건수와 모든 열의 내용 해시가 같고, 열두 조건의 계획 모양이 모두 같다(4.4).
- **V10~V12 적용 시간**(문장 시간의 합): `perf_mix_50k` V10 0.75초, V11 423초(load 10.3 → 26.7), V12 6.4초. `perf_l1000_3m` V10 3.2초, V11 284.6초(load 31.2 → 6.6), V12 4.2초(4.3).
- **dba 후보 (a) 확장 통계**: 계좌 하나 잔액의 라인 예상이 큰 장부 리터럴 196(통계만 다시 모은 a0은 187) → 4,753 ×3, 보통 장부 1 → 431로 바뀌었다. 장부 전체 잔액의 계획은 바뀌지 않았다. 큰 장부 계좌 하나 잔액의 일반 계획은 중첩 루프에서 해시 조인으로 바뀌었고 중앙값이 (0) 38.1 / (a0) 47.2 → (a) 628.6ms다(load 10~37, 참고값)(4.6).
- **dba 후보 (b) account 조인을 없앤 문장 둘**: 모든 장부에서 결과가 지금과 같다(7,510행, 기준일을 흩뜨린 사본 6,764행). 큰 장부는 두 문장 모두 중첩 루프(`transaction_line`·`account` 훑기 없음)이고 버퍼가 hit 150,958~162,470 / read 109,339~120,851이다(지금 리터럴은 hit 329~333 / read 100,108~100,112). 앱에서는 파라미터 5개다(4.6).
- **넣기 비용**(거래 1,000건 + 라인 1,100건): 두 DB, 두 번 모두 WAL 레코드가 7,400~7,403 → 8,400~8,403, 첫 회차의 WAL은 24.6 → 31.2MB(`perf_mix_50k`)다. 라인 FK 셋의 검사 시간 합(중앙)은 V9 10.9~11.1 → V12 12.3~12.7ms다(`perf_mix_50k` 두 번과 `perf_l1000_3m` 두 번째. `perf_l1000_3m` 첫 번째는 15.4 → 27.9). 총 시간은 참고값이다(4.7).
- **새 유니크 셋의 크기**(V12 적용 뒤): `uq_transaction_id_ledger` 151,281,664바이트(144MB, `perf_mix_50k`), `uq_category_id_ledger` 1,499,136, `uq_account_id_ledger` 393,216. `transaction_line` 테이블은 355,549,184 → 410,673,152바이트(15.5% 크다).
- **큰 장부 5만 건 상한 200ms**: 시간 판정 못 함(load). 참고값(load 5.23~9.57): 리터럴 중앙 182.7~218.6ms, 최댓값 195.7~240.9ms, 일반 계획 중앙 991~1,105ms(4.8, 2장의 V12 바로 시드). 계획으로는 리터럴에 `transaction_line` Seq Scan이 있어 "전체 훑기 없음" 기준에 맞지 않는다.

## 2. 환경

| 항목 | 값 |
|---|---|
| 장비 | 맥, Apple M5 Pro(CPU 15개), 메모리 48GB, macOS 27.0.1(26A434), AC 전원 |
| Docker | Docker Desktop, Docker 29.9.2, Compose 5.6.1. VM에 CPU 10개, 메모리 8,214,786,048바이트(약 7.7GB), 리눅스 7.0.14-linuxkit. 같은 VM에 Docker Desktop의 Kubernetes가 있다(`docker info`의 실행 중 컨테이너 수에 들어 있다) |
| PostgreSQL | 17.12, arm64 (`postgres:17@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac`, 앞의 세 문서와 같은 이미지) |
| 컨테이너 한도 | 메모리 1GB, 스왑 없음, `/dev/shm` 256MB, CPU 상한 없음(`perf/compose.diag.yaml`로 띄움) |
| DB 설정 | `shared_buffers` 256MB, `work_mem` 4MB, `effective_cache_size` 4GB, `random_page_cost` 4, `max_parallel_workers_per_gather` 2, `jit` on, `track_io_timing` off, `plan_cache_mode` auto, `default_statistics_target` 100, `autovacuum` on(측정 중 실행 없음), `max_wal_size` 1GB, `maintenance_work_mem` 64MB |
| 서버와 드라이버 | Spring Boot 4.2.0, Hibernate 7.4.15.Final, HikariCP 7.1.0, pgJDBC 42.7.14. #112(`force_custom_plan`)와 #67(인덱스)은 아직 열려 있다 |

데이터는 앞의 문서와 같은 변수로 만들었다.

| DB | 만든 변수 | 거래 | 라인 | 큰 장부 1001 | 보통 장부 1 |
|---|---|---|---|---|---|
| `perf_mix_50k` | `ledgers=1000`, `tx_per_ledger=3000`, `big_ledger_tx=50000` | 3,050,000 | 3,355,147 | 거래 50,000, 라인 54,981 | 거래 3,000, 라인 3,289 |
| `perf_l1000_3m` | `ledgers=1000`, `tx_per_ledger=3000` | 3,000,000 | 3,300,166 | 없음 | 거래 3,000, 라인 3,289 |

회차마다의 load average(1분)와 다른 컨테이너다. "그 회차의 load"는 그 회차의 쿼리 칸마다 잰 값의 범위다. 다른 컨테이너의 이름은 `OUT/timeline.tsv`에 남겼다(다른 봇의 `qa-batch3-pg`, `clv-pg17`, `ab-problem-json-pg`, `akkimpyo-backup-test-…`, `akkimpyo-drill-…`, Testcontainers).

| 단계와 회차 | 시작(KST) | load 1분(시작) | 그 회차의 load | 다른 컨테이너(docker ps) | docker info 실행 중 전체 |
|---|---|---|---|---|---|
| seed V1~V9 | 11-26 00:25:04 | 6.12 | 6.12~40.29 | 2 | 24 |
| seed | 11-26 00:30:59 | 40.29 | 8.83~40.29 | 5(그중 testcontainers 2) | 27 |
| perf_mix_50k `1-v9` | 11-26 00:46:42 | 36.46 | 36.46~40.97 | 4(그중 testcontainers 2) | 26 |
| perf_mix_50k `2-v9` | 11-26 00:48:31 | 36.78 | 15.72~36.78 | 1 | 23 |
| perf_mix_50k `3-v9-full` | 11-26 00:50:02 | 18.21 | 11.14~18.21 | 1 | 23 |
| perf_mix_50k `4-v12` | 11-26 00:59:10 | 32.25 | 29.86~32.51 | 6(그중 testcontainers 3) | 28 |
| perf_mix_50k `5-v12` | 11-26 00:59:54 | 29.86 | 29.86~59.35 | 6(그중 testcontainers 2) | 28 |
| perf_l1000_3m `1-v9` | 11-26 01:01:20 | 46.92 | 43.64~46.92 | 5(그중 testcontainers 2) | 27 |
| perf_l1000_3m `2-v9` | 11-26 01:01:24 | 43.64 | 40.79~43.64 | 5(그중 testcontainers 2) | 27 |
| perf_l1000_3m `3-v9-full` | 11-26 01:01:52 | 32.75 | 30.53~32.75 | 5(그중 testcontainers 2) | 27 |
| perf_l1000_3m `4-v12` | 11-26 01:07:23 | 5.28 | 5.28 | 3(그중 testcontainers 1) | 25 |
| perf_l1000_3m `5-v12` | 11-26 01:07:27 | 5.28 | 5.28~5.33 | 5(그중 testcontainers 1) | 27 |
| base | 11-26 01:07:30 | 5.33 | 4.99~5.87 | 6(그중 testcontainers 1) | 28 |
| judge 010754 perf_mix_50k | 11-26 01:07:54 | 5.87 | 5.63~5.87 | 4 | 26 |
| judge 010754 perf_mix_50k_new | 11-26 01:08:09 | 5.63 | 5.56~5.66 | 5 | 27 |
| insert | 11-26 01:08:27 | 5.56 | 5.06~19.38 | 5(그중 testcontainers 1) | 27 |
| cand | 11-26 01:09:19 | 16.29 | 10.31~45.8 | 3(그중 testcontainers 1) | 25 |
| judge 013133 perf_mix_50k | 11-26 01:31:34 | 9.57 | 8.78~9.57 | 2(그중 testcontainers 1) | 24 |

- 측정 중에 작업자가 측정용 DB에서 카탈로그를 읽은 것은 다음 세 번이다: 시드 중 `pg_stat_activity`(00:26), 01:02 무렵 `pg_settings`(`perf_l1000_3m`의 `1-v9`/`2-v9`와 겹칠 수 있다), 후보 결과 비교 중 `pg_stat_activity`(01:19). 개발용 DB(5433)와 다른 컨테이너는 건드리지 않았다.
- 절전 기록(`pmset -g log`)은 측정 구간(00:25 이후)에 없다. 스크립트가 `caffeinate -dims`를 건다.

## 3. 방법

`perf/README.md` 8번의 절차이고, 캐시 상태를 맞추는 방법(`fresh`: PostgreSQL만 재시작하고 측정용 DB 파일을 OS 페이지 캐시에서 내림)과 세는 방법(한 psql 세션에서 10번, 뒤 7번의 최소/중앙/최대)은 앞선 [진단 측정](2026-11-25-balance-diagnosis.md) 3장과 같다.

```sh
# 시드 확인(여덟 조합: 아래 여섯 + 측정용 두 DB)
git show c415677:perf/seed.sql | perfsql -d perf_l1_12k ...    # V9 스키마
perfsql -d perf_l1_12k < perf/seed.sql                          # V12 스키마. 두 해시를 견준다

# 측정용 DB
OUT=... DBS="perf_mix_50k perf_l1000_3m" perf/run-diagnosis.sh up v12-seed          # V1~V9 + c415677의 시드
OUT=... DBS="perf_mix_50k_new perf_l1000_3m_new" perf/run-diagnosis.sh seed         # V1~V12 + 지금 시드

# #58 앞뒤, 바로 시드한 DB, 넣기 비용, 후보, 판정용 회차
OUT=... DBS="perf_mix_50k perf_l1000_3m" perf/run-diagnosis.sh v12
OUT=... DBS="perf_mix_50k_new perf_l1000_3m_new" perf/run-diagnosis.sh base
OUT=... DBS="perf_mix_50k perf_mix_50k_new" perf/run-diagnosis.sh judge
OUT=... DBS="perf_mix_50k perf_l1000_3m" perf/run-diagnosis.sh insert
OUT=... DBS=perf_mix_50k perf/run-diagnosis.sh cand judge
java -cp <postgresql-42.7.14.jar> perf/PrepareThresholdCheck.java jdbc:postgresql://localhost:5434/perf_mix_50k 1001
OUT=... perf/run-diagnosis.sh sleep-log down
node perf/summarize-diagnosis.mjs "$OUT"
```

- 재는 문장마다 `statement_timeout`을 120초로 걸었다. **시간 제한에 걸린 문장은 없었다.**
- 회차 순서(`v12` 단계): V9에 시드 → V9 1·2회차 → `VACUUM (FULL, ANALYZE)` + `VACUUM (ANALYZE)` + `CHECKPOINT` → V9 FULL 3회차 → 넣기 비용에 쓸 사본(`_ins9`) → `fresh` 뒤 V10·V11·V12를 한 파일씩 한 트랜잭션으로 적용 → 다시 `VACUUM (FULL, ANALYZE)` + `VACUUM (ANALYZE)` + `CHECKPOINT` → V12 4·5회차. 앞의 회차는 #58 앞의 문장, 뒤의 회차는 지금 main의 문장이다.
- `VACUUM FULL`은 visibility map을 만들지 않아 `VACUUM (ANALYZE)`를 한 번 더 했다(진단 측정의 E7과 같다).
- 바로 시드한 DB(`_new`)는 시드 스크립트의 `VACUUM (ANALYZE)`만 거친 상태다(`VACUUM FULL` 없음).
- 시간 판정: coordinator(planner)의 결정으로 조용한 때를 기다리지 않았다. 다른 일을 하는 동안 load 1분이 5 아래인 때가 있으면 그때 장부 전체 잔액만 다시 쟀다(`judge`).
- 후보는 한 번에 하나만 바꾸고 사본(`perf_mix_50k_cand`, `CREATE DATABASE ... STRATEGY FILE_COPY`)에서 쟀다.
- 큰 장부는 `perf_mix_50k`에만 있다. `perf_l1000_3m`은 보통 장부만 쟀다.

## 4. 결과

### 4.1 도구와 시드

| 확인 | 결과 |
|---|---|
| `perf/queries/`의 다섯 문장과 main a55e96f의 Hibernate 로그 | 글자 단위로 같다(`balance` 280바이트, `balances` 350, `category-in-use` 93, `monthly-stats` 377, `trash-list` 472). 로그의 바인드 타입도 `PREPARE`의 타입과 같다(`balance` UUID·DATE·VARCHAR·UUID·UUID, `balances` UUID·UUID·VARCHAR, `category-in-use` UUID·INTEGER, `monthly-stats` UUID·DATE·DATE·VARCHAR, `trash-list` UUID) |
| `perf/queries/before-58/`의 두 문장과 bc91001의 Hibernate 로그 | 글자 단위로 같다(`balance` 237바이트, `balances` 328). 바인드 타입은 UUID·DATE·VARCHAR, UUID·VARCHAR |
| bc91001과 a55e96f의 다섯 문장 차이 | `balance`·`balances`의 장부 조건과 `trash-list`의 `l1_0.ledger_id`뿐이다. `category-in-use`, `monthly-stats`는 같다(PR #154의 `cast`는 bc91001에 이미 있다) |
| 여덟 변수 조합의 건수·내용 해시: V9 + 옛 시드(c415677)와 V12 + 새 시드 | 일곱 테이블(`users`, `ledger`, `ledger_member`, `account`, `category`, `transaction`, `transaction_line`) 모두 같다(`transaction_line`은 `ledger_id`를 뺀 열). 건수는 1차 문서 2장의 표와 같다 |
| `ledger_id` 값 | V12의 새 시드에서 라인과 거래의 `ledger_id`가 다른 행 0(여섯 조합에서 확인. 복합 FK가 있는 스키마에 들어갔다) |
| 점검 쿼리(`docs/db/integrity-checks.sql`) | V9, V12 모두 점검 15개가 0건(`flyway_schema_history` 한 줄은 뺐다) |
| `perf/run-diagnosis.sh`의 모든 단계 | 작은 DB(`perf_small`)로 V12에서 `seed base e1 e2 e4 e5 e6 e7 e3 base-again`, V9 → V12로 `v12-seed v12 insert cand judge`가 오류 없이 끝났다. 시간 제한 처리는 `STATEMENT_TIMEOUT=1ms`로 확인했다(`.timeout` 파일과 실행하지 않은 계획이 남는다) |
| `perf/PrepareThresholdCheck.java`(pgJDBC 42.7.14) | 새 문장의 바인드 3개에 맞췄다. V12 `perf_mix_50k` 큰 장부에서 서버 쪽 준비된 문장은 5번째 실행에서 만들어지고(`{uuid,uuid,"character varying"}`), 값에 맞춘 계획 5번 뒤 10번째부터 일반 계획이다. 앞선 측정과 같은 번호다 |

- 여덟 조합은 `perf_l1_12k`, `perf_l1_50k`, `perf_one_10k`, `perf_one_50k`, `perf_one_200k`, `perf_mix_200k`(이 여섯은 확인 뒤 지웠다), `perf_mix_50k`, `perf_l1000_3m`(측정에 썼다)이다.
- `e7`은 `ledger_id`를 손으로 넣는 부분과 채택된 후보 쿼리를 빼고 인덱스 후보 A·B만 남겼다. 옛 `e7`과 `v6`은 c415677에서 쓴다(README에 적었다).

### 4.2 #58 앞뒤 비교

같은 DB에서 앞(V9, #58 앞의 문장)과 뒤(V12, 지금 문장)를 쟀다.

| 확인 | `perf_mix_50k` | `perf_l1000_3m` |
|---|---|---|
| 건수와 내용 해시(`ledger_id`를 뺀 것): 시드 직후, V9 FULL, V12 적용 직후, V12 FULL | 일곱 테이블 모두 네 상태에서 같다 | 일곱 테이블 모두 네 상태에서 같다 |
| 저장 위치(ctid) 해시가 시드 직후와 다른 테이블 | V9 FULL: `transaction`. V12 적용 직후와 V12 FULL: `transaction`, `transaction_line` | `perf_mix_50k`와 같은 테이블 |
| 장부 1001의 라인이 있는 `transaction_line` 블록 수(라인 54,981개) | V9 43,401(FULL도 같음) → V12 적용 직후 32,122, V12 FULL 32,137 | 큰 장부 없음 |
| 장부 1의 라인이 있는 블록 수(라인 3,289개) | V9 3,004 → V12 2,962, V12 FULL 2,963 | V9 3,005 → V12 2,968 |
| 자동 VACUUM | 없음(`last_autovacuum` 비어 있음) | 없음 |

시간(ms, 최소 / 중앙 / 최대, 10번 중 뒤 7번)과 그 칸의 load다. **앞뒤의 load가 다르므로 시간을 비교하지 않는다.**

#### `perf_mix_50k`

| 쿼리 | 장부 | 방식 | V9 1회차 | V9 2회차 | V9 FULL 3회차 | V12 4회차 | V12 5회차 | V12 바로 시드 |
|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | 2,702.8 / 3,071.5 / 7,365.1<br>load 40.59~40.97 | 2,756.6 / 3,171.2 / 3,681.6<br>load 23.81~36.78 | 2,781.1 / 3,061.9 / 3,557.6<br>load 15.42~16.99 | 260.9 / 337.2 / 382.3<br>load 30.47 | 324.8 / 467.9 / 650.0<br>load 29.86~31.15 | 191.6 / 197.4 / 217.3<br>load 5.23~5.33 |
| 장부 전체 잔액 | 큰 | 일반 계획 | 2,745.6 / 3,324.1 / 6,907.4<br>load 36.5~40.97 | 2,631.8 / 2,765.2 / 2,810.0<br>load 16.65~23.81 | 2,645.8 / 3,034.2 / 3,729.7<br>load 11.14~15.42 | 1,269.4 / 3,420.3 / 5,304.1<br>load 30.47~32.51 | 4,578.9 / 5,276.4 / 6,595.4<br>load 31.15~59.35 | 981.5 / 1,046.2 / 1,128.8<br>load 5.23~5.25 |
| 장부 전체 잔액 | 보통 | 리터럴 | 18.542 / 22.329 / 25.261<br>load 36.5 | 8.734 / 8.992 / 9.323<br>load 15.72~16.65 | 8.765 / 10.306 / 12.974<br>load 11.14 | 20.131 / 22.547 / 23.450<br>load 32.51 | 20.451 / 22.415 / 23.483<br>load 59.35 | 10.943 / 11.313 / 12.050<br>load 5.25 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 18.139 / 21.022 / 23.684<br>load 36.5 | 19.299 / 20.721 / 26.064<br>load 15.72 | 8.540 / 9.052 / 11.991<br>load 11.14 | 22.430 / 24.933 / 26.339<br>load 32.51 | 22.127 / 24.400 / 26.573<br>load 59.35 | 11.186 / 12.430 / 13.482<br>load 5.25 |
| 계좌 하나 잔액 | 큰 | 리터럴 | 42.619 / 46.603 / 77.282<br>load 36.5~36.78 | 44.173 / 49.471 / 56.182<br>load 15.72 | 23.483 / 24.069 / 25.375<br>load 11.14 | 52.802 / 61.744 / 73.258<br>load 31.5~32.51 | 36.335 / 40.204 / 51.997<br>load 58.04~59.35 | 33.790 / 34.808 / 36.183<br>load 4.99~5.25 |
| 계좌 하나 잔액 | 큰 | 일반 계획 | 55.948 / 70.526 / 79.730<br>load 36.78 | 60.057 / 70.051 / 92.122<br>load 15.72 | 30.447 / 36.070 / 47.414<br>load 11.14 | 47.010 / 62.666 / 73.639<br>load 31.5 | 44.323 / 54.248 / 65.968<br>load 58.04 | 30.803 / 34.805 / 40.065<br>load 4.99 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 3.674 / 4.878 / 6.768<br>load 36.78 | 5.064 / 5.372 / 6.098<br>load 15.72 | 2.093 / 2.182 / 2.735<br>load 11.14 | 3.666 / 4.546 / 5.330<br>load 31.5 | 3.225 / 3.634 / 4.397<br>load 54.35~58.04 | 1.846 / 1.932 / 2.331<br>load 4.99 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 2.808 / 2.980 / 3.519<br>load 36.78 | 5.004 / 5.694 / 6.294<br>load 15.72~18.14 | 1.784 / 1.935 / 2.099<br>load 11.14 | 4.340 / 6.136 / 6.397<br>load 29.86~31.5 | 3.587 / 3.915 / 4.136<br>load 54.35 | 1.832 / 1.919 / 2.011<br>load 4.99 |

#### `perf_l1000_3m`(보통 장부만)

| 쿼리 | 장부 | 방식 | V9 1회차 | V9 2회차 | V9 FULL 3회차 | V12 4회차 | V12 5회차 | V12 바로 시드 |
|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 보통 | 리터럴 | 10.603 / 10.780 / 11.260<br>load 43.64~46.92 | 12.774 / 13.427 / 14.110<br>load 43.64 | 14.652 / 15.356 / 15.859<br>load 30.53 | 8.718 / 8.852 / 8.993<br>load 5.28 | 9.579 / 9.906 / 11.819<br>load 5.33 | 11.918 / 14.696 / 19.535<br>load 4.99 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 9.672 / 10.517 / 10.911<br>load 43.64 | 13.288 / 13.902 / 14.419<br>load 43.64 | 15.366 / 16.577 / 17.444<br>load 30.53 | 9.483 / 11.889 / 16.083<br>load 5.28 | 9.154 / 9.860 / 11.639<br>load 5.33 | 9.669 / 10.466 / 11.591<br>load 4.99 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 2.250 / 2.345 / 2.366<br>load 43.64 | 2.936 / 3.186 / 3.479<br>load 43.64 | 2.414 / 2.588 / 2.975<br>load 30.53 | 1.921 / 2.081 / 2.258<br>load 5.28 | 2.059 / 2.142 / 2.184<br>load 5.33 | 1.831 / 1.902 / 2.219<br>load 4.99~5.87 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 2.312 / 2.398 / 2.500<br>load 43.64 | 2.694 / 2.901 / 3.172<br>load 40.79~43.64 | 2.827 / 3.938 / 5.967<br>load 30.53 | 2.106 / 2.321 / 2.665<br>load 5.28 | 2.073 / 2.175 / 2.352<br>load 5.33 | 1.762 / 1.977 / 2.243<br>load 5.87 |

계획과 버퍼다. 예상/실제의 `×`는 병렬 프로세스 수나 반복 횟수(loops)다. "라인 노드"는 `transaction_line`, "거래 노드"는 `transaction`을 읽는 첫 노드다. 1·2회차와 4·5회차는 통계가 같아 묶었고, 버퍼는 두 회차의 범위다. 네 상태 모두 7번 안에서 계획 모양이 바뀌지 않았고, 묶은 회차끼리의 모양도 같다. `account` 칸의 "없음"은 계획에 `account`가 없는 것이다.

#### `perf_mix_50k`

| 쿼리 | 장부 | 방식 | 상태(회차) | 조인 | 훑는 테이블(Seq Scan) | 쓰인 인덱스 | `account`를 읽는 방법 | 버퍼 hit | 버퍼 read | 블록 장치 읽기 중앙(MB) | 라인 노드 예상 / 실제 | 거래 노드 예상 / 실제 | 조인 예상 / 실제 | 앞 상태와 계획 모양 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | V9 (1·2) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 148,541~148,657 | 125,397~125,513 | 826.1~842.5 | 453 / 5,498 ×10 | 1 / 1 ×54,981 | 1,445 / 53,326 |  |
| 장부 전체 잔액 | 큰 | 리터럴 | V9 FULL (3) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 155,672~155,752 | 118,310~118,390 | 749.9 | 451 / 5,498 ×10 | 1 / 1 ×54,981 | 1,443 / 53,326 | 같음 |
| 장부 전체 잔액 | 큰 | 리터럴 | V12 FULL (4·5) | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` | `ix_transaction_ledger_occurred_on` | Seq Scan | 329~333 | 100,108~100,112 | 324.6~387.8 | 22,648 / 18,327 ×3 | 20,505 / 16,166 ×3 | 7,324 / 17,775 ×3 | **다름** |
| 장부 전체 잔액 | 큰 | 리터럴 | V12 바로 시드 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` | `ix_transaction_ledger_occurred_on` | Seq Scan | 329~333 | 100,158~100,162 | 291.9 | 23,486 / 18,327 ×3 | 20,603 / 16,166 ×3 | 7,585 / 17,775 ×3 | 같음 |
| 장부 전체 잔액 | 큰 | 일반 계획 | V9 (1·2) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 148,574~148,656 | 125,398~125,480 | 832.0~840.8 | 453 / 5,498 ×10 | 1 / 1 ×54,981 | 585 / 53,326 |  |
| 장부 전체 잔액 | 큰 | 일반 계획 | V9 FULL (3) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 155,685~155,756 | 118,306~118,377 | 735.5 | 451 / 5,498 ×10 | 1 / 1 ×54,981 | 584 / 53,326 | 같음 |
| 장부 전체 잔액 | 큰 | 일반 계획 | V12 FULL (4·5) | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 306,877~307,159 | 96,864~97,146 | 535.7~561.3 | 1 / 1 ×48,499 | 878 / 24,250 ×2 | 1 / 26,663 ×2 | **다름** |
| 장부 전체 잔액 | 큰 | 일반 계획 | V12 바로 시드 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 283,392~283,439 | 120,635~120,682 | 491.0 | 1 / 1 ×48,499 | 878 / 24,250 ×2 | 1 / 26,663 ×2 | 같음 |
| 장부 전체 잔액 | 보통 | 리터럴 | V9 (1·2) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,466 | 0 | 0.0 | 453 / 548 ×6 | 1 / 1 ×3,289 | 1,012 / 3,192 |  |
| 장부 전체 잔액 | 보통 | 리터럴 | V9 FULL (3) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,468 | 0 | 0.0 | 451 / 548 ×6 | 1 / 1 ×3,289 | 1,010 / 3,192 | 같음 |
| 장부 전체 잔액 | 보통 | 리터럴 | V12 FULL (4·5) | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,890 | 0 | 0.0 | 1 / 1 ×2,912 | 1,702 / 1,456 ×2 | 624 / 1,596 ×2 | **다름** |
| 장부 전체 잔액 | 보통 | 리터럴 | V12 바로 시드 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,901 | 0 | 0.0 | 1 / 1 ×2,912 | 1,699 / 1,456 ×2 | 624 / 1,596 ×2 | 같음 |
| 장부 전체 잔액 | 보통 | 일반 계획 | V9 (1·2) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,466 | 0 | 0.0 | 453 / 548 ×6 | 1 / 1 ×3,289 | 585 / 3,192 |  |
| 장부 전체 잔액 | 보통 | 일반 계획 | V9 FULL (3) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,468 | 0 | 0.0 | 451 / 548 ×6 | 1 / 1 ×3,289 | 584 / 3,192 | 같음 |
| 장부 전체 잔액 | 보통 | 일반 계획 | V12 FULL (4·5) | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,247 | 0 | 0.0 | 1 / 1 ×2,912 | 878 / 1,456 ×2 | 1 / 1,596 ×2 | **다름** |
| 장부 전체 잔액 | 보통 | 일반 계획 | V12 바로 시드 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,258 | 0 | 0.0 | 1 / 1 ×2,912 | 878 / 1,456 ×2 | 1 / 1,596 ×2 | 같음 |
| 계좌 하나 잔액 | 큰 | 리터럴 | V9 (1·2) | Nested Loop (병렬, 작업자 2) | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 55,923~55,925 | 0~2 | 0.0 | 4,986 / 3,749 ×3 | 1 / 1 ×11,247 | 4,838 / 3,644 ×3 |  |
| 계좌 하나 잔액 | 큰 | 리터럴 | V9 FULL (3) | Nested Loop (병렬, 작업자 2) | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 55,920~55,927 | 0~7 | 0.0 | 5,406 / 3,749 ×3 | 1 / 1 ×11,247 | 5,239 / 3,644 ×3 | 같음 |
| 계좌 하나 잔액 | 큰 | 리터럴 | V12 FULL (4·5) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 55,113 | 0 | 0.0 | 196 / 11,247 | 1 / 1 ×11,247 | 190 / 10,932 | **다름** |
| 계좌 하나 잔액 | 큰 | 리터럴 | V12 바로 시드 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 56,220 | 0 | 0.0 | 165 / 11,247 | 1 / 1 ×11,247 | 160 / 10,932 | 같음 |
| 계좌 하나 잔액 | 큰 | 일반 계획 | V9 (1·2) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 55,923 | 0 | 0.0 | 453 / 11,247 | 1 / 1 ×11,247 | 74 / 10,932 |  |
| 계좌 하나 잔액 | 큰 | 일반 계획 | V9 FULL (3) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 55,925 | 0 | 0.0 | 451 / 11,247 | 1 / 1 ×11,247 | 74 / 10,932 | 같음 |
| 계좌 하나 잔액 | 큰 | 일반 계획 | V12 FULL (4·5) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 55,113 | 0 | 0.0 | 1 / 11,247 | 1 / 1 ×11,247 | 1 / 10,932 | **다름** |
| 계좌 하나 잔액 | 큰 | 일반 계획 | V12 바로 시드 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 56,220 | 0 | 0.0 | 1 / 11,247 | 1 / 1 ×11,247 | 1 / 10,932 | 같음 |
| 계좌 하나 잔액 | 보통 | 리터럴 | V9 (1·2) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,623 | 0 | 0.0 | 433 / 924 | 1 / 1 ×924 | 420 / 899 |  |
| 계좌 하나 잔액 | 보통 | 리터럴 | V9 FULL (3) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,624 | 0 | 0.0 | 431 / 924 | 1 / 1 ×924 | 418 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 리터럴 | V12 FULL (4·5) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,621 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | **다름** |
| 계좌 하나 잔액 | 보통 | 리터럴 | V12 바로 시드 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,623 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V9 (1·2) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,623 | 0 | 0.0 | 453 / 924 | 1 / 1 ×924 | 74 / 899 |  |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V9 FULL (3) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,624 | 0 | 0.0 | 451 / 924 | 1 / 1 ×924 | 74 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V12 FULL (4·5) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,621 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | **다름** |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V12 바로 시드 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,623 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | 같음 |

#### `perf_l1000_3m`

| 쿼리 | 장부 | 방식 | 상태(회차) | 조인 | 훑는 테이블(Seq Scan) | 쓰인 인덱스 | `account`를 읽는 방법 | 버퍼 hit | 버퍼 read | 블록 장치 읽기 중앙(MB) | 라인 노드 예상 / 실제 | 거래 노드 예상 / 실제 | 조인 예상 / 실제 | 앞 상태와 계획 모양 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 보통 | 리터럴 | V9 (1·2) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,466 | 0 | 0.0 | 446 / 548 ×6 | 1 / 1 ×3,289 | 996 / 3,192 |  |
| 장부 전체 잔액 | 보통 | 리터럴 | V9 FULL (3) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,467 | 0 | 0.0 | 443 / 548 ×6 | 1 / 1 ×3,289 | 997 / 3,192 | 같음 |
| 장부 전체 잔액 | 보통 | 리터럴 | V12 FULL (4·5) | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,890 | 0 | 0.0 | 1 / 1 ×2,912 | 1,705 / 1,456 ×2 | 624 / 1,596 ×2 | **다름** |
| 장부 전체 잔액 | 보통 | 리터럴 | V12 바로 시드 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,895 | 0 | 0.0 | 1 / 1 ×2,912 | 1,704 / 1,456 ×2 | 625 / 1,596 ×2 | 같음 |
| 장부 전체 잔액 | 보통 | 일반 계획 | V9 (1·2) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,466 | 0 | 0.0 | 446 / 548 ×6 | 1 / 1 ×3,289 | 575 / 3,192 |  |
| 장부 전체 잔액 | 보통 | 일반 계획 | V9 FULL (3) | Nested Loop | 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | Bitmap Heap Scan `uq_account_name` | 16,467 | 0 | 0.0 | 443 / 548 ×6 | 1 / 1 ×3,289 | 575 / 3,192 | 같음 |
| 장부 전체 잔액 | 보통 | 일반 계획 | V12 FULL (4·5) | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,249 | 0 | 0.0 | 1 / 1 ×2,912 | 865 / 1,456 ×2 | 1 / 1,596 ×2 | **다름** |
| 장부 전체 잔액 | 보통 | 일반 계획 | V12 바로 시드 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,254 | 0 | 0.0 | 1 / 1 ×2,912 | 865 / 1,456 ×2 | 1 / 1,596 ×2 | 같음 |
| 계좌 하나 잔액 | 보통 | 리터럴 | V9 (1·2) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,623 | 0 | 0.0 | 431 / 924 | 1 / 1 ×924 | 418 / 899 |  |
| 계좌 하나 잔액 | 보통 | 리터럴 | V9 FULL (3) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,624 | 0 | 0.0 | 428 / 924 | 1 / 1 ×924 | 415 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 리터럴 | V12 FULL (4·5) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,622 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | **다름** |
| 계좌 하나 잔액 | 보통 | 리터럴 | V12 바로 시드 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,623 | 0 | 0.0 | 2 / 924 | 1 / 1 ×924 | 2 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V9 (1·2) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,623 | 0 | 0.0 | 446 / 924 | 1 / 1 ×924 | 73 / 899 |  |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V9 FULL (3) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,624 | 0 | 0.0 | 443 / 924 | 1 / 1 ×924 | 72 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V12 FULL (4·5) | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,622 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | **다름** |
| 계좌 하나 잔액 | 보통 | 일반 계획 | V12 바로 시드 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,623 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | 같음 |

- JIT는 V12의 장부 전체 잔액 큰 장부 리터럴에서만 7번 모두 켜졌다(V9의 모든 칸과 다른 조건은 JIT 없음). 계획 원문의 `JIT:` 줄에 시간이 있다.
- V9의 세 회차(FULL 포함)에서 장부 전체 잔액의 계획은 모든 조건에서 같은 모양이다. `VACUUM (FULL, ANALYZE)` 뒤에는 read가 12만 5천대에서 11만 8천대로, hit가 14만 8천대에서 15만 5천대로 바뀌었다(합은 27만 4천 안팎으로 같다).
- `account`를 Seq Scan으로 읽는 V12 리터럴은 큰 장부에서 프로세스 3개가 각각 101블록(hit 303), 보통 장부에서 프로세스 2개가 각각 101블록(hit 202)을 읽는다(계획 원문).

### 4.3 V10~V12 적용 시간

V9 FULL 상태에서 PostgreSQL을 재시작하고 파일을 OS 캐시에서 내린(`fresh`) 뒤, 파일마다 한 트랜잭션으로 적용했다(psql `\timing`). 한 번씩만 쟀다. Flyway를 거치지 않았다.

| DB | 파일 | 문장별 시간(ms) | 합(커밋 포함) | load 1분(시작 → 끝) |
|---|---|---|---|---|
| `perf_mix_50k` | V10 | 유니크 거래 735.0, 유니크 계좌 3.1, 유니크 카테고리 8.7, 열 추가 0.7, 커밋 4.8 | 0.75초 | 10.33 → 10.33 |
| `perf_mix_50k` | V11 | UPDATE 422,982.8, 커밋 17.8 | 423.0초 | 10.33 → 26.65 |
| `perf_mix_50k` | V12 | `NOT NULL`과 FK 교체(한 문장) 6,403.5, 커밋 2.2 | 6.4초 | 26.65 → 24.91 |
| `perf_l1000_3m` | V10 | 3,148.4 / 5.9 / 11.1 / 1.0, 커밋 8.6 | 3.2초 | 31.21 → 31.21 |
| `perf_l1000_3m` | V11 | 284,571.7, 커밋 4.3 | 284.6초 | 31.21 → 6.62 |
| `perf_l1000_3m` | V12 | 4,196.0, 커밋 16.2 | 4.2초 | 6.62 → 6.25 |

- V10의 문장은 파일 순서대로 유니크 셋(`transaction`, `account`, `category`)과 열 추가다.
- V11이 도는 동안 `transaction_line`은 355,549,184바이트에서 766,222,336바이트로 커졌다(`perf_mix_50k`, 적용 직후). 뒤의 `VACUUM (FULL, ANALYZE)` 뒤 410,673,152바이트다.

### 4.4 V12에 바로 시드한 DB

V1~V12를 적용한 빈 DB에 지금 시드를 넣은 `perf_mix_50k_new`, `perf_l1000_3m_new`를 이관한 DB(V12 FULL)와 견줬다.

| 확인 | `perf_mix_50k` | `perf_l1000_3m` |
|---|---|---|
| 건수와 모든 열의 내용 해시(`ledger_id` 포함) | 일곱 테이블 모두 같다 | 일곱 테이블 모두 같다 |
| 저장 위치 해시 | `transaction`, `transaction_line`이 다르다(나머지 다섯은 같다) | `transaction`, `transaction_line`이 다르다(나머지 다섯은 같다) |
| 장부 1001의 라인이 있는 블록 수 | 이관 32,137 / 바로 시드 49,584 | 큰 장부 없음 |
| 새 유니크의 크기 | `uq_transaction_id_ledger` 이관 151,281,664 / 바로 시드 195,346,432 | 148,807,680 / 190,726,144 |
| 계획 모양 | 여덟 조건(두 쿼리 × 두 장부 × 리터럴·일반) 모두 같다 | 네 조건 모두 같다 |

- 바로 시드한 DB의 시간은 4.2의 "V12 바로 시드" 칸에 있다. 버퍼는 큰 장부의 장부 전체 잔액 일반 계획에서 hit 283,392~283,439 / read 120,635~120,682로 이관 DB(hit 306,877~307,159 / read 96,864~97,146)와 다르다. 큰 장부 리터럴은 hit 329~333으로 같고 read가 100,158~100,162다(이관 100,108~100,112).

### 4.5 예상 행 수

PR #170은 계좌 하나 잔액의 라인 예상이 작은 데이터에서 1,067 → 356(실제 1,067)이 된다고 적었다. 큰 데이터에서 같은 문장의 라인 노드 예상과 실제는 다음과 같다(V9 FULL → V12 FULL. 실제는 두 쪽이 같다).

| DB | 장부 | 방식 | 라인 노드 예상 V9 → V12 | 실제 | 조인 예상 V9 → V12 | 실제 | 바뀐 것 |
|---|---|---|---|---|---|---|---|
| `perf_mix_50k` | 큰 | 리터럴 | 5,406 ×3 프로세스(표의 라인 노드는 프로세스당) → 196 | 11,247 | 5,239 ×3 → 190 | 10,932 | 병렬(작업자 2) → 비병렬. 거래 인덱스 `transaction_pkey` → `uq_transaction_id_ledger` |
| `perf_mix_50k` | 큰 | 일반 계획 | 451 → 1 | 11,247 | 74 → 1 | 10,932 | 거래 인덱스만 |
| `perf_mix_50k` | 보통 | 리터럴 | 431 → 1 | 924 | 418 → 1 | 899 | 거래 인덱스만 |
| `perf_mix_50k` | 보통 | 일반 계획 | 451 → 1 | 924 | 74 → 1 | 899 | 거래 인덱스만 |
| `perf_l1000_3m` | 보통 | 리터럴 | 428 → 1 | 924 | 415 → 1 | 899 | 거래 인덱스만 |
| `perf_l1000_3m` | 보통 | 일반 계획 | 443 → 1 | 924 | 72 → 1 | 899 | 거래 인덱스만 |

- 여섯 조건 모두 조인 방식은 중첩 루프로 같고, 라인은 `ix_transaction_line_account`로 찾는다(앞뒤 같음). 훑기는 없다.
- 장부 전체 잔액의 예상과 계획 변화는 4.2의 계획 표에 있다.

### 4.6 dba 후보

기준 DB는 V12(`perf_mix_50k`, 이관한 V12 FULL의 사본)다. (a0)은 확장 통계 없이 `ANALYZE transaction_line`을 세 번 한 회차로, 통계 표본이 바뀌는 몫을 가르려고 두었다.

#### (a) `CREATE STATISTICS s (dependencies) ON account_id, ledger_id FROM transaction_line` 뒤 `ANALYZE`

- 만드는 시간: `CREATE STATISTICS` 5.740ms(load 11.05).
- 모으는 시간(`ANALYZE transaction_line`, 세 번): 확장 통계 없이 369.7 / 353.5 / 326.8ms(load 12.49), 있을 때 355.9 / 278.6 / 205.0ms(load 11.05~10.80).
- 저장된 값(`pg_statistic_ext_data.stxddependencies`): 27바이트, `{"3 => 7": 1.000000}`(열 3 `account_id` → 열 7 `ledger_id`).
- 예상과 계획: 아래 표.

시간(ms)과 load:

| 쿼리 | 장부 | 방식 | (0) 지금 | (a0) `ANALYZE`만 | (a) 확장 통계 |
|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | 227.4 / 275.4 / 313.9<br>load 45.8 | 276.1 / 300.5 / 368.1<br>load 12.21~12.49 | 368.2 / 460.0 / 582.0<br>load 10.8~10.98 |
| 장부 전체 잔액 | 큰 | 일반 계획 | 1,364.8 / 1,877.2 / 2,175.7<br>load 37.31~45.8 | 1,109.4 / 1,201.2 / 1,507.4<br>load 11.05~12.21 | 988.5 / 1,258.2 / 1,279.6<br>load 10.95~10.98 |
| 장부 전체 잔액 | 보통 | 리터럴 | 14.823 / 16.099 / 18.210<br>load 37.31 | 13.957 / 14.462 / 14.783<br>load 11.05 | 14.009 / 14.283 / 16.361<br>load 10.95 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 11.941 / 13.525 / 15.382<br>load 37.31 | 13.862 / 14.796 / 15.946<br>load 11.05 | 15.745 / 16.962 / 20.656<br>load 10.95 |
| 계좌 하나 잔액 | 큰 | 리터럴 | 37.584 / 38.626 / 41.561<br>load 37.31 | 33.778 / 35.276 / 36.461<br>load 11.05 | 26.230 / 27.578 / 39.911<br>load 10.95 |
| 계좌 하나 잔액 | 큰 | 일반 계획 | 34.922 / 38.087 / 48.431<br>load 37.31 | 43.898 / 47.210 / 52.464<br>load 11.05 | 612.8 / 628.6 / 656.1<br>load 10.31~10.95 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 2.099 / 2.336 / 2.599<br>load 34.64~37.31 | 3.078 / 3.342 / 3.716<br>load 11.05 | 1.869 / 2.010 / 2.451<br>load 10.31 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 2.133 / 2.215 / 2.422<br>load 34.64 | 3.139 / 3.506 / 4.372<br>load 11.05 | 2.433 / 2.588 / 2.703<br>load 10.31 |

계획과 버퍼:

| 쿼리 | 장부 | 방식 | 상태(회차) | 조인 | 훑는 테이블(Seq Scan) | 쓰인 인덱스 | `account`를 읽는 방법 | 버퍼 hit | 버퍼 read | 블록 장치 읽기 중앙(MB) | 라인 노드 예상 / 실제 | 거래 노드 예상 / 실제 | 조인 예상 / 실제 | 앞 상태와 계획 모양 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | (0) 지금 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` | `ix_transaction_ledger_occurred_on` | Seq Scan | 329~333 | 100,108~100,112 | 301.7 | 22,648 / 18,327 ×3 | 20,505 / 16,166 ×3 | 7,324 / 17,775 ×3 |  |
| 장부 전체 잔액 | 큰 | 리터럴 | (a0) `ANALYZE`만 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` | `ix_transaction_ledger_occurred_on` | Seq Scan | 329~333 | 100,108~100,112 | 288.7 | 22,647 / 18,327 ×3 | 20,505 / 16,166 ×3 | 7,323 / 17,775 ×3 | 같음 |
| 장부 전체 잔액 | 큰 | 리터럴 | (a) 확장 통계 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` | `ix_transaction_ledger_occurred_on` | Seq Scan | 329~333 | 100,108~100,112 | 413.3 | 22,089 / 18,327 ×3 | 20,505 / 16,166 ×3 | 7,143 / 17,775 ×3 | 같음 |
| 장부 전체 잔액 | 큰 | 일반 계획 | (0) 지금 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 306,946~307,060 | 96,963~97,077 | 581.1 | 1 / 1 ×48,499 | 878 / 24,250 ×2 | 1 / 26,663 ×2 |  |
| 장부 전체 잔액 | 큰 | 일반 계획 | (a0) `ANALYZE`만 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 306,964~307,045 | 96,978~97,059 | 596.9 | 1 / 1 ×48,499 | 878 / 24,250 ×2 | 1 / 26,663 ×2 | 같음 |
| 장부 전체 잔액 | 큰 | 일반 계획 | (a) 확장 통계 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 307,035~307,172 | 96,851~96,988 | 462.6 | 1 / 1 ×48,499 | 878 / 24,250 ×2 | 1 / 26,663 ×2 | 같음 |
| 장부 전체 잔액 | 보통 | 리터럴 | (0) 지금 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,890 | 0 | 0.0 | 1 / 1 ×2,912 | 1,702 / 1,456 ×2 | 624 / 1,596 ×2 |  |
| 장부 전체 잔액 | 보통 | 리터럴 | (a0) `ANALYZE`만 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,890 | 0 | 0.0 | 1 / 1 ×2,912 | 1,702 / 1,456 ×2 | 626 / 1,596 ×2 | 같음 |
| 장부 전체 잔액 | 보통 | 리터럴 | (a) 확장 통계 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,890 | 0 | 0.0 | 1 / 1 ×2,912 | 1,702 / 1,456 ×2 | 625 / 1,596 ×2 | 같음 |
| 장부 전체 잔액 | 보통 | 일반 계획 | (0) 지금 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,247 | 0 | 0.0 | 1 / 1 ×2,912 | 878 / 1,456 ×2 | 1 / 1,596 ×2 |  |
| 장부 전체 잔액 | 보통 | 일반 계획 | (a0) `ANALYZE`만 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,247 | 0 | 0.0 | 1 / 1 ×2,912 | 878 / 1,456 ×2 | 1 / 1,596 ×2 | 같음 |
| 장부 전체 잔액 | 보통 | 일반 계획 | (a) 확장 통계 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,247 | 0 | 0.0 | 1 / 1 ×2,912 | 878 / 1,456 ×2 | 1 / 1,596 ×2 | 같음 |
| 계좌 하나 잔액 | 큰 | 리터럴 | (0) 지금 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 55,113 | 0 | 0.0 | 196 / 11,247 | 1 / 1 ×11,247 | 190 / 10,932 |  |
| 계좌 하나 잔액 | 큰 | 리터럴 | (a0) `ANALYZE`만 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 55,113 | 0 | 0.0 | 187 / 11,247 | 1 / 1 ×11,247 | 181 / 10,932 | **다름** |
| 계좌 하나 잔액 | 큰 | 리터럴 | (a) 확장 통계 | Nested Loop (병렬, 작업자 2) | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 55,115 | 0 | 0.0 | 4,753 / 3,749 ×3 | 1 / 1 ×11,247 | 4,611 / 3,644 ×3 | **다름** |
| 계좌 하나 잔액 | 큰 | 일반 계획 | (0) 지금 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 55,113 | 0 | 0.0 | 1 / 11,247 | 1 / 1 ×11,247 | 1 / 10,932 |  |
| 계좌 하나 잔액 | 큰 | 일반 계획 | (a0) `ANALYZE`만 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 55,113 | 0 | 0.0 | 1 / 11,247 | 1 / 1 ×11,247 | 1 / 10,932 | 같음 |
| 계좌 하나 잔액 | 큰 | 일반 계획 | (a) 확장 통계 | Hash Join | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_account` | 없음 | 1 | 60,101 | 82.8 | 451 / 11,247 | 497 / 48,499 | 1 / 10,932 | **다름** |
| 계좌 하나 잔액 | 보통 | 리터럴 | (0) 지금 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,621 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 |  |
| 계좌 하나 잔액 | 보통 | 리터럴 | (a0) `ANALYZE`만 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,621 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 리터럴 | (a) 확장 통계 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 4,621 | 0 | 0.0 | 431 / 924 | 1 / 1 ×924 | 418 / 899 | **다름** |
| 계좌 하나 잔액 | 보통 | 일반 계획 | (0) 지금 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,621 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 |  |
| 계좌 하나 잔액 | 보통 | 일반 계획 | (a0) `ANALYZE`만 | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 4,621 | 0 | 0.0 | 1 / 924 | 1 / 1 ×924 | 1 / 899 | 같음 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | (a) 확장 통계 | Hash Join | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_account` | 없음 | 3,942 | 0 | 0.0 | 451 / 924 | 497 / 2,912 | 1 / 899 | **다름** |

- 장부 전체 잔액의 네 조건(두 장부, 리터럴·일반)은 (0), (a0), (a)의 계획 모양이 모두 같다.
- 계좌 하나 잔액은 (a)에서 세 조건이 바뀌었다: 큰 장부 리터럴은 병렬(작업자 2)이 되고, 큰 장부와 보통 장부의 일반 계획은 `ix_transaction_ledger_occurred_on`과 `ix_transaction_line_account`를 읽어 해시 조인한다. (a0)에서 바뀐 것은 큰 장부 리터럴의 거래 인덱스 이름(`uq_transaction_id_ledger` → `transaction_pkey`)뿐이다.
- 라인 노드 예상(계좌 하나 잔액, 리터럴): 큰 장부 (0) 196, (a0) 187, (a) 4,753 ×3(병렬). 보통 장부 (0)·(a0) 1, (a) 431. 실제는 11,247, 924다. 일반 계획의 라인 예상은 큰·보통 모두 1 → 451이다.
- 큰 장부 계좌 하나 잔액의 (a) 일반 계획: `transaction` 노드 예상 497 / 실제 48,499, 조인 예상 1 / 실제 10,932. 버퍼 hit 1 / read 60,101.

#### (b) `balances`에서 account 조인을 없앤 문장

- **결과가 같은지**: 앱이 보내는 `balances`와 후보 두 문장을 1,001개 장부 모두에 문장 그대로 돌려(계좌 id가 장부끼리 겹치지 않으므로 이어 붙여 비교) 결과가 같다. 시드 상태 7,510행, 기준일을 흩뜨린 사본(`opening_date + (hashtext(id) & 4095)`일) 6,764행 모두 차이 0이다. 흩뜨린 사본에서는 기준일 조건이 거래를 걸러 결과가 시드 상태와 다르다. 비교는 리터럴로만 했고 일반 계획의 결과는 견주지 않았다.
- **(b1) 배열**: `unnest(계좌 id 배열, 기준일 배열)`과 조인해 라인 쪽에서 기준일을 견준다. 문장: [`perf/queries/candidates/balances-unnest.sql`](../../../perf/queries/candidates/balances-unnest.sql). 앱에서: 이미 읽은 계좌의 id와 기준일을 배열 둘로 보낸다. **파라미터 5개**(계좌 id 배열, 기준일 배열, 장부, 장부, 취소 상태)로 계좌 수와 관계없다. JPQL 대신 네이티브 쿼리 자리다(앱에서 실행해 보지 않았다).
- **(b2) 계좌별 LATERAL**: 같은 배열을 계좌마다의 부분 쿼리로 합한다. 문장: [`perf/queries/candidates/balances-lateral.sql`](../../../perf/queries/candidates/balances-lateral.sql). **파라미터 5개**(같은 다섯)다. 합할 라인이 없는 계좌는 지금처럼 행이 나오지 않는다.
- 두 문장만 쟀다(스펙: 안을 둘까지). `VALUES` 목록 형태와 `a.ledger_id`를 더하는 안은 재지 않았다(뒤의 것은 dba가 재서 버렸다).

시간(ms)과 load((0)은 같은 사본에서 잰 지금 문장이다):

| 쿼리 | 장부 | 방식 | (0) 지금 | (b1) 배열 `unnest` | (b2) 계좌별 `LATERAL` |
|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | 227.4 / 275.4 / 313.9<br>load 45.8 | 2,091.9 / 2,173.6 / 2,814.3<br>load 24.87~34.64 | 2,650.8 / 2,981.4 / 4,124.9<br>load 14.5~18.09 |
| 장부 전체 잔액 | 큰 | 일반 계획 | 1,364.8 / 1,877.2 / 2,175.7<br>load 37.31~45.8 | 2,230.2 / 2,716.9 / 5,103.3<br>load 18.09~24.87 | 3,264.8 / 3,922.1 / 4,495.9<br>load 13.06~14.5 |
| 장부 전체 잔액 | 보통 | 리터럴 | 14.823 / 16.099 / 18.210<br>load 37.31 | 10.211 / 11.466 / 12.165<br>load 18.09 | 9.209 / 10.276 / 10.683<br>load 13.06 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 11.941 / 13.525 / 15.382<br>load 37.31 | 10.520 / 11.458 / 11.726<br>load 18.09 | 8.865 / 12.878 / 18.607<br>load 13.06 |

계획과 버퍼:

| 쿼리 | 장부 | 방식 | 상태(회차) | 조인 | 훑는 테이블(Seq Scan) | 쓰인 인덱스 | `account`를 읽는 방법 | 버퍼 hit | 버퍼 read | 블록 장치 읽기 중앙(MB) | 라인 노드 예상 / 실제 | 거래 노드 예상 / 실제 | 조인 예상 / 실제 | 앞 상태와 계획 모양 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | (0) 지금 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` | `ix_transaction_ledger_occurred_on` | Seq Scan | 329~333 | 100,108~100,112 | 301.7 | 22,648 / 18,327 ×3 | 20,505 / 16,166 ×3 | 7,324 / 17,775 ×3 |  |
| 장부 전체 잔액 | 큰 | 리터럴 | (b1) 배열 `unnest` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 162,316~162,468 | 109,341~109,493 | 873.5 | 7 / 5,498 ×10 | 1 / 1 ×54,981 | 24 / 53,326 | **다름** |
| 장부 전체 잔액 | 큰 | 리터럴 | (b2) 계좌별 `LATERAL` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 150,958~150,994 | 120,815~120,851 | 949.0 | 7 / 5,498 ×10 | 1 / 1 ×54,981 | 10 / 10 | **다름** |
| 장부 전체 잔액 | 큰 | 일반 계획 | (0) 지금 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 306,946~307,060 | 96,963~97,077 | 581.1 | 1 / 1 ×48,499 | 878 / 24,250 ×2 | 1 / 26,663 ×2 |  |
| 장부 전체 잔액 | 큰 | 일반 계획 | (b1) 배열 `unnest` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 162,310~162,470 | 109,339~109,499 | 852.5 | 1 / 5,498 ×10 | 1 / 1 ×54,981 | 1 / 53,326 | **다름** |
| 장부 전체 잔액 | 큰 | 일반 계획 | (b2) 계좌별 `LATERAL` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 150,965~150,995 | 120,814~120,844 | 933.6 | 1 / 5,498 ×10 | 1 / 1 ×54,981 | 10 / 10 | **다름** |
| 장부 전체 잔액 | 보통 | 리터럴 | (0) 지금 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction` | Seq Scan | 14,890 | 0 | 0.0 | 1 / 1 ×2,912 | 1,702 / 1,456 ×2 | 624 / 1,596 ×2 |  |
| 장부 전체 잔액 | 보통 | 리터럴 | (b1) 배열 `unnest` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 16,458 | 0 | 0.0 | 1 / 548 ×6 | 1 / 1 ×3,289 | 1 / 3,192 | **다름** |
| 장부 전체 잔액 | 보통 | 리터럴 | (b2) 계좌별 `LATERAL` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 16,458 | 0 | 0.0 | 1 / 548 ×6 | 1 / 1 ×3,289 | 6 / 6 | **다름** |
| 장부 전체 잔액 | 보통 | 일반 계획 | (0) 지금 | Nested Loop (병렬, 작업자 1) | 없음 | `ix_transaction_ledger_occurred_on`<br>`ix_transaction_line_transaction`<br>`account_pkey` | Index Scan `account_pkey` | 24,247 | 0 | 0.0 | 1 / 1 ×2,912 | 878 / 1,456 ×2 | 1 / 1,596 ×2 |  |
| 장부 전체 잔액 | 보통 | 일반 계획 | (b1) 배열 `unnest` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 없음 | 16,458 | 0 | 0.0 | 1 / 548 ×6 | 1 / 1 ×3,289 | 1 / 3,192 | **다름** |
| 장부 전체 잔액 | 보통 | 일반 계획 | (b2) 계좌별 `LATERAL` | Nested Loop | 없음 | `ix_transaction_line_account`<br>`uq_transaction_id_ledger` | 없음 | 16,458 | 0 | 0.0 | 1 / 548 ×6 | 1 / 1 ×3,289 | 10 / 6 | **다름** |

- 두 후보의 계획에는 `account`가 없다. 라인은 큰 장부·보통 장부 모두 `ix_transaction_line_account`로, 거래는 (b1) `transaction_pkey`, (b2) `uq_transaction_id_ledger`로 찾는다. 두 문장 모두 네 조건(두 장부, 리터럴·일반)에서 중첩 루프이고 훑기가 없다.
- 큰 장부 리터럴의 (0)은 병렬 해시 조인이고 `transaction_line`과 `account`를 훑는다. 두 후보는 훑기가 없지만 버퍼가 (0)의 약 2.7배다(hit + read의 합 (0) 100,441, (b1) 271,809, (b2) 271,809).
- 예상: (b1)과 (b2)의 라인 노드 예상은 리터럴 7(큰) / 1(보통), 일반 계획 1이고 실제는 계좌당 5,498 / 548이다.

### 4.7 넣기 비용, 유니크 셋, 복합 FK

거래 1,000건(라인 1,100건)을 한 트랜잭션으로 넣는 시간이다(`perf/insert-cost.sql`, 두 INSERT와 COMMIT의 합). 장부 1~1000에 하나씩, 날짜는 2026-10-31이다. V9 사본(`_ins9`)과 V12 사본(`_ins12`, 둘 다 `VACUUM (FULL, ANALYZE)` 뒤의 상태)에서 V9 → V12 → V9 → V12 순서로 두 번 했다. 한 묶음은 여섯 회이고 첫 회(데우기)를 버리고 5회를 센다. 묶음을 시작할 때마다 `fresh`를 했고, 넣은 것은 되돌리지 않았다.

| DB | 스키마 | 번 | load 1분 | 데우기(버림, ms) | 5번 (ms, 두 INSERT + COMMIT) | 중앙(ms) | 거래 INSERT | 라인 INSERT | COMMIT | 버퍼 read | FPI | WAL 레코드 | WAL(MB) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `perf_mix_50k` | V9 | 1 | 5.43 | 945.9 | 501.7 / 408.8 / 382.8 / 316.3 / 266.1 | 382.8 | 150.5 / 122.7 / 138.1 / 100.2 / 88.1 | 346.3 / 281.3 / 239.0 / 215.4 / 174.7 | 4.9 / 4.8 / 5.7 / 0.6 / 3.3 | 3,418 / 3,017 / 2,680 / 2,373 / 2,078 | 3,413 / 3,012 / 2,680 / 2,373 / 2,078 | 7,400 / 7,400 / 7,401 / 7,400 / 7,401 | 24.61 / 21.82 / 19.49 / 17.36 / 15.31 |
| `perf_mix_50k` | V12 | 1 | 5.06~5.24 | 571.4 | 459.3 / 379.3 / 304.3 / 242.6 / 233.2 | 304.3 | 243.8 / 225.9 / 127.4 / 101.2 / 114.1 | 212.6 / 147.5 / 172.4 / 137.0 / 113.6 | 2.9 / 5.8 / 4.5 / 4.5 / 5.5 | 4,346 / 3,893 / 3,514 / 3,139 / 2,827 | 4,341 / 3,888 / 3,514 / 3,139 / 2,827 | 8,400 / 8,400 / 8,401 / 8,400 / 8,401 | 31.24 / 28.09 / 25.46 / 22.85 / 20.68 |
| `perf_mix_50k` | V9 | 2 | 5.06~5.29 | 507.7 | 419.7 / 312.5 / 300.4 / 318.5 / 303.5 | 312.5 | 129.4 / 104.0 / 85.1 / 108.5 / 98.7 | 289.0 / 204.5 / 212.6 / 206.7 / 201.0 | 1.3 / 4.0 / 2.6 / 3.3 / 3.8 | 3,369 / 3,038 / 2,706 / 2,376 / 2,070 | 3,369 / 3,038 / 2,706 / 2,376 / 2,070 | 7,401 / 7,401 / 7,401 / 7,402 / 7,403 | 24.37 / 22.05 / 19.72 / 17.42 / 15.28 |
| `perf_mix_50k` | V12 | 2 | 5.29~5.43 | 421.4 | 307.8 / 287.1 / 274.9 / 274.5 / 204.9 | 274.9 | 118.7 / 136.1 / 122.9 / 131.7 / 93.5 | 181.6 / 146.2 / 145.6 / 138.5 / 108.2 | 7.5 / 4.8 / 6.4 / 4.3 / 3.1 | 4,283 / 3,907 / 3,551 / 3,179 / 2,797 | 4,283 / 3,907 / 3,551 / 3,179 / 2,797 | 8,401 / 8,401 / 8,401 / 8,402 / 8,403 | 30.92 / 28.28 / 25.78 / 23.19 / 20.51 |
| `perf_l1000_3m` | V9 | 1 | 5.71 | 527.7 | 358.8 / 302.2 / 276.3 / 187.2 / 225.2 | 276.3 | 119.8 / 92.6 / 86.8 / 66.9 / 66.5 | 237.6 / 205.7 / 184.6 / 114.3 / 151.9 | 1.4 / 4.0 / 4.9 / 6.0 / 6.7 | 3,427 / 2,998 / 2,661 / 2,361 / 2,078 | 3,419 / 2,998 / 2,661 / 2,361 / 2,078 | 7,400 / 7,400 / 7,401 / 7,400 / 7,401 | 24.65 / 21.72 / 19.36 / 17.28 / 15.31 |
| `perf_l1000_3m` | V12 | 1 | 8.62~19.38 | 1797.1 | 1535.3 / 715.6 / 791.5 / 1116.9 / 632.0 | 791.5 | 639.6 / 162.6 / 265.4 / 658.4 / 212.8 | 891.4 / 543.9 / 512.8 / 455.3 / 416.9 | 4.4 / 9.1 / 13.3 / 3.2 / 2.3 | 4,341 / 3,871 / 3,494 / 3,132 / 2,822 | 4,333 / 3,871 / 3,494 / 3,132 / 2,822 | 8,400 / 8,400 / 8,401 / 8,400 / 8,401 | 31.19 / 27.96 / 25.33 / 22.81 / 20.65 |
| `perf_l1000_3m` | V9 | 2 | 17.99 | 539.9 | 322.6 / 285.2 / 320.4 / 260.3 / 199.7 | 285.2 | 84.0 / 80.8 / 98.2 / 76.2 / 57.3 | 235.5 / 201.1 / 214.9 / 182.1 / 137.8 | 3.1 / 3.3 / 7.3 / 2.0 / 4.6 | 3,362 / 3,020 / 2,711 / 2,367 / 2,020 | 3,362 / 3,020 / 2,711 / 2,367 / 2,020 | 7,401 / 7,401 / 7,402 / 7,402 / 7,403 | 24.32 / 21.93 / 19.75 / 17.36 / 14.93 |
| `perf_l1000_3m` | V12 | 2 | 17.27 | 487.9 | 314.4 / 293.5 / 254.0 / 236.6 / 217.6 | 254.0 | 128.5 / 142.6 / 119.5 / 106.9 / 91.9 | 175.9 / 145.8 / 129.6 / 124.1 / 120.7 | 9.9 / 5.1 / 4.9 / 5.6 / 5.1 | 4,275 / 3,879 / 3,551 / 3,157 / 2,729 | 4,275 / 3,879 / 3,551 / 3,157 / 2,729 | 8,401 / 8,401 / 8,402 / 8,402 / 8,403 | 30.86 / 28.08 / 25.78 / 23.04 / 20.03 |

- `perf_l1000_3m`의 V12 첫 번째(load 8.62~19.38)는 같은 조건의 두 번째(load 17.27)보다 중앙값이 약 3배다(791.5 / 254.0ms). 시간은 참고값이다.
- WAL 레코드는 같은 순서의 회차끼리 견주면 모두 V12가 V9보다 1,000개 많다(두 DB, 두 번, 5회 모두).
- 첫 묶음의 첫 회(데우기 다음)에서 V9 → V12의 버퍼 read는 3,418 → 4,346, WAL은 24.61 → 31.24MB(`perf_mix_50k`), 3,427 → 4,341, 24.65 → 31.19MB(`perf_l1000_3m`)다.

FK를 검사하는 트리거 시간(5회의 중앙값, ms, 1,100라인과 1,000거래의 합). V12의 라인 FK는 복합 FK다.

| DB | 번 | `ledger` FK(거래) | `users` FK 둘(거래) | 라인 → 거래 FK | 라인 → 계좌 FK | 라인 → 카테고리 FK | 라인 FK 셋의 합 |
|---|---|---|---|---|---|---|---|
| `perf_mix_50k` | 1 | 2.79 → 2.99 | 4.65 → 4.97 | 4.30 → 4.92 | 3.24 → 3.73 | 3.35 → 3.74 | 10.90 → 12.38 |
| `perf_mix_50k` | 2 | 2.89 → 2.86 | 4.81 → 4.84 | 4.43 → 4.90 | 3.29 → 3.71 | 3.35 → 3.64 | 11.08 → 12.25 |
| `perf_l1000_3m` | 1 | 3.34 → 5.26 | 5.90 → 8.38 | 6.08 → 12.06 | 4.71 → 8.15 | 4.61 → 7.64 | 15.39 → 27.85 |
| `perf_l1000_3m` | 2 | 2.79 → 2.93 | 4.67 → 4.81 | 4.40 → 5.13 | 3.29 → 3.76 | 3.29 → 3.82 | 10.98 → 12.71 |

- 라인 INSERT의 `Execution Time` 안에 트리거 시간이 들어 있다. V9은 단일 컬럼 FK(`transaction_line_*_fkey`), V12는 복합 FK(`fk_transaction_line_*`)이고 이름만 바뀐 것이 아니라 참조하는 열이 다르다.

유니크 셋과 테이블의 크기(`pg_relation_size`, 바이트):

| 대상 | `perf_mix_50k` V9 FULL | V12 적용 직후 | V12 FULL | 바로 시드 | `perf_l1000_3m` V12 FULL | 바로 시드 |
|---|---|---|---|---|---|---|
| `uq_transaction_id_ledger` | 없음 | 151,281,664 | 151,281,664 | 195,346,432 | 148,807,680 | 190,726,144 |
| `uq_account_id_ledger` | 없음 | 393,216 | 393,216 | 540,672 | 393,216 | 540,672 |
| `uq_category_id_ledger` | 없음 | 1,499,136 | 1,499,136 | 2,039,808 | 1,499,136 | 2,039,808 |
| `transaction_line` 테이블 | 355,549,184 | 766,222,336 | 410,673,152 | 410,673,152 | 403,939,328 | 403,939,328 |
| `transaction_line_pkey` | 105,848,832 | 211,681,280 | 105,848,832 | 138,403,840 | 104,120,320 | 136,863,744 |
| `ix_transaction_line_transaction` | 101,654,528 | 203,284,480 | 101,654,528 | 136,454,144 | 99,991,552 | 134,807,552 |
| `ix_transaction_line_account` | 24,600,576 | 66,699,264 | 24,600,576 | 31,891,456 | 24,207,360 | 31,629,312 |
| `transaction_pkey` | 96,223,232 | 96,223,232 | 96,223,232 | 130,588,672 | 94,650,368 | 127,238,144 |

- "V12 적용 직후"는 V11의 UPDATE 뒤 `VACUUM` 전이라 `transaction_line`과 그 인덱스에 죽은 행과 그 항목이 남아 있다. `VACUUM (FULL, ANALYZE)`는 테이블과 인덱스를 다시 만들어 모두 작아진다.
- `transaction_line`의 인덱스는 V9와 V12가 같다(더해진 인덱스는 유니크 셋뿐이다).
- 저장 1건의 SQL 수는 세지 않았다(범위 밖).

### 4.8 큰 장부 상한 판정용 회차

장부 전체 잔액만 다시 잰 회차다. 상한은 200ms(`docs/perf/README.md` 2장)이고 load 1분이 5 아래일 때만 시간으로 판정한다. 각 칸의 load는 그 칸이 시작할 때와 다음 칸이 시작할 때의 값이다.

| 회차 | DB | 장부 | 방식 | 최소 / 중앙 / 최대(ms) | load 1분(칸의 시작~다음 칸) | 조인 | 훑는 테이블 |
|---|---|---|---|---|---|---|---|
| 01:07:54 | `perf_mix_50k` | 큰 | 리터럴 | 193.1 / 218.6 / 240.9 | 5.87 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` |
| 01:07:54 | `perf_mix_50k` | 큰 | 일반 계획 | 914.8 / 991.3 / 1,121.8 | 5.63~5.87 | Nested Loop (병렬, 작업자 1) | 없음 |
| 01:07:54 | `perf_mix_50k` | 보통 | 리터럴 | 10.715 / 11.287 / 11.557 | 5.63 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` |
| 01:07:54 | `perf_mix_50k` | 보통 | 일반 계획 | 11.541 / 12.246 / 13.317 | 5.63 | Nested Loop (병렬, 작업자 1) | 없음 |
| 01:07:54 | `perf_mix_50k_new` | 큰 | 리터럴 | 182.4 / 193.4 / 216.6 | 5.63~5.66 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` |
| 01:07:54 | `perf_mix_50k_new` | 큰 | 일반 계획 | 999.5 / 1,104.8 / 1,351.6 | 5.56~5.66 | Nested Loop (병렬, 작업자 1) | 없음 |
| 01:07:54 | `perf_mix_50k_new` | 보통 | 리터럴 | 18.081 / 23.746 / 25.103 | 5.56 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` |
| 01:07:54 | `perf_mix_50k_new` | 보통 | 일반 계획 | 15.949 / 17.144 / 18.941 | 5.56 | Nested Loop (병렬, 작업자 1) | 없음 |
| 01:31:33 | `perf_mix_50k` | 큰 | 리터럴 | 174.6 / 182.7 / 195.7 | 9.57 | Hash Join, Parallel Hash Join (병렬, 작업자 2) | `transaction_line`, `account` |
| 01:31:33 | `perf_mix_50k` | 큰 | 일반 계획 | 874.4 / 1,059.4 / 1,285.3 | 9.03~9.57 | Nested Loop (병렬, 작업자 1) | 없음 |
| 01:31:33 | `perf_mix_50k` | 보통 | 리터럴 | 12.170 / 12.436 / 12.828 | 9.03 | Hash Join, Nested Loop (병렬, 작업자 1) | `account` |
| 01:31:33 | `perf_mix_50k` | 보통 | 일반 계획 | 11.716 / 12.595 / 13.521 | 8.78~9.03 | Nested Loop (병렬, 작업자 1) | 없음 |

- **큰 장부 시간 판정: 못 함.** 위 세 회차와 4.2의 "V12 바로 시드" 칸(load 5.23~5.33) 모두 load 1분이 5 아래가 아니었다. 문서를 쓰는 동안 load가 4.8 아래면 다시 재게 해 두었고 그런 때는 없었다. 다음 측정으로 넘긴다.
- 참고로만 적는다(load 5.23~9.57). 큰 장부 리터럴의 최소 / 중앙 / 최대는 이관 DB 193.1 / 218.6 / 240.9, 174.6 / 182.7 / 195.7ms, 바로 시드한 DB 182.4 / 193.4 / 216.6, 191.6 / 197.4 / 217.3ms다. 일반 계획은 모든 회차의 최솟값이 874.4ms다.
- 앞선 진단 측정 E7의 (가)(2026-11-25, load 2~3, 5만 건)는 큰 장부 리터럴이 132.5 / 136.6 / 144.8ms였다. 그때는 후보 문장, 손으로 넣은 열, FK와 유니크가 없는 DB였다. 조건이 달라 비교하지 않는다.

## 5. 측정 중 한계였던 자원

- **CPU**: 다른 worker와 같은 맥, 같은 Docker VM을 쓴다. load 1분 4.99~59.35(2장 표). CPU와 디스크 사용률은 따로 재지 않았다.
- **메모리**: 컨테이너의 `memory.current`는 단계마다 잰 값의 최댓값이 1,073,639,424바이트로 한도(1,073,741,824)에 가깝다. `memory.events`의 `max`(한도에 닿은 횟수, 컨테이너를 띄운 뒤 누적)는 2,144,135, `oom_kill`은 0이다. `docker inspect`의 `OOMKilled`는 false다. 페이지 캐시와 쿼리 메모리를 나눠 재지 않았다.
- **autovacuum**: 측정 중 돌지 않았다(`last_autovacuum`이 비어 있다).
- **JIT**: 4.2에 적었다.
- 식은 캐시, 읽기 시간, 캐시 크기(E1~E3)는 이번에 다시 재지 않았다.

## 6. 왜 이 수치인지

perf가 4장과 10장을 읽고 썼다. "확인"은 이 문서의 값이고 "추정"은 거기서 끌어낸 설명이다. 시간은 참고값이라 근거로 쓰지 않고 버퍼와 계획을 쓴다.

### 6.1 #58로 큰 장부의 장부 전체 잔액이 하는 일이 줄었다 (값에 맞춘 계획)

- 확인: 큰 장부 리터럴의 버퍼(hit + read)가 약 27만 4천(274,054~274,062)에서 약 10만 400(100,441)으로, 약 2.7분의 1이 됐다. 라인마다 거래를 찾는 중첩 루프(54,981번)가 없어지고 병렬 해시 조인이 됐다.
- 확인: `shared_buffers` 밖에서 읽은 블록(read)은 11.8만~12.6만에서 10.0만으로 덜 줄었다. 블록 장치에서 읽은 양은 749.9~842.5MB에서 324.6~387.8MB로 약 절반이 됐다(V9 FULL의 749.9MB에 견주면 43~52%).
- 추정: 흩어진 블록을 하나씩 읽던 것이 테이블을 차례로 읽는 것으로 바뀌어, 줄어든 read 수보다 시간이 더 줄었을 것이다. 이번 시간은 load가 달라 이 설명을 확인하지 못한다.
- 확인: 저장이 더 흩어진 DB(바로 시드, 큰 장부의 라인 블록 49,584개)와 덜 흩어진 DB(이관, 32,137개)에서 리터럴의 read가 10.0만으로 거의 같다(100,158~100,162와 100,108~100,112). 일반 계획(중첩 루프)은 12.1만과 9.7만으로 다르다. 리터럴의 read는 라인의 저장 순서에 기대지 않는다. 거래에서 읽은 테이블 블록은 두 DB가 같아(49,914개) 거래의 저장 순서에 기대는지는 이번에 볼 수 없다.

### 6.2 대신 전체 사용자의 라인 수에 비례한다

- 확인: 새 계획은 `transaction_line` 전체를 훑는다(약 336만 라인, 410,673,152바이트 = 50,131블록). read 100,108~100,112 가운데 50,131이 이 테이블이고, 49,977(인덱스 63, 테이블 49,914)이 큰 장부의 거래를 읽는 몫이다.
- 그래서 이 쿼리의 비용은 그 장부의 크기만이 아니라 모든 사용자의 라인 수에 따라 는다. "전체 훑기 없음" 기준에 맞지 않는다.
- 참고값(load 5.2~9.6)으로도 리터럴 중앙이 183~219ms라 상한 200ms 근처다. 여유가 있다고 말할 수 없다. 판정은 조용한 때 다시 한다.
- dba가 #113의 재판단 시점을 "2단계 시작 전 또는 운영 라인 100만 행"으로 정한 것은 이 결과와 맞는다. 이번 데이터는 그 3배가 넘는다.

### 6.3 일반 계획은 여전히 느리다. #112가 먼저다

- 확인: 큰 장부의 일반 계획은 중첩 루프이고 버퍼(hit + read)가 404,023으로 리터럴의 4배다. #58 앞의 일반 계획(약 27만 4천)과 견주면 약 1.5배로 늘었다(hit 14.9만~15.6만 → 30.7만, read 11.8만~12.5만 → 9.7만). 참고값(load 5.2~9.6)으로 중앙 991~1,105ms다. 저장이 더 흩어진 바로 시드 DB의 read가 더 많다(6.1. 두 DB는 인덱스 크기도 다르다, 4.7).
- 확인: 일반 계획의 조인 예상은 1행이다(실제는 약 5만 3천 행). 라인 노드는 반복마다 예상 1행이고 실제도 1행이다(48,499번). 거래 노드는 예상 878행 ×2, 실제 24,250행 ×2다.
- 확인: 새 문장으로 pgJDBC 42.7.14를 다시 돌렸다(4.1). 서버 쪽 준비된 문장은 5번째 실행에서 만들어지고, 값에 맞춘 계획 5번 뒤 10번째 실행부터 일반 계획이다(14번째까지 봤다). 계획기가 매긴 전체 비용은 일반 계획이 18,292.92, 리터럴이 137,624.48이다(10장).
- 추정: 예상이 작아 일반 계획의 비용이 싸게 보이는 것이 까닭이다.
- 그래서 #58의 효과는 #112가 들어가야 앱에서 유지된다.

### 6.4 예상 행 수가 1이 되는 까닭

- 확인: 계좌 하나 잔액의 라인 예상이 일반 계획과 보통 장부 리터럴에서 428~453에서 1로 줄었다. 큰 장부 리터럴은 프로세스마다 4,986~5,406(병렬, 작업자 2)에서 196(비병렬)으로 줄었다. 확장 통계가 저장한 종속은 `account_id` → `ledger_id` 1.0이다.
- 추정: `account_id`가 `ledger_id`를 정하는데 계획기는 두 조건을 독립으로 보고 곱한다. PR #170의 작은 데이터 관찰(1,067 → 356)과 같은 까닭이다.
- 확인: 이 쿼리에서는 조인 방식이 그대로이고 버퍼도 거의 같다(큰 장부 55,920~55,927 → 55,113, 보통 장부 4,623~4,624 → 4,621~4,622). 큰 장부 리터럴만 병렬에서 비병렬이 됐다. 지금 해가 없다.
- 추정: 예상이 1이면 계획기가 그 위에 중첩 루프를 쌓기 쉽다. dba가 잰 `a.ledger_id` 안이 느려진 것과 같은 방향이다. 장부 조건을 더하는 쿼리는 앞으로도 하나씩 재야 한다.

### 6.5 dba 후보

- (a) 확장 통계 — 확인: 계좌 하나 잔액의 라인 예상은 실제에 가까워지지만(큰 장부 리터럴은 프로세스마다 4,753 대 실제 3,749, 보통 장부 리터럴은 431 대 924, 일반 계획은 451 대 11,247 / 924) 장부 전체 잔액의 계획은 그대로다. 계좌 하나 잔액의 리터럴은 버퍼가 거의 같다(큰 장부 55,113 → 55,115, 보통 장부 4,621 → 4,621). 큰 장부의 일반 계획은 해시 조인으로 바뀌어 버퍼 read가 0에서 60,101이 됐다(load와 무관). perf 권고: 넣지 않는다. 얻는 것이 예상 행 수뿐이고 큰 장부의 일반 계획을 나쁘게 한다. #112가 들어가면 나빠지는 쪽은 없어지지만 그때도 얻는 것이 없다.
- (b) account 조인을 없앤 두 문장 — 확인: 결과가 같고 `account` 훑기가 없어지지만, 라인마다 거래를 찾는 중첩 루프(54,981번)로 돌아가 큰 장부 리터럴의 버퍼가 2.7배(271,809)다. 보통 장부 리터럴도 14,890 → 16,458로 는다. 일반 계획은 반대로 줄어든다(큰 장부 404,023 → 271,809, 보통 장부 24,247 → 16,458). 추정: 계획기가 계좌 조건과 장부 조건을 독립으로 보고 곱해(6.4와 같은 까닭) 계좌마다의 라인 예상이 큰 장부 리터럴에서 7행으로 작다(453 × 큰 장부의 라인 비율 1.64% = 7.4). 배열의 계좌 수는 리터럴에서 맞게 안다(큰 장부 예상 10 / 실제 10, 보통 장부 6 / 6). perf 권고: 넣지 않는다.
- `account` 훑기 — 확인: 프로세스마다 101블록, 큰 장부 리터럴 전체 버퍼의 약 0.3%다. 이 크기에서 받아들인다는 dba의 결정과 맞는다. 다만 전체 계좌 수에 비례한다.

### 6.6 넣기 비용

- 확인: 거래 1,000건에 WAL 레코드가 정확히 1,000개 늘었다. 첫 묶음의 첫 회(`perf_mix_50k`)의 WAL은 약 27% 늘었다(24.6 → 31.2MB). 추정: 레코드 1,000개는 `uq_transaction_id_ledger`에 거래마다 한 항목이 더해진 몫이다.
- 확인: 라인 FK 셋의 검사는 1,100라인에 1.2~1.7ms 늘었다(세 묶음. `perf_mix_50k` 두 번은 load 5.1~5.4, `perf_l1000_3m` 두 번째는 load 17.3~18.0). `perf_l1000_3m` 첫 번째(V9 load 5.7, V12 load 8.6~19.4)는 12.5ms 늘었다. 새 유니크는 144MB(바로 시드 186MB), `transaction_line` 테이블은 15.5% 커졌다.
- 추정: 거래 하나로 보면 WAL 레코드 하나와 1~2마이크로초라, 목표 요청량(초당 20건)에서 저장 속도에 주는 영향은 작다. INSERT 총 시간은 load가 섞여 판정하지 않는다.

### 6.7 perf의 권고와 다시 잴 것 (결정은 dba)

1. 후보 (a), (b)는 둘 다 넣지 않는다(6.5).
2. #112를 다음으로 한다. #58의 효과가 앱에서 유지되는 조건이다(6.3).
3. #113의 시점은 그대로 두되, 재판단 때 이 문서의 "큰 장부 리터럴이 `transaction_line` 전체를 훑는다"를 근거로 쓴다.
4. 다시 잴 것: #112 뒤 조용한 때의 큰 장부 5만 건 상한 200ms 판정과 10번 넘는 실행의 계획, #67 뒤 세 조회, #9 뒤 휴지통 인덱스(#113), 기준일이 행을 거르는 데이터.

## 7. 목표 대비 판정

기준은 [`docs/perf/README.md`](../README.md) 2장의 쿼리 상한(장부 전체 잔액 200ms)과 "`transaction`·`transaction_line` 전체 훑기 없음"이다.

시간 상한 판정은 하지 않는다(load, 4.8). 계획과 훑기는 다음과 같다.

| 쿼리 | 상태 | 장부 | 방식 | `transaction`·`transaction_line` 전체 훑기 | `account` 전체 훑기 | 시간 판정(200ms) |
|---|---|---|---|---|---|---|
| 장부 전체 잔액 | V9(#58 앞) | 큰·보통 | 리터럴·일반 | 없음 | 없음(`uq_account_name`) | 하지 않음 |
| 장부 전체 잔액 | V12(#58 뒤) | 큰 | 리터럴 | **`transaction_line` 있음**(병렬 Seq Scan) | 있음 | 못 함(load 5 이상) |
| 장부 전체 잔액 | V12 | 큰 | 일반 계획 | 없음 | 없음(`account_pkey`) | 못 함 |
| 장부 전체 잔액 | V12 | 보통 | 리터럴 | 없음 | 있음 | 큰 장부가 아니라 판정 대상이 아님(참고: 최댓값 4.2 표) |
| 장부 전체 잔액 | V12 | 보통 | 일반 계획 | 없음 | 없음 | 위와 같음 |
| 계좌 하나 잔액 | V9, V12 | 큰·보통 | 리터럴·일반 | 없음 | 계획에 `account` 없음 | 상한이 정해져 있지 않다 |

- V12 큰 장부 리터럴의 `transaction_line` 전체 훑기는 앞선 E7의 (가)(5만 건)에도 있었다. 그때는 `account`를 `account_pkey`로 찾았고 훑지 않았다.
- `perf_l1000_3m`의 보통 장부는 `perf_mix_50k`와 판정이 같다.
- 거래 목록 50건은 쿼리가 없어 재지 않았다. 월별 통계, 휴지통 목록, 카테고리 사용 여부는 이번에 시간과 계획을 재지 않았다(문장의 글자 대조는 4.1).

## 8. 확인과 추정

- 확인: 이 문서의 건수, 해시, 버퍼, 계획 모양, 훑는 테이블, 예상/실제 행 수, 크기, WAL, 적용 시간, 결과 동일 여부는 모두 이번에 직접 얻은 값이다. 계획 원문은 10장에 있다.
- 확인하지 않은 것: 시간 차이의 까닭. 이 문서는 시간 차이를 #58의 효과로 읽지 않는다. 바로 시드한 DB와 이관한 DB는 내용 해시가 같다는 것을 확인했고, 저장 순서는 다르다(4.4).
- 추정: 6장에 "추정"으로 적은 것이 전부다. 다른 장에는 추정으로 적은 설명이 없다.

## 9. 못 잰 것

- **조용한 때의 #58 앞뒤 시간 비교**: 앞뒤 회차의 load가 서로 다르다(2장 표). 시간 차이를 #58의 효과로 읽지 않는다.
- **큰 장부 5만 건의 상한 200ms 시간 판정**: load 1분이 5 아래인 때가 없어 하지 못했다(4.8). 다음 측정으로 넘긴다.
- 기준일 조건이 행을 거르는 데이터에서의 잔액 쿼리 계획과 시간(시드의 기준일은 모두 거래 시작일이다. 결과 동일 비교만 기준일을 흩뜨린 사본에서 했다).
- 후보의 결과 비교를 일반 계획으로 하는 것, 후보의 나머지 형태(`VALUES`, 조인 없이 `CASE`), 앱에서 실행하는 것.
- `perf_l1000_3m`의 후보와 확장 통계, `perf_mix_200k`: 재지 않았다(스펙은 `perf_mix_50k`).
- 옛 문장을 V12 DB에서 돌린 값(E7의 (0)에 해당): 스펙에 없어 재지 않았다.
- `a.ledger_id`를 더하는 안: dba가 재서 버려 재지 않았다.
- Flyway를 거친 V10~V12의 적용 시간(여기서는 psql로 한 파일씩), V10~V12의 반복.
- 앱(Hibernate)을 거친 경로, 동시 요청, API 지연, 저장 1건의 SQL 수, 운영과 같은 사양.
- #112(`force_custom_plan`)와 #67은 아직 열려 있어 일반 계획 값은 `force_generic_plan`으로 잰 값이다.

## 10. 대표 실행 계획 원문

각 원문은 그 회차 10번 가운데 뒤 7번의 중앙값(가운데 실행)이다. 일반 계획은 `$1` 등이 남은 계획이다.

<details>
<summary>V9 FULL 3회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 리터럴</summary>

```text
GroupAggregate  (cost=18649.14..18681.61 rows=1443 width=46) (actual time=3057.238..3061.648 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=155712 read=118350
  ->  Sort  (cost=18649.14..18652.75 rows=1443 width=24) (actual time=3056.882..3058.661 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=155712 read=118350
        ->  Nested Loop  (cost=12.72..18573.42 rows=1443 width=24) (actual time=2.672..3036.024 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=155712 read=118350
              ->  Nested Loop  (cost=12.29..16096.24 rows=4468 width=44) (actual time=2.589..1934.418 rows=54981 loops=1)
                    Buffers: shared hit=4564 read=49574
                    ->  Bitmap Heap Scan on account a1_0  (cost=4.36..35.05 rows=10 width=20) (actual time=0.225..0.234 rows=10 loops=1)
                          Recheck Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Heap Blocks: exact=1
                          Buffers: shared hit=1 read=2
                          ->  Bitmap Index Scan on uq_account_name  (cost=0.00..4.36 rows=10 width=0) (actual time=0.219..0.219 rows=10 loops=1)
                                Index Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                Buffers: shared read=2
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.93..1601.61 rows=451 width=40) (actual time=1.099..191.728 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4563 read=49572
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.81 rows=451 width=0) (actual time=0.540..0.540 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=12 read=65
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.54 rows=1 width=20) (actual time=0.019..0.019 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=151148 read=68776
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 1.973 ms
Execution Time: 3061.888 ms
```

</details>

<details>
<summary>V9 FULL 3회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 일반 계획</summary>

```text
GroupAggregate  (cost=15029.06..15042.20 rows=584 width=46) (actual time=3029.565..3033.901 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=155725 read=118337
  ->  Sort  (cost=15029.06..15030.52 rows=584 width=24) (actual time=3029.204..3030.948 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=155725 read=118337
        ->  Nested Loop  (cost=12.70..15002.22 rows=584 width=24) (actual time=2.359..3007.708 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=155725 read=118337
              ->  Nested Loop  (cost=12.27..13020.70 rows=3574 width=44) (actual time=2.269..1914.149 rows=54981 loops=1)
                    Buffers: shared hit=4564 read=49574
                    ->  Bitmap Heap Scan on account a1_0  (cost=4.34..29.69 rows=8 width=20) (actual time=0.082..0.089 rows=10 loops=1)
                          Recheck Cond: (ledger_id = $1)
                          Heap Blocks: exact=1
                          Buffers: shared hit=1 read=2
                          ->  Bitmap Index Scan on uq_account_name  (cost=0.00..4.34 rows=8 width=0) (actual time=0.077..0.077 rows=10 loops=1)
                                Index Cond: (ledger_id = $1)
                                Buffers: shared read=2
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.93..1619.37 rows=451 width=40) (actual time=1.159..189.569 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4563 read=49572
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.81 rows=451 width=0) (actual time=0.575..0.575 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=12 read=65
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.54 rows=1 width=20) (actual time=0.019..0.019 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> ($2)::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=151161 read=68763
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 1.989 ms
Execution Time: 3034.183 ms
```

</details>

<details>
<summary>V12 5회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 리터럴</summary>

```text
Finalize GroupAggregate  (cost=135566.36..137624.48 rows=7403 width=46) (actual time=460.573..466.712 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=329 read=100112
  ->  Gather Merge  (cost=135566.36..137403.58 rows=14648 width=48) (actual time=460.236..466.645 rows=30 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=329 read=100112
        ->  Partial GroupAggregate  (cost=134566.33..134712.81 rows=7324 width=48) (actual time=439.823..442.034 rows=10 loops=3)
              Group Key: tl1_0.account_id
              Buffers: shared hit=329 read=100112
              ->  Sort  (cost=134566.33..134584.64 rows=7324 width=24) (actual time=439.606..440.587 rows=17775 loops=3)
                    Sort Key: tl1_0.account_id
                    Sort Method: quicksort  Memory: 1417kB
                    Buffers: shared hit=329 read=100112
                    Worker 0:  Sort Method: quicksort  Memory: 1486kB
                    Worker 1:  Sort Method: quicksort  Memory: 1486kB
                    ->  Hash Join  (cost=66372.45..134096.19 rows=7324 width=24) (actual time=181.107..434.096 rows=17775 loops=3)
                          Hash Cond: (tl1_0.account_id = a1_0.id)
                          Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
                          Buffers: shared hit=315 read=100112
                          ->  Parallel Hash Join  (cost=66102.47..133768.53 rows=21971 width=28) (actual time=166.753..414.231 rows=17775 loops=3)
                                Hash Cond: (tl1_0.transaction_id = t1_0.id)
                                Buffers: shared read=100108
                                ->  Parallel Seq Scan on transaction_line tl1_0  (cost=0.00..67606.60 rows=22648 width=40) (actual time=0.563..234.856 rows=18327 loops=3)
                                      Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                      Rows Removed by Filter: 1100055
                                      Buffers: shared read=50131
                                ->  Parallel Hash  (cost=65846.16..65846.16 rows=20505 width=20) (actual time=165.913..165.915 rows=16166 loops=3)
                                      Buckets: 65536  Batches: 1  Memory Usage: 3232kB
                                      Buffers: shared read=49977
                                      ->  Parallel Bitmap Heap Scan on transaction t1_0  (cost=1325.19..65846.16 rows=20505 width=20) (actual time=6.024..160.675 rows=16166 loops=3)
                                            Recheck Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                            Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                                            Rows Removed by Filter: 500
                                            Heap Blocks: exact=21691
                                            Buffers: shared read=49977
                                            ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..1312.89 rows=50728 width=0) (actual time=9.171..9.171 rows=50000 loops=1)
                                                  Index Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                                  Buffers: shared read=63
                          ->  Hash  (cost=176.10..176.10 rows=7510 width=20) (actual time=14.015..14.016 rows=7510 loops=3)
                                Buckets: 8192  Batches: 1  Memory Usage: 446kB
                                Buffers: shared hit=303
                                ->  Seq Scan on account a1_0  (cost=0.00..176.10 rows=7510 width=20) (actual time=12.382..13.091 rows=7510 loops=3)
                                      Buffers: shared hit=303
Planning:
  Buffers: shared hit=7 read=23
Planning Time: 4.578 ms
JIT:
  Functions: 96
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 5.078 ms (Deform 1.458 ms), Inlining 0.000 ms, Optimization 1.718 ms, Emission 35.650 ms, Total 42.447 ms
Execution Time: 467.936 ms
```

</details>

<details>
<summary>V12 5회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 일반 계획</summary>

```text
GroupAggregate  (cost=18292.89..18292.92 rows=1 width=46) (actual time=5266.174..5275.862 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=306877 read=97146
  ->  Sort  (cost=18292.89..18292.90 rows=1 width=24) (actual time=5265.403..5270.790 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=306877 read=97146
        ->  Gather  (cost=1080.37..18292.88 rows=1 width=24) (actual time=17.818..5239.804 rows=53326 loops=1)
              Workers Planned: 1
              Workers Launched: 1
              Buffers: shared hit=306877 read=97146
              ->  Nested Loop  (cost=80.37..17292.78 rows=1 width=24) (actual time=9.347..5204.591 rows=26663 loops=2)
                    Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
                    Buffers: shared hit=306877 read=97146
                    ->  Nested Loop  (cost=80.09..17292.31 rows=1 width=28) (actual time=9.199..5097.973 rows=26663 loops=2)
                          Buffers: shared hit=146899 read=97145
                          ->  Parallel Bitmap Heap Scan on transaction t1_0  (cost=79.66..10111.59 rows=878 width=20) (actual time=8.784..1018.847 rows=24250 loops=2)
                                Recheck Cond: (ledger_id = $2)
                                Filter: ((deleted_at IS NULL) AND ((status)::text <> ($3)::text))
                                Rows Removed by Filter: 750
                                Heap Blocks: exact=25054
                                Buffers: shared read=49977
                                ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..79.28 rows=3047 width=0) (actual time=9.144..9.145 rows=50000 loops=1)
                                      Index Cond: (ledger_id = $2)
                                      Buffers: shared read=63
                          ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.17 rows=1 width=40) (actual time=0.167..0.167 rows=1 loops=48499)
                                Index Cond: (transaction_id = t1_0.id)
                                Filter: (ledger_id = $1)
                                Buffers: shared hit=146899 read=47168
                    ->  Index Scan using account_pkey on account a1_0  (cost=0.28..0.46 rows=1 width=20) (actual time=0.003..0.003 rows=1 loops=53326)
                          Index Cond: (id = tl1_0.account_id)
                          Buffers: shared hit=159978 read=1
Planning:
  Buffers: shared hit=11 read=19
Planning Time: 7.166 ms
Execution Time: 5276.415 ms
```

</details>

<details>
<summary>V9 FULL 3회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 보통 장부, 리터럴</summary>

```text
GroupAggregate  (cost=13227.81..13250.54 rows=1010 width=46) (actual time=9.993..10.243 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=16468
  ->  Sort  (cost=13227.81..13230.34 rows=1010 width=24) (actual time=9.948..10.052 rows=3192 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 221kB
        Buffers: shared hit=16468
        ->  Nested Loop  (cost=12.69..13177.42 rows=1010 width=24) (actual time=0.169..9.564 rows=3192 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=16468
              ->  Nested Loop  (cost=12.26..11443.72 rows=3127 width=44) (actual time=0.163..2.743 rows=3289 loops=1)
                    Buffers: shared hit=3312
                    ->  Bitmap Heap Scan on account a1_0  (cost=4.34..26.90 rows=7 width=20) (actual time=0.005..0.007 rows=6 loops=1)
                          Recheck Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                          Heap Blocks: exact=1
                          Buffers: shared hit=3
                          ->  Bitmap Index Scan on uq_account_name  (cost=0.00..4.33 rows=7 width=0) (actual time=0.003..0.003 rows=6 loops=1)
                                Index Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                                Buffers: shared hit=2
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.93..1626.46 rows=451 width=40) (actual time=0.077..0.404 rows=548 loops=6)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=3289
                          Buffers: shared hit=3309
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.81 rows=451 width=0) (actual time=0.035..0.035 rows=548 loops=6)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=20
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.54 rows=1 width=20) (actual time=0.002..0.002 rows=1 loops=3289)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=13156
Planning:
  Buffers: shared hit=30
Planning Time: 0.181 ms
Execution Time: 10.306 ms
```

</details>

<details>
<summary>V12 5회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 보통 장부, 리터럴</summary>

```text
Finalize GroupAggregate  (cost=24726.99..24830.25 rows=1060 width=46) (actual time=18.168..22.234 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=14890
  ->  Gather Merge  (cost=24726.99..24809.67 rows=624 width=48) (actual time=18.118..22.210 rows=12 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=14890
        ->  Partial GroupAggregate  (cost=23726.98..23739.46 rows=624 width=48) (actual time=16.330..16.497 rows=6 loops=2)
              Group Key: tl1_0.account_id
              Buffers: shared hit=14890
              ->  Sort  (cost=23726.98..23728.54 rows=624 width=24) (actual time=16.293..16.358 rows=1596 loops=2)
                    Sort Key: tl1_0.account_id
                    Sort Method: quicksort  Memory: 186kB
                    Buffers: shared hit=14890
                    Worker 0:  Sort Method: quicksort  Memory: 59kB
                    ->  Hash Join  (cost=349.93..23698.01 rows=624 width=24) (actual time=2.102..15.867 rows=1596 loops=2)
                          Hash Cond: (tl1_0.account_id = a1_0.id)
                          Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
                          Buffers: shared hit=14883
                          ->  Nested Loop  (cost=79.96..23423.12 rows=1871 width=28) (actual time=0.501..13.890 rows=1596 loops=2)
                                Buffers: shared hit=14670
                                ->  Parallel Bitmap Heap Scan on transaction t1_0  (cost=79.53..9925.19 rows=1702 width=20) (actual time=0.471..4.570 rows=1456 loops=2)
                                      Recheck Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                                      Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                                      Rows Removed by Filter: 44
                                      Heap Blocks: exact=2157
                                      Buffers: shared hit=3017
                                      ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..78.80 rows=2983 width=0) (actual time=0.583..0.583 rows=3000 loops=1)
                                            Index Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                                            Buffers: shared hit=17
                                ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..7.92 rows=1 width=40) (actual time=0.006..0.006 rows=1 loops=2912)
                                      Index Cond: (transaction_id = t1_0.id)
                                      Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                                      Buffers: shared hit=11653
                          ->  Hash  (cost=176.10..176.10 rows=7510 width=20) (actual time=1.572..1.573 rows=7510 loops=2)
                                Buckets: 8192  Batches: 1  Memory Usage: 446kB
                                Buffers: shared hit=202
                                ->  Seq Scan on account a1_0  (cost=0.00..176.10 rows=7510 width=20) (actual time=0.007..0.731 rows=7510 loops=2)
                                      Buffers: shared hit=202
Planning:
  Buffers: shared hit=30
Planning Time: 0.309 ms
Execution Time: 22.415 ms
```

</details>

<details>
<summary>V12 5회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 보통 장부, 일반 계획</summary>

```text
GroupAggregate  (cost=18292.89..18292.92 rows=1 width=46) (actual time=19.775..24.312 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=24247
  ->  Sort  (cost=18292.89..18292.90 rows=1 width=24) (actual time=19.712..24.018 rows=3192 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 221kB
        Buffers: shared hit=24247
        ->  Gather  (cost=1080.37..18292.88 rows=1 width=24) (actual time=1.206..23.216 rows=3192 loops=1)
              Workers Planned: 1
              Workers Launched: 1
              Buffers: shared hit=24247
              ->  Nested Loop  (cost=80.37..17292.78 rows=1 width=24) (actual time=0.551..16.789 rows=1596 loops=2)
                    Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
                    Buffers: shared hit=24247
                    ->  Nested Loop  (cost=80.09..17292.31 rows=1 width=28) (actual time=0.527..14.170 rows=1596 loops=2)
                          Buffers: shared hit=14670
                          ->  Parallel Bitmap Heap Scan on transaction t1_0  (cost=79.66..10111.59 rows=878 width=20) (actual time=0.504..4.696 rows=1456 loops=2)
                                Recheck Cond: (ledger_id = $2)
                                Filter: ((deleted_at IS NULL) AND ((status)::text <> ($3)::text))
                                Rows Removed by Filter: 44
                                Heap Blocks: exact=1953
                                Buffers: shared hit=3017
                                ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..79.28 rows=3047 width=0) (actual time=0.632..0.635 rows=3000 loops=1)
                                      Index Cond: (ledger_id = $2)
                                      Buffers: shared hit=17
                          ->  Index Scan using ix_transaction_line_transaction on transaction_line tl1_0  (cost=0.43..8.17 rows=1 width=40) (actual time=0.006..0.006 rows=1 loops=2912)
                                Index Cond: (transaction_id = t1_0.id)
                                Filter: (ledger_id = $1)
                                Buffers: shared hit=11653
                    ->  Index Scan using account_pkey on account a1_0  (cost=0.28..0.46 rows=1 width=20) (actual time=0.001..0.001 rows=1 loops=3192)
                          Index Cond: (id = tl1_0.account_id)
                          Buffers: shared hit=9577
Planning:
  Buffers: shared hit=30
Planning Time: 0.358 ms
Execution Time: 24.400 ms
```

</details>

<details>
<summary>V12 바로 시드, <code>perf_mix_50k_new</code>, 장부 전체 잔액, 큰 장부, 리터럴</summary>

```text
Finalize GroupAggregate  (cost=136403.86..138483.26 rows=7399 width=46) (actual time=192.697..196.714 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=333 read=100158
  ->  Gather Merge  (cost=136403.86..138261.29 rows=14798 width=48) (actual time=192.492..196.694 rows=30 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=333 read=100158
        ->  Partial GroupAggregate  (cost=135403.84..135553.21 rows=7399 width=48) (actual time=182.805..184.338 rows=10 loops=3)
              Group Key: tl1_0.account_id
              Buffers: shared hit=333 read=100158
              ->  Sort  (cost=135403.84..135422.80 rows=7585 width=24) (actual time=182.662..183.268 rows=17775 loops=3)
                    Sort Key: tl1_0.account_id
                    Sort Method: quicksort  Memory: 1482kB
                    Buffers: shared hit=333 read=100158
                    Worker 0:  Sort Method: quicksort  Memory: 1454kB
                    Worker 1:  Sort Method: quicksort  Memory: 1453kB
                    ->  Hash Join  (cost=67187.67..134915.02 rows=7585 width=24) (actual time=81.083..180.198 rows=17775 loops=3)
                          Hash Cond: (tl1_0.account_id = a1_0.id)
                          Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
                          Buffers: shared hit=319 read=100158
                          ->  Parallel Hash Join  (cost=66917.69..134585.31 rows=22754 width=28) (actual time=72.528..169.326 rows=17775 loops=3)
                                Hash Cond: (tl1_0.transaction_id = t1_0.id)
                                Buffers: shared read=100158
                                ->  Parallel Seq Scan on transaction_line tl1_0  (cost=0.00..67605.96 rows=23486 width=40) (actual time=0.133..92.369 rows=18327 loops=3)
                                      Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                      Rows Removed by Filter: 1100055
                                      Buffers: shared read=50131
                                ->  Parallel Hash  (cost=66660.15..66660.15 rows=20603 width=20) (actual time=72.258..72.258 rows=16166 loops=3)
                                      Buckets: 65536  Batches: 1  Memory Usage: 3200kB
                                      Buffers: shared read=50027
                                      ->  Parallel Bitmap Heap Scan on transaction t1_0  (cost=2035.58..66660.15 rows=20603 width=20) (actual time=8.906..69.884 rows=16166 loops=3)
                                            Recheck Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                            Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                                            Rows Removed by Filter: 500
                                            Heap Blocks: exact=21336
                                            Buffers: shared read=50027
                                            ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..2023.22 rows=51039 width=0) (actual time=10.710..10.710 rows=50000 loops=1)
                                                  Index Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                                  Buffers: shared read=113
                          ->  Hash  (cost=176.10..176.10 rows=7510 width=20) (actual time=8.527..8.527 rows=7510 loops=3)
                                Buckets: 8192  Batches: 1  Memory Usage: 446kB
                                Buffers: shared hit=303
                                ->  Seq Scan on account a1_0  (cost=0.00..176.10 rows=7510 width=20) (actual time=7.480..7.966 rows=7510 loops=3)
                                      Buffers: shared hit=303
Planning:
  Buffers: shared hit=14 read=16
Planning Time: 1.135 ms
JIT:
  Functions: 96
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 1.948 ms (Deform 0.913 ms), Inlining 0.000 ms, Optimization 1.064 ms, Emission 21.498 ms, Total 24.511 ms
Execution Time: 197.387 ms
```

</details>

<details>
<summary>V9 FULL 3회차, <code>perf_mix_50k</code>, 계좌 하나 잔액, 큰 장부, 리터럴</summary>

```text
Finalize Aggregate  (cost=65162.48..65162.49 rows=1 width=30) (actual time=19.651..24.048 rows=1 loops=1)
  Buffers: shared hit=55927
  ->  Gather  (cost=65162.25..65162.46 rows=2 width=32) (actual time=19.540..24.042 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=55927
        ->  Partial Aggregate  (cost=64162.25..64162.26 rows=1 width=32) (actual time=18.232..18.232 rows=1 loops=3)
              Buffers: shared hit=55927
              ->  Nested Loop  (cost=149.41..64149.15 rows=5239 width=8) (actual time=1.443..18.060 rows=3644 loops=3)
                    Buffers: shared hit=55927
                    ->  Parallel Bitmap Heap Scan on transaction_line tl1_0  (cost=148.98..28098.57 rows=5406 width=24) (actual time=1.418..6.494 rows=3749 loops=3)
                          Recheck Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                          Heap Blocks: exact=4816
                          Buffers: shared hit=10937
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..145.74 rows=12974 width=0) (actual time=1.424..1.424 rows=11247 loops=1)
                                Index Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                                Buffers: shared hit=13
                    ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..6.67 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=11247)
                          Index Cond: (id = tl1_0.transaction_id)
                          Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 0
                          Buffers: shared hit=44990
Planning:
  Buffers: shared hit=16
Planning Time: 0.117 ms
Execution Time: 24.069 ms
```

</details>

<details>
<summary>V12 5회차, <code>perf_mix_50k</code>, 계좌 하나 잔액, 큰 장부, 리터럴</summary>

```text
Aggregate  (cost=30095.11..30095.12 rows=1 width=30) (actual time=40.033..40.034 rows=1 loops=1)
  Buffers: shared hit=55113
  ->  Nested Loop  (cost=135.50..30094.63 rows=190 width=8) (actual time=2.207..39.535 rows=10932 loops=1)
        Buffers: shared hit=55113
        ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=135.07..28441.45 rows=196 width=24) (actual time=2.196..10.420 rows=11247 loops=1)
              Recheck Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
              Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
              Heap Blocks: exact=10112
              Buffers: shared hit=10125
              ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..135.02 rows=12079 width=0) (actual time=1.081..1.081 rows=11247 loops=1)
                    Index Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                    Buffers: shared hit=13
        ->  Index Scan using uq_transaction_id_ledger on transaction t1_0  (cost=0.43..8.43 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=11247)
              Index Cond: ((id = tl1_0.transaction_id) AND (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid))
              Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
              Rows Removed by Filter: 0
              Buffers: shared hit=44988
Planning:
  Buffers: shared hit=16
Planning Time: 0.174 ms
Execution Time: 40.204 ms
```

</details>

<details>
<summary>V12 5회차, <code>perf_mix_50k</code>, 계좌 하나 잔액, 큰 장부, 일반 계획</summary>

```text
Aggregate  (cost=1698.78..1698.80 rows=1 width=30) (actual time=54.041..54.042 rows=1 loops=1)
  Buffers: shared hit=55113
  ->  Nested Loop  (cost=8.26..1698.78 rows=1 width=8) (actual time=2.878..53.380 rows=10932 loops=1)
        Buffers: shared hit=55113
        ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.83..1690.29 rows=1 width=24) (actual time=2.865..13.533 rows=11247 loops=1)
              Recheck Cond: (account_id = $1)
              Filter: (ledger_id = $4)
              Heap Blocks: exact=10112
              Buffers: shared hit=10125
              ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.83 rows=453 width=0) (actual time=1.392..1.392 rows=11247 loops=1)
                    Index Cond: (account_id = $1)
                    Buffers: shared hit=13
        ->  Index Scan using uq_transaction_id_ledger on transaction t1_0  (cost=0.43..8.46 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=11247)
              Index Cond: ((id = tl1_0.transaction_id) AND (ledger_id = $5))
              Filter: ((deleted_at IS NULL) AND (occurred_on >= $2) AND ((status)::text <> ($3)::text))
              Rows Removed by Filter: 0
              Buffers: shared hit=44988
Planning:
  Buffers: shared hit=16
Planning Time: 0.223 ms
Execution Time: 54.248 ms
```

</details>

<details>
<summary>V9 FULL 3회차, <code>perf_mix_50k</code>, 계좌 하나 잔액, 보통 장부, 리터럴</summary>

```text
Aggregate  (cost=5213.28..5213.29 rows=1 width=30) (actual time=2.170..2.171 rows=1 loops=1)
  Buffers: shared hit=4624
  ->  Nested Loop  (cost=8.20..5212.23 rows=418 width=8) (actual time=0.130..2.130 rows=899 loops=1)
        Buffers: shared hit=4624
        ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.77..1601.20 rows=431 width=24) (actual time=0.125..0.552 rows=924 loops=1)
              Recheck Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
              Heap Blocks: exact=924
              Buffers: shared hit=928
              ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.66 rows=431 width=0) (actual time=0.052..0.052 rows=924 loops=1)
                    Index Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                    Buffers: shared hit=4
        ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..8.38 rows=1 width=16) (actual time=0.002..0.002 rows=1 loops=924)
              Index Cond: (id = tl1_0.transaction_id)
              Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
              Rows Removed by Filter: 0
              Buffers: shared hit=3696
Planning:
  Buffers: shared hit=16
Planning Time: 0.084 ms
Execution Time: 2.182 ms
```

</details>

<details>
<summary>V12 5회차, <code>perf_mix_50k</code>, 계좌 하나 잔액, 보통 장부, 리터럴</summary>

```text
Aggregate  (cost=1630.33..1630.34 rows=1 width=30) (actual time=3.596..3.597 rows=1 loops=1)
  Buffers: shared hit=4621
  ->  Nested Loop  (cost=8.11..1630.33 rows=1 width=8) (actual time=0.240..3.537 rows=899 loops=1)
        Buffers: shared hit=4621
        ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.68..1621.86 rows=1 width=24) (actual time=0.230..0.957 rows=924 loops=1)
              Recheck Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
              Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
              Heap Blocks: exact=921
              Buffers: shared hit=925
              ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.68 rows=433 width=0) (actual time=0.130..0.131 rows=924 loops=1)
                    Index Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                    Buffers: shared hit=4
        ->  Index Scan using uq_transaction_id_ledger on transaction t1_0  (cost=0.43..8.46 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=924)
              Index Cond: ((id = tl1_0.transaction_id) AND (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid))
              Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
              Rows Removed by Filter: 0
              Buffers: shared hit=3696
Planning:
  Buffers: shared hit=16
Planning Time: 0.163 ms
Execution Time: 3.634 ms
```

</details>

<details>
<summary>(a) 확장 통계, <code>perf_mix_50k</code> 사본, 계좌 하나 잔액, 큰 장부, 리터럴</summary>

```text
Finalize Aggregate  (cost=60744.84..60744.85 rows=1 width=30) (actual time=23.040..27.553 rows=1 loops=1)
  Buffers: shared hit=55115
  ->  Gather  (cost=60744.62..60744.83 rows=2 width=32) (actual time=22.914..27.546 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=55115
        ->  Partial Aggregate  (cost=59744.62..59744.63 rows=1 width=32) (actual time=20.309..20.310 rows=1 loops=3)
              Buffers: shared hit=55115
              ->  Nested Loop  (cost=133.27..59733.09 rows=4611 width=8) (actual time=1.074..20.123 rows=3644 loops=3)
                    Buffers: shared hit=55115
                    ->  Parallel Bitmap Heap Scan on transaction_line tl1_0  (cost=132.84..27285.93 rows=4753 width=24) (actual time=1.056..6.726 rows=3749 loops=3)
                          Recheck Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                          Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Heap Blocks: exact=4522
                          Buffers: shared hit=10125
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..129.99 rows=11408 width=0) (actual time=1.756..1.756 rows=11247 loops=1)
                                Index Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                                Buffers: shared hit=13
                    ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..6.83 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=11247)
                          Index Cond: (id = tl1_0.transaction_id)
                          Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text) AND (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid))
                          Rows Removed by Filter: 0
                          Buffers: shared hit=44990
Planning:
  Buffers: shared hit=16
Planning Time: 0.180 ms
Execution Time: 27.578 ms
```

</details>

<details>
<summary>(a) 확장 통계, <code>perf_mix_50k</code> 사본, 계좌 하나 잔액, 큰 장부, 일반 계획</summary>

```text
Aggregate  (cost=5399.13..5399.15 rows=1 width=30) (actual time=628.595..628.599 rows=1 loops=1)
  Buffers: shared hit=1 read=60101
  ->  Hash Join  (cost=1719.56..5399.13 rows=1 width=8) (actual time=119.979..627.415 rows=10932 loops=1)
        Hash Cond: (t1_0.id = tl1_0.transaction_id)
        Buffers: shared hit=1 read=60101
        ->  Bitmap Heap Scan on transaction t1_0  (cost=30.71..3708.41 rows=497 width=16) (actual time=9.047..505.003 rows=48499 loops=1)
              Recheck Cond: ((ledger_id = $5) AND (occurred_on >= $2))
              Filter: ((deleted_at IS NULL) AND ((status)::text <> ($3)::text))
              Rows Removed by Filter: 1501
              Heap Blocks: exact=49914
              Buffers: shared read=49977
              ->  Bitmap Index Scan on ix_transaction_ledger_occurred_on  (cost=0.00..30.59 rows=1016 width=0) (actual time=3.441..3.441 rows=50000 loops=1)
                    Index Cond: ((ledger_id = $5) AND (occurred_on >= $2))
                    Buffers: shared read=63
        ->  Hash  (cost=1683.21..1683.21 rows=451 width=24) (actual time=110.214..110.215 rows=11247 loops=1)
              Buckets: 16384 (originally 1024)  Batches: 1 (originally 1)  Memory Usage: 744kB
              Buffers: shared hit=1 read=10124
              ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.93..1683.21 rows=451 width=24) (actual time=1.997..108.584 rows=11247 loops=1)
                    Recheck Cond: (account_id = $1)
                    Filter: (ledger_id = $4)
                    Heap Blocks: exact=10112
                    Buffers: shared hit=1 read=10124
                    ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.81 rows=451 width=0) (actual time=0.952..0.952 rows=11247 loops=1)
                          Index Cond: (account_id = $1)
                          Buffers: shared read=13
Planning:
  Buffers: shared hit=2 read=14
Planning Time: 0.728 ms
Execution Time: 628.635 ms
```

</details>

<details>
<summary>(b1) 배열 <code>unnest</code>, <code>perf_mix_50k</code> 사본, 장부 전체 잔액, 큰 장부, 리터럴</summary>

```text
GroupAggregate  (cost=16599.45..16599.99 rows=24 width=46) (actual time=2169.030..2173.356 rows=10 loops=1)
  Group Key: l.account_id
  Buffers: shared hit=162418 read=109391
  ->  Sort  (cost=16599.45..16599.51 rows=24 width=24) (actual time=2168.675..2170.415 rows=53326 loops=1)
        Sort Key: l.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=162418 read=109391
        ->  Nested Loop  (cost=8.26..16598.90 rows=24 width=24) (actual time=1.891..2153.009 rows=53326 loops=1)
              Join Filter: (t.occurred_on >= a.opening_date)
              Buffers: shared hit=162418 read=109391
              ->  Nested Loop  (cost=7.83..16295.61 rows=73 width=44) (actual time=1.877..1128.100 rows=54981 loops=1)
                    Buffers: shared hit=10275 read=41610
                    ->  Function Scan on a  (cost=0.01..0.11 rows=10 width=20) (actual time=0.004..0.020 rows=10 loops=1)
                    ->  Bitmap Heap Scan on transaction_line l  (cost=7.83..1629.48 rows=7 width=40) (actual time=0.981..111.872 rows=5498 loops=10)
                          Recheck Cond: (account_id = a.id)
                          Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Heap Blocks: exact=51808
                          Buffers: shared hit=10275 read=41610
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.83 rows=453 width=0) (actual time=0.472..0.472 rows=5498 loops=10)
                                Index Cond: (account_id = a.id)
                                Buffers: shared hit=12 read=65
              ->  Index Scan using transaction_pkey on transaction t  (cost=0.43..4.14 rows=1 width=20) (actual time=0.018..0.018 rows=1 loops=54981)
                    Index Cond: (id = l.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text) AND (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=152143 read=67781
Planning:
  Buffers: shared hit=2 read=14
Planning Time: 0.762 ms
Execution Time: 2173.589 ms
```

</details>

<details>
<summary>(b1) 배열 <code>unnest</code>, <code>perf_mix_50k</code> 사본, 장부 전체 잔액, 보통 장부, 리터럴</summary>

```text
GroupAggregate  (cost=9972.45..9972.48 rows=1 width=46) (actual time=11.169..11.415 rows=6 loops=1)
  Group Key: l.account_id
  Buffers: shared hit=16458
  ->  Sort  (cost=9972.45..9972.46 rows=1 width=24) (actual time=11.123..11.228 rows=3192 loops=1)
        Sort Key: l.account_id
        Sort Method: quicksort  Memory: 221kB
        Buffers: shared hit=16458
        ->  Nested Loop  (cost=8.26..9972.44 rows=1 width=24) (actual time=0.222..10.699 rows=3192 loops=1)
              Join Filter: (t.occurred_on >= a.opening_date)
              Buffers: shared hit=16458
              ->  Nested Loop  (cost=7.83..9948.81 rows=3 width=44) (actual time=0.214..3.120 rows=3289 loops=1)
                    Buffers: shared hit=3302
                    ->  Function Scan on a  (cost=0.01..0.07 rows=6 width=20) (actual time=0.004..0.007 rows=6 loops=1)
                    ->  Bitmap Heap Scan on transaction_line l  (cost=7.83..1658.11 rows=1 width=40) (actual time=0.088..0.475 rows=548 loops=6)
                          Recheck Cond: (account_id = a.id)
                          Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                          Heap Blocks: exact=3282
                          Buffers: shared hit=3302
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.83 rows=453 width=0) (actual time=0.043..0.043 rows=548 loops=6)
                                Index Cond: (account_id = a.id)
                                Buffers: shared hit=20
              ->  Index Scan using transaction_pkey on transaction t  (cost=0.43..7.87 rows=1 width=20) (actual time=0.002..0.002 rows=1 loops=3289)
                    Index Cond: (id = l.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text) AND (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=13156
Planning:
  Buffers: shared hit=16
Planning Time: 0.214 ms
Execution Time: 11.466 ms
```

</details>

<details>
<summary>(b2) 계좌별 <code>LATERAL</code>, <code>perf_mix_50k</code> 사본, 장부 전체 잔액, 큰 장부, 리터럴</summary>

```text
Nested Loop  (cost=1749.50..17495.27 rows=10 width=46) (actual time=788.774..2981.241 rows=10 loops=1)
  Buffers: shared hit=150960 read=120849
  ->  Function Scan on a  (cost=0.01..0.11 rows=10 width=20) (actual time=0.004..0.030 rows=10 loops=1)
  ->  Aggregate  (cost=1749.49..1749.51 rows=1 width=30) (actual time=298.119..298.119 rows=1 loops=10)
        Filter: (count(*) > 0)
        Buffers: shared hit=150960 read=120849
        ->  Nested Loop  (cost=8.26..1749.48 rows=2 width=8) (actual time=1.296..296.816 rows=5333 loops=10)
              Buffers: shared hit=150960 read=120849
              ->  Bitmap Heap Scan on transaction_line l  (cost=7.83..1690.29 rows=7 width=24) (actual time=1.215..148.100 rows=5498 loops=10)
                    Recheck Cond: (account_id = a.id)
                    Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                    Heap Blocks: exact=51808
                    Buffers: shared hit=9773 read=42112
                    ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.83 rows=453 width=0) (actual time=0.661..0.661 rows=5498 loops=10)
                          Index Cond: (account_id = a.id)
                          Buffers: shared hit=12 read=65
              ->  Index Scan using uq_transaction_id_ledger on transaction t  (cost=0.43..8.46 rows=1 width=16) (actual time=0.026..0.026 rows=1 loops=54981)
                    Index Cond: ((id = l.transaction_id) AND (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid))
                    Filter: ((deleted_at IS NULL) AND (occurred_on >= a.opening_date) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=141187 read=78737
Planning:
  Buffers: shared hit=5 read=11
Planning Time: 0.519 ms
Execution Time: 2981.401 ms
```

</details>
