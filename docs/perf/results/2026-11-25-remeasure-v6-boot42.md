# V6과 Spring Boot 4.2 뒤 다시 재기 (2026-11-25)

> **한계를 먼저 읽는다.**
> - 맥 로컬 Docker에서 **DB 실행 시간만** 잰 것이다. API 지연이 아니다. **운영 서버 수치가 아니다**(Apple M5 Pro, CPU 상한 없음, 운영은 Ampere A1 4 OCPU).
> - **이 측정의 시간은 참고값이다.** 맥에서 다른 봇의 worker(Gradle 테스트, Testcontainers)가 같이 돌아 load average(1분)가 회차에 따라 4.0~40.9였다(2장의 회차 표). 판정은 계획 모양, 훑는 테이블, 버퍼 수로 하고 시간으로 하지 않는다. `perf_l1000_3m`은 V5 회차와 V6 회차의 load가 서로 달라 **시간을 비교하지 않는다**(첫 실행은 V5 5.4~9.5 / V6 4.8~4.9. 다시 만들어 재실행한 것은 모든 회차 22.7~40.9로 높다). `perf_mix_50k`도 load 4.0~6.7에서 쟀고 회차마다 시간이 흔들려 시간 차이를 V6의 효과로 읽지 않는다.
> - 쿼리를 한 번에 하나씩 돌렸다. 동시 요청은 재지 않았다. 표본은 7개다(백분위가 아니다). 시간은 `EXPLAIN (ANALYZE, BUFFERS)`의 `Execution Time`이고 노드마다 시간을 재는 비용이 들어 있다.
> - 같은 DB에서 V6을 적용하기 전후를 쟀다. V6을 적용하면 `VACUUM (ANALYZE)`를 같이 하므로, V6 없이 `VACUUM (ANALYZE)`만 한 회차(V5 3회차)를 사이에 두어 통계 표본이 다시 뽑히는 몫을 가른다. 통계는 표본이라 `ANALYZE`를 할 때마다 예상 행 수가 조금씩 다르고, 같은 쿼리도 병렬 여부가 바뀔 수 있다.
> - `account`는 7,500~7,510행짜리 작은 테이블(약 100블록)이다.
> - V6 전후의 `account` 데이터는 같은 값이고, `account`의 행 위치(ctid)도 같다(4장에서 확인). 데이터의 나머지 한계(날짜 순 입력, 수정 흔적 없는 테이블, 휴지통 2%, `change_log` 없음 등)는 [1차 문서](2026-11-24-query-baseline.md)와 같다.
> - **기준은 main 18a1c49(V1~V6, Spring Boot 4.2.0)이다.** PR #154의 `cast(... as numeric(38,0))`는 이번 측정에 없다. 이 문서를 쓴 때의 main(38a65a3)에는 V7~V9가 더 있다. 다섯 쿼리의 SQL 대조도 18a1c49의 것이다.
> - Spring Boot 4.2 대조는 SQL 문장, 바인드 타입, pgJDBC 동작만 본 것이다. 쿼리 시간은 다시 재지 않았다.
> - 시드 절차 확인 중 시드 시간은 다른 worker 때문에 앞의 문서보다 길다(4.1).

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-25 |
| 잰 사람 | perf가 맡긴 작업자. 6장(왜 이 수치인지)은 perf가 썼다 |
| 커밋 | 서버 코드, 마이그레이션, 쿼리 파일은 main 18a1c49. `perf/run-diagnosis.sh`에 V6 단계(`v6-seed`, `v6`)를 더해 쟀다(이 PR의 `perf/run-diagnosis.sh`) |
| 이슈 | [#146](https://github.com/lomong7807/akkimpyo/issues/146). 앞선 측정: [2026-11-24 쿼리 기준선](2026-11-24-query-baseline.md), [2026-11-25 잔액 진단](2026-11-25-balance-diagnosis.md) |

## 1. 결과 요약

- V6 뒤 `account` 전체 훑기는 없어졌다. 큰 장부는 그대로 상한 밖이고 #58이 푼다(6장).
- **시드와 절차**: main V1~V6에서 `perf/seed.sql`은 **고치지 않고** 그대로 들어갔다. README의 여덟 DB를 모두 V1~V6으로 만들었고 건수가 앞의 두 문서와 같으며 점검 쿼리는 모두 0건이다. V1만 적용한 DB(1만 2천 건)와 V1~V5까지만 적용한 DB(`perf_l1000_3m`, `perf_mix_50k`)의 내용 해시와 저장 위치 해시도 V1~V6의 것과 같다. `perf/README.md`의 절차(1~6번)와 7번 진단 측정의 전 단계가 돌았다(작은 DB).
- **V6 앞뒤**: 장부 전체 잔액의 **모든 조건**(`perf_mix_50k`의 큰 장부·보통 장부, `perf_l1000_3m`의 보통 장부, 리터럴과 일반 계획)에서 `account`의 **Seq Scan이 Bitmap Index Scan `uq_account_name` + Bitmap Heap Scan으로 바뀐다**. Index Scan으로 바뀌는 조건은 없었다. `transaction`과 `transaction_line`의 Seq Scan은 앞뒤 모두 없다. V6 전 세 회차(`VACUUM (ANALYZE)`만 한 것 포함)는 모두 `account`를 훑었다. 조건별 버퍼 변화는 4.2의 표에 있다. 계좌 하나 잔액은 V6의 영향을 받는 계획이 아니다(계획에 `account`가 없다).
- **버퍼**: 장부 전체 잔액에서 `account`를 읽는 블록은 V5가 `perf_mix_50k` 큰 장부 101블록(hit 1, read 100)과 `perf_l1000_3m` 보통 장부 100블록(모두 hit), V6이 둘 다 3블록(인덱스 2 + 테이블 1)이다. 큰 장부(`perf_mix_50k`) 실행 전체의 버퍼 read는 V5 125,512~125,604에서 V6 125,396~125,494다. 보통 장부의 실행 전체 hit는 V5 16,563~16,564, V6 16,466이고 read는 앞뒤 모두 0이다.
- **시간**: 참고값이다. 큰 장부(`perf_mix_50k`)의 장부 전체 잔액 중앙값(리터럴)은 V5 2,217.8 / 2,249.2 / 2,452.2ms(세 번째는 `VACUUM (ANALYZE)`만), V6 2,180.1 / 2,486.7ms다. 보통 장부(`perf_l1000_3m` 첫 실행, 리터럴) 중앙값은 V5 8.242 / 9.130 / 9.798ms, V6 7.243 / 11.022ms다(4.2 표).
- **Spring Boot 4.2**: Hibernate 7.4.15.Final, pgJDBC 42.7.14(1차는 6.6.53.Final, 42.7.11). `perf/queries/`의 **다섯 SQL이 글자 단위로 같고** 로그의 바인드 타입도 같다. 그래서 쿼리는 다시 재지 않았다.
- **pgJDBC 42.7.14**: `PrepareThresholdCheck`의 출력이 42.7.11과 **같다**. 서버 쪽 준비된 문장은 5번째 실행에서 만들어지고(`{uuid,"character varying"}`), 값에 맞춘 계획 5번(5~9번째) 뒤 10번째 실행부터 일반 계획이다.

## 2. 환경

| 항목 | 값 |
|---|---|
| 장비 | 맥, Apple M5 Pro(CPU 15개), 메모리 48GB, macOS 27.0.1(26A434), AC 전원 |
| Docker | Docker Desktop, Docker 29.9.2, Compose 5.6.1. VM에 CPU 10개, 메모리 8,214,786,048바이트(약 7.7GB), 리눅스 7.0.14-linuxkit. 같은 VM에 Docker Desktop의 Kubernetes가 있다(`docker info`의 실행 중 컨테이너 23~25개, `docker ps`에는 측정용 컨테이너와 다른 worker의 컨테이너가 보임) |
| PostgreSQL | 17.12, arm64 (`postgres:17@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac`, 앞의 두 문서와 같은 이미지) |
| 컨테이너 한도 | 메모리 1GB, 스왑 없음, `/dev/shm` 256MB, CPU 상한 없음(`perf/compose.diag.yaml`로 띄움, 앞의 진단 측정과 같음) |
| DB 설정 | `shared_buffers` 256MB, `work_mem` 4MB, `effective_cache_size` 4GB, `random_page_cost` 4, `max_parallel_workers_per_gather` 2, `jit` on, `track_io_timing` off, `plan_cache_mode` auto, `default_statistics_target` 100, `autovacuum` on(측정 중 실행 없음) |
| 서버와 드라이버 | Spring Boot 4.2.0, Hibernate 7.4.15.Final, HikariCP 7.1.0, pgJDBC 42.7.14 (`./gradlew dependencies`). 1차·진단 때는 Spring Boot 3.5.16, Hibernate 6.6.53.Final, HikariCP 6.3.3, pgJDBC 42.7.11 |
| JDK | 21.0.3(Corretto). `PrepareThresholdCheck` 실행에 쓴 것 |

회차마다의 load average와 다른 컨테이너는 다음과 같다. "회차 구간의 load"는 그 회차 안에서 쿼리 묶음마다 잰 1분 load average의 범위다. 절전 기록(`pmset -g log`)은 측정 구간에 없다. 스크립트가 `caffeinate -dims`를 건다.

| 실행 | DB | 회차 | 시작(KST) | load 1분(시작) | 회차 구간의 load | 다른 컨테이너(docker ps) | docker info 실행 중 전체 |
|---|---|---|---|---|---|---|---|
| 첫 실행 | `perf_l1000_3m` | V5 1회차 | 16:50:06 | 9.5 | 9.5~9.5 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_l1000_3m` | V5 2회차 | 16:53:10 | 7.4 | 7.4~7.4 | 3(그중 testcontainers 2) | 25 |
| 첫 실행 | `perf_l1000_3m` | V5 3회차(`VACUUM (ANALYZE)`만) | 16:56:20 | 5.4 | 5.4~5.4 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_l1000_3m` | V6 4회차 | 16:56:38 | 4.9 | 4.9~4.9 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_l1000_3m` | V6 5회차 | 16:56:40 | 4.8 | 4.8~4.8 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_mix_50k` | V5 1회차 | 16:56:47 | 4.6 | 4.0~5.3 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_mix_50k` | V5 2회차 | 16:57:45 | 4.9 | 4.9~6.7 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_mix_50k` | V5 3회차(`VACUUM (ANALYZE)`만) | 17:00:14 | 4.8 | 4.7~5.7 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_mix_50k` | V6 4회차 | 17:04:15 | 6.3 | 5.3~6.3 | 2(그중 testcontainers 1) | 24 |
| 첫 실행 | `perf_mix_50k` | V6 5회차 | 17:05:34 | 4.8 | 4.8~6.5 | 2(그중 testcontainers 1) | 24 |
| 재실행(load 때문에 `perf_l1000_3m`만) | `perf_l1000_3m` | V5 1회차 | 17:17:16 | 23.8 | 22.9~24.1 | 3(그중 testcontainers 1) | 25 |
| 재실행(load 때문에 `perf_l1000_3m`만) | `perf_l1000_3m` | V5 2회차 | 17:17:27 | 24.1 | 24.1~27.5 | 3(그중 testcontainers 1) | 25 |
| 재실행(load 때문에 `perf_l1000_3m`만) | `perf_l1000_3m` | V5 3회차(`VACUUM (ANALYZE)`만) | 17:17:52 | 24.3 | 22.7~24.3 | 1(그중 testcontainers 0) | 23 |
| 재실행(load 때문에 `perf_l1000_3m`만) | `perf_l1000_3m` | V6 4회차 | 17:18:26 | 37.4 | 37.4~40.9 | 1(그중 testcontainers 0) | 23 |
| 재실행(load 때문에 `perf_l1000_3m`만) | `perf_l1000_3m` | V6 5회차 | 17:18:39 | 38.4 | 36.5~38.4 | 1(그중 testcontainers 0) | 23 |

- 다른 컨테이너는 다른 봇의 Testcontainers와 검증용 컨테이너다(`docker ps`에 보인 이름: `beautiful_williamson`, `condescending_tu`, `zealous_solomon`, `musing_allen`, `elastic_davinci`, `testcontainers-ryuk-...`, `line-ledger-fk-probe`). 측정용 컨테이너(`akkimpyo-perf-db-1`)는 건드리지 않았다.
- 16:57:34에 작업자가 측정 중 측정용 DB의 카탈로그(`pg_constraint`)를 두 번 읽었다(`perf_mix_50k` V5 1회차의 계좌 하나 잔액과 겹친다). 앞선 EXPLAIN 확인(약 16:10)은 측정 시작 전이다.
- `perf_l1000_3m`은 두 번 쟀다. 첫 실행(위의 표)과, DB를 지우고 V5까지 **다시 만들어** 앞뒤를 새로 잰 재실행(시드 17:06:30, 회차 17:17:16~17:18:45)이다. 재실행은 모든 회차의 load가 22.7~40.9라 시간이 크게 늘었다(보통 장부 장부 전체 잔액 중앙값 V5 13.5~35.0ms, V6 33.8~50.0ms. 최댓값은 206.6ms, V6 5회차 리터럴). 버퍼와 장부 전체 잔액의 계획은 첫 실행과 같다(계좌 하나 잔액 리터럴의 병렬 여부만 다르다, 4.2).
- 처음 시도한 회차 하나는 버렸다: `perf_l1000_3m` V5 1회차를 load 36~37에서 16:17에 쟀고 2회차를 시작하다가 멈췄다(V6 적용 전). 그 회차의 값은 쓰지 않는다.

## 3. 방법

`perf/README.md`의 절차와 앞의 진단 측정(`2026-11-25-balance-diagnosis.md` 3장의 "캐시 상태를 맞춘 방법")과 같다.

```sh
# 시드 절차 확인(README의 여덟 DB를 V1~V6으로)
mkdb perf_l1_12k && perfsql -d perf_l1_12k < perf/seed.sql        # 그 밖의 여섯 DB는 README 2, 3번의 명령
grep -v flyway_schema_history docs/db/integrity-checks.sql | perfsql -d perf_l1_12k
OUT=... DBS=perf_small perf/run-diagnosis.sh up seed base e1 e2 e3 e4 e5 e6 e7 base-again sleep-log

# V6 앞뒤
OUT=... DBS="perf_l1000_3m perf_mix_50k" perf/run-diagnosis.sh up v6-seed v6 sleep-log
# load가 높아 perf_l1000_3m만 다시 만들어 재실행
OUT=... DBS=perf_l1000_3m perf/run-diagnosis.sh v6-seed v6 sleep-log
node perf/summarize-diagnosis.mjs "$OUT"

# Spring Boot 4.2 SQL 대조: README의 "쿼리 파일을 다시 가져오는 법"의 명령 그대로
# pgJDBC 동작
java -cp <postgresql-42.7.14.jar> perf/PrepareThresholdCheck.java jdbc:postgresql://localhost:5434/perf_mix_50k 1001
java -cp <postgresql-42.7.11.jar> perf/PrepareThresholdCheck.java jdbc:postgresql://localhost:5434/perf_mix_50k 1001   # 대조용

OUT=... perf/run-diagnosis.sh down
```

- 10번 중 뒤 7번의 최솟값, 중앙값, 최댓값을 적는다. 10번은 한 psql 세션이다.
- 순서: DB마다 V5까지의 상태에서 V5 1회차, 2회차 → `VACUUM (ANALYZE)`만 다시 하고 V5 3회차 → V6을 적용하고 `VACUUM (ANALYZE)` 뒤 V6 4회차, 5회차. **V6은 되돌리지 않았다.** 그래서 앞뒤를 번갈아 재지 않고 앞에서 두 회차(와 통계만 다시 모은 한 회차), 뒤에서 두 회차를 쟀다.
- 회차마다 시작할 때 PostgreSQL을 재시작하고 측정용 DB 파일을 OS 페이지 캐시에서 내린다(`fresh`). VM 전체 캐시는 비우지 않는다.
- 큰 장부(1001)는 `perf_mix_50k`에만 있다. `perf_l1000_3m`은 큰 장부가 없어 보통 장부만 잰다(장부 1). 리터럴과 일반 계획(`force_generic_plan`)을 모두 잰다.
- `perf_l1000_3m`과 `perf_mix_50k`는 V1~V5까지만 적용해 만들고, 앞의 문서와 건수, 내용 해시, 저장 위치 해시가 같은지 확인한 뒤 V6을 적용했다(4.1, 4.2). V6을 적용한 뒤의 DB도 같은 해시로 비교했다.
- `docker info`의 실행 중 컨테이너 수는 Kubernetes를 포함한다(23~25). 앞의 진단 측정은 22였다.

## 4. 결과

### 4.1 시드와 README 절차(main V1~V6)

| 확인 | 결과 |
|---|---|
| `perf/seed.sql`을 V1~V6을 적용한 빈 DB에 넣기 | 그대로 들어간다. **고치지 않았다**(`perf/seed.sql` 변경 없음) |
| README의 여덟 DB(`perf_l1_12k`, `perf_l1_50k`, `perf_one_10k`, `perf_one_50k`, `perf_one_200k`, `perf_l1000_3m`, `perf_mix_50k`, `perf_mix_200k`) | 모두 시드 성공(오류 없음). 점검 쿼리(`docs/db/integrity-checks.sql`)는 여덟 DB 모두 0건(점검 15개 결과 집합이 모두 0행, `flyway_schema_history` 한 줄은 뺐다) |
| 앞의 두 문서와 건수 비교 | 여덟 DB의 거래·라인·삭제·취소 건수가 모두 같다 |
| V1만 적용한 DB와 V1~V6을 적용한 DB(1만 2천 건) | 내용 해시와 저장 위치(ctid) 해시가 같다 |
| V1~V5와 V1~V6을 각각 적용한 `perf_l1000_3m`, `perf_mix_50k` | 내용 해시와 저장 위치 해시가 같다 |
| main 18a1c49 이후의 V7~V9(38a65a3) | 1만 2천 건 DB에 V1~V9를 적용한 뒤 시드가 그대로 들어가고 해시가 같다(큰 DB는 시드하지 않았다) |
| README 4번(pg_stat_statements), 5번(측정 함수, 일반 계획) | 명령이 그대로 돈다(1만 2천 건) |
| README 7번(진단 측정) | `DBS=perf_small`로 `up seed base e1 ... e7 base-again sleep-log` 전체가 오류 없이 끝난다(`rc=0`, 요약 182줄). 결과 값은 작은 시험 데이터라 쓰지 않는다 |
| README 6번 | `dc down -v`로 컨테이너와 볼륨을 지운다(시드 확인 뒤, 측정 뒤 각각 확인) |

- 큰 DB의 시드 시간은 다른 worker가 같이 도는 동안 105초(`perf_l1000_3m`), 165초(`perf_mix_50k`), 193초(`perf_mix_200k`)였다(앞의 문서 80~102초). load 1분은 5.9~14.7이었다. 시드 시간은 이번 측정 대상이 아니다.
- `perf/README.md`에서 바뀐 것: 8번(V6 앞뒤 비교) 추가, `PrepareThresholdCheck` 명령의 jar 버전, 쿼리 파일 재대조 기록, 고쳐야 하는 때. 스크립트에서 바뀐 것: `v6-seed`, `v6` 단계와 `MAX_LOAD`(load가 높으면 기다리는 선택 기능), `mkdb`에 적용할 마지막 버전을 줄 수 있게 한 것, `perf_l1000_3m` 시드.

### 4.2 V6 앞뒤 비교

같은 DB에서 V6을 적용하기 전과 뒤를 쟀다. V6은 `account`의 `name`을 `text`로 바꾸고 CHECK 셋과 `uq_account_name` `UNIQUE (ledger_id, name)`을 더한다(PR #139).

| 확인 | `perf_mix_50k` | `perf_l1000_3m` |
|---|---|---|
| V6 적용 뒤 `account`의 `relfilenode` | 바뀌지 않았다(테이블을 다시 쓰지 않음) | 바뀌지 않았다 |
| V6 전후 테이블 건수·내용 해시·저장 위치 해시 | 일곱 테이블 모두 같다 | 일곱 테이블 모두 같다 |
| `account` 크기(블록 / 행) | 101블록, 7,510행 | 100블록, 7,500행 |
| V6 뒤 새 인덱스 | `uq_account_name`(`ledger_id`, `name`), 393,216바이트, 48블록 | 같은 정의, 같은 크기 |
| V5 회차에서 쓰인 `account` 인덱스 | 없음(`account`를 훑음) | 없음 |
| V6 회차에서 쓰인 `account` 인덱스 | `uq_account_name` | `uq_account_name` |

- V5의 세 회차(`VACUUM (ANALYZE)`만 다시 한 3회차 포함)에서 장부 전체 잔액의 계획은 모든 조건에서 같고 `account`를 훑는다. V6의 두 회차는 모든 조건에서 서로 같고 `account`를 훑지 않는다.
- 새 인덱스는 **Index Scan이 아니라** Bitmap Index Scan으로 쓰인다(조건은 `ledger_id = 값` 하나). 두 DB, 두 장부(큰 장부는 `perf_mix_50k`만), 리터럴과 일반 계획 모두 같다.
- 계좌 하나 잔액의 계획에는 `account`가 없어 V6의 영향을 받지 않는다. 다만 `perf_l1000_3m` 첫 실행의 V6 회차(4, 5)에서 계좌 하나 잔액의 리터럴이 병렬(작업자 1, 예상 815행)로 바뀌었다. 같은 DB를 다시 만들어 한 재실행의 V6 회차는 비병렬(예상 416행)이고, V6을 적용하지 않은 V5 3회차도 비병렬(예상 417행)이다.
- 시간 칸은 참고값이다(위의 한계). 큰 장부(`perf_mix_50k`)의 장부 전체 잔액 실행당 블록 장치 읽기 중앙값은 V5 회차 687.5~725.7MB, V6 회차 672.3~712.9MB다.

#### 5만(`perf_mix_50k`)

시간(ms, 최소 / 중앙 / 최대, 10번 중 뒤 7번)

| 쿼리 | 장부 | 방식 | V5 1회차 | V5 2회차 | V5 3회차(`VACUUM (ANALYZE)`만) | V6 4회차 | V6 5회차 |
|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | 2,103.2 / 2,217.8 / 2,579.4 | 2,130.9 / 2,249.2 / 2,660.0 | 2,144.8 / 2,452.2 / 2,709.2 | 1,837.9 / 2,180.1 / 2,590.6 | 2,132.2 / 2,486.7 / 3,248.2 |
| 장부 전체 잔액 | 큰 | 일반 계획 | 1,981.4 / 2,186.1 / 2,484.0 | 2,029.3 / 2,129.4 / 2,486.7 | 2,365.3 / 2,732.0 / 2,986.6 | 2,046.5 / 2,125.0 / 2,778.4 | 2,077.1 / 2,094.8 / 2,739.6 |
| 장부 전체 잔액 | 보통 | 리터럴 | 7.280 / 8.608 / 9.794 | 11.296 / 12.311 / 15.225 | 9.163 / 10.504 / 10.678 | 9.777 / 11.174 / 12.078 | 7.059 / 8.947 / 9.565 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 7.638 / 9.181 / 9.646 | 11.029 / 11.563 / 13.609 | 12.065 / 13.451 / 17.409 | 8.861 / 9.924 / 11.287 | 7.018 / 9.145 / 9.238 |
| 계좌 하나 잔액 | 큰 | 리터럴 | 20.202 / 24.566 / 26.007 | 32.987 / 35.031 / 46.406 | 38.940 / 41.882 / 46.576 | 20.492 / 22.893 / 26.350 | 22.824 / 25.532 / 25.936 |
| 계좌 하나 잔액 | 큰 | 일반 계획 | 25.437 / 27.554 / 28.115 | 34.160 / 38.248 / 45.368 | 42.398 / 44.603 / 51.981 | 33.522 / 34.798 / 36.335 | 34.051 / 37.694 / 46.013 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 1.557 / 2.205 / 2.461 | 1.565 / 1.753 / 2.421 | 2.662 / 3.079 / 4.283 | 1.947 / 2.668 / 3.467 | 2.256 / 3.066 / 3.334 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 1.810 / 2.172 / 2.761 | 2.664 / 3.353 / 3.857 | 2.934 / 3.493 / 4.407 | 1.824 / 2.201 / 2.908 | 1.793 / 2.024 / 2.968 |

버퍼와 계획

| 쿼리 | 장부 | 방식 | 버퍼 hit V5(1~3) | 버퍼 read V5(1~3) | 버퍼 hit V6(4~5) | 버퍼 read V6(4~5) | `account` 접근 V5 | `account` 접근 V6 | 계획 모양 | 훑는 테이블(Seq Scan) V5 / V6 | 쓰인 인덱스 V6 | 조인 예상 / 실제 V5 → V6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 큰 | 리터럴 | 148,555~148,637 | 125,515~125,597 | 148,570~148,658 | 125,396~125,484 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 1,447 / 53,326 → 1,445 / 53,326 |
| 장부 전체 잔액 | 큰 | 일반 계획 | 148,548~148,640 | 125,512~125,604 | 148,560~148,655 | 125,399~125,494 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 584 / 53,326 → 584 / 53,326 |
| 장부 전체 잔액 | 보통 | 리터럴 | 16,564 | 0 | 16,466 | 0 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 1,013 / 3,192 → 1,012 / 3,192 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 16,564 | 0 | 16,466 | 0 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 584 / 3,192 → 584 / 3,192 |
| 계좌 하나 잔액 | 큰 | 리터럴 | 55,923~55,925 | 0~2 | 55,923~55,925 | 0~2 | 계획에 없음 | 계획에 없음 | V5와 V6 같음 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 4,800 / 3,644 ×3 → 4,070 / 3,644 ×3 |
| 계좌 하나 잔액 | 큰 | 일반 계획 | 55,923 | 0 | 55,923 | 0 | 계획에 없음 | 계획에 없음 | V5와 V6 같음 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 74 / 10,932 → 74 / 10,932 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 4,623 | 0 | 4,623 | 0 | 계획에 없음 | 계획에 없음 | V5와 V6 같음 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 421 / 899 → 422 / 899 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 4,623 | 0 | 4,623 | 0 | 계획에 없음 | 계획에 없음 | V5와 V6 같음 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 74 / 899 → 74 / 899 |

#### 300만(`perf_l1000_3m`, 첫 실행)

시간(ms, 최소 / 중앙 / 최대, 10번 중 뒤 7번)

| 쿼리 | 장부 | 방식 | V5 1회차 | V5 2회차 | V5 3회차(`VACUUM (ANALYZE)`만) | V6 4회차 | V6 5회차 |
|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 보통 | 리터럴 | 7.779 / 8.242 / 9.543 | 8.419 / 9.130 / 9.961 | 8.928 / 9.798 / 11.980 | 5.710 / 7.243 / 7.631 | 5.567 / 11.022 / 14.429 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 8.265 / 8.863 / 10.351 | 6.313 / 7.904 / 8.557 | 9.037 / 9.664 / 10.475 | 6.199 / 7.446 / 7.998 | 7.878 / 8.472 / 9.463 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 1.542 / 1.692 / 2.377 | 1.579 / 1.751 / 2.602 | 1.759 / 2.196 / 2.602 | 2.192 / 2.344 / 2.767 | 2.484 / 2.862 / 3.284 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 1.477 / 1.624 / 2.405 | 1.962 / 2.392 / 2.592 | 1.707 / 2.107 / 2.470 | 1.216 / 1.573 / 1.788 | 1.196 / 1.527 / 1.947 |

버퍼와 계획

| 쿼리 | 장부 | 방식 | 버퍼 hit V5(1~3) | 버퍼 read V5(1~3) | 버퍼 hit V6(4~5) | 버퍼 read V6(4~5) | `account` 접근 V5 | `account` 접근 V6 | 계획 모양 | 훑는 테이블(Seq Scan) V5 / V6 | 쓰인 인덱스 V6 | 조인 예상 / 실제 V5 → V6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 보통 | 리터럴 | 16,563 | 0 | 16,466 | 0 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 998 / 3,192 → 995 / 3,192 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 16,563 | 0 | 16,466 | 0 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 576 / 3,192 → 575 / 3,192 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 4,623 | 0 | 4,624 | 0 | 계획에 없음 | 계획에 없음 | V5와 V6 다름 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 418 / 899 → 815 / 450 ×2 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 4,623 | 0 | 4,623 | 0 | 계획에 없음 | 계획에 없음 | V5와 V6 같음 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 73 / 899 → 73 / 899 |

#### 300만(`perf_l1000_3m`, 다시 만들어 재실행)

시간(ms, 최소 / 중앙 / 최대, 10번 중 뒤 7번)

| 쿼리 | 장부 | 방식 | V5 1회차 | V5 2회차 | V5 3회차(`VACUUM (ANALYZE)`만) | V6 4회차 | V6 5회차 |
|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 보통 | 리터럴 | 29.950 / 34.689 / 39.030 | 28.133 / 31.383 / 35.449 | 12.622 / 13.464 / 13.763 | 27.147 / 40.863 / 104.3 | 40.736 / 50.026 / 206.6 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 28.538 / 35.032 / 40.959 | 27.911 / 29.278 / 31.704 | 11.595 / 14.678 / 16.684 | 38.479 / 42.737 / 51.824 | 29.758 / 33.834 / 38.234 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 6.500 / 7.523 / 7.752 | 7.681 / 8.270 / 34.968 | 4.192 / 5.891 / 6.659 | 7.463 / 9.477 / 10.416 | 5.944 / 6.981 / 8.350 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 7.418 / 8.432 / 9.482 | 6.116 / 6.960 / 7.580 | 6.897 / 7.296 / 8.099 | 8.373 / 9.286 / 11.282 | 6.712 / 7.360 / 8.555 |

버퍼와 계획

| 쿼리 | 장부 | 방식 | 버퍼 hit V5(1~3) | 버퍼 read V5(1~3) | 버퍼 hit V6(4~5) | 버퍼 read V6(4~5) | `account` 접근 V5 | `account` 접근 V6 | 계획 모양 | 훑는 테이블(Seq Scan) V5 / V6 | 쓰인 인덱스 V6 | 조인 예상 / 실제 V5 → V6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 장부 전체 잔액 | 보통 | 리터럴 | 16,563 | 0 | 16,466 | 0 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 997 / 3,192 → 995 / 3,192 |
| 장부 전체 잔액 | 보통 | 일반 계획 | 16,563 | 0 | 16,466 | 0 | Seq Scan | Bitmap Heap Scan + Bitmap Index Scan `uq_account_name` | V5와 V6 다름 | `account` / 없음 | `uq_account_name`<br>`ix_transaction_line_account`<br>`transaction_pkey` | 575 / 3,192 → 575 / 3,192 |
| 계좌 하나 잔액 | 보통 | 리터럴 | 4,623 | 0 | 4,623 | 0 | 계획에 없음 | 계획에 없음 | V5와 V6 같음 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 418 / 899 → 416 / 899 |
| 계좌 하나 잔액 | 보통 | 일반 계획 | 4,623 | 0 | 4,623 | 0 | 계획에 없음 | 계획에 없음 | V5와 V6 같음 | 없음 / 없음 | `ix_transaction_line_account`<br>`transaction_pkey` | 73 / 899 → 72 / 899 |

### 4.3 Spring Boot 4.2 SQL 대조

기존 테스트를 SQL 로그를 켜고 돌려(커밋하지 않음) 다섯 쿼리의 문장을 다시 가져와 `perf/queries/`의 문장(`?`로 되돌린 것)과 글자 단위로 비교했다.

| 파일 | 글자 단위 비교 | 바인드 타입(로그) | `perf/queries/`의 `PREPARE` 타입 |
|---|---|---|---|
| `balance.sql` | 같다(214바이트) | UUID, DATE, VARCHAR | uuid, date, varchar |
| `balances.sql` | 같다(305바이트) | UUID, VARCHAR | uuid, varchar |
| `category-in-use.sql` | 같다(93바이트) | UUID, INTEGER | uuid, integer |
| `monthly-stats.sql` | 같다(354바이트) | UUID, DATE, DATE, VARCHAR | uuid, date, date, varchar |
| `trash-list.sql` | 같다(457바이트) | UUID | uuid |

- 로그의 바인드 타입은 테스트에서 찍힌 `org.hibernate.orm.jdbc.bind`의 값이다. 바뀐 것이 없다.
- **쿼리 시간은 다시 재지 않았다**(SQL이 같다). `perf/queries/`는 고치지 않았다.
- 서버 실행 때 드라이버와 라이브러리 버전: Hibernate 7.4.15.Final, pgJDBC 42.7.14, HikariCP 7.1.0(`./gradlew dependencies`의 `runtimeClasspath`).

### 4.4 pgJDBC 42.7.11 → 42.7.14: 준비된 문장으로 바뀌는 실행 번호(`PrepareThresholdCheck`)

`perf_mix_50k`(V6 적용)의 큰 장부(1001) 장부 전체 잔액을 같은 연결에서 14번 돌렸다. 두 드라이버를 같은 DB에서 각각 돌렸고, **1번째부터 14번째까지의 출력이 두 드라이버에서 같다**.

| 실행 | 42.7.14 | 42.7.11(대조) |
|---|---|---|
| 1~4번째 | 서버에 준비된 문장 없음 | 같음 |
| 5번째 | 준비된 문장 `S_1`(`{uuid,"character varying"}`), 값에 맞춘 계획 1번 | 같음 |
| 6~9번째 | 값에 맞춘 계획 2~5번 | 같음 |
| 10번째 | 일반 계획 1번(값에 맞춘 계획은 5번에서 멈춤) | 같음 |
| 11~14번째 | 일반 계획 2~5번 | 같음 |

- 드라이버가 찍은 기본값도 같다: `prepareThreshold=5`, `preparedStatementCacheQueries=256`, `preferQueryMode=extended`.
- 앞의 진단 측정의 42.7.11 기록과 같은 결과다(5번째에 준비된 문장, 10번째부터 일반 계획).
- 이 확인은 시간을 재는 것이 아니다. load가 높았던 때(17:19~17:26) 돌렸다.
- psql의 `PREPARE`로 보는 E4(진단 측정)는 다시 돌리지 않았다. 드라이버 수준까지다.

## 5. 측정 중 한계였던 자원

- **CPU**: 다른 worker와 같은 맥, 같은 Docker VM을 쓴다. 1분 load average 4.0~40.9(2장 표). CPU와 디스크 사용률은 따로 재지 않았다.
- **메모리**: 컨테이너의 `memory.current`는 최대 1,072,541,696바이트(한도 1GB = 1,073,741,824바이트)로 한도에 가깝다. `memory.events`의 `max`(한도에 닿은 횟수, 컨테이너를 띄운 뒤 누적) 655,360, `oom_kill` 0. `docker inspect`의 `OOMKilled`는 false.
- **autovacuum**: 측정 중 돌지 않았다(`pg_stat_user_tables`의 `last_autovacuum`이 모든 회차에서 비어 있다).
- 식은 캐시, 읽기 시간, 캐시 크기(E1~E3)는 이번에 다시 재지 않았다.

## 6. 왜 이 수치인지

perf가 4장의 표와 계획 원문(10장)을 읽고 썼다. "확인"은 이 문서의 값이고 "추정"은 거기서 끌어낸 설명이다.

### 6.1 `account` 전체 훑기가 없어진 것은 V6 때문이다

- 확인: 통계만 다시 모은 V5 3회차도 `account`를 훑었고, V6을 적용한 뒤의 두 회차는 모든 조건에서 훑지 않았다. 데이터와 저장 위치는 V6 앞뒤가 같다(4.2). 그래서 바뀐 까닭은 통계가 아니라 V6이 더한 `uq_account_name` (`ledger_id`, `name`)이다. 첫 열이 `ledger_id`라 장부 조건에 쓰인다.
- 확인: `account`에서 읽는 블록은 100~101에서 3으로 줄었다. 장부 전체 잔액 실행 하나의 버퍼로 보면 큰 장부(`perf_mix_50k`)는 약 27만 4천 가운데 98(약 0.04%), 보통 장부는 `perf_mix_50k`에서 16,564 가운데 98(약 0.6%, `perf_l1000_3m`은 16,563 가운데 97)이다.
- 추정: 줄어든 몫이 이만큼이라 시간 차이는 이 크기에서 거의 없을 것이다. 이번 시간은 load가 섞여 이 추정을 확인하지도 부정하지도 못한다.
- 추정: `account` 전체 훑기의 비용은 장부 하나가 아니라 전체 사용자의 계좌 수에 비례한다. V6 뒤에는 그 장부의 계좌 수로 묶인다. 지금 7,500행에서는 작지만 계좌가 늘어도 따라 늘지 않는 것이 이 변경의 의미다.
- 이슈 #6 뒤에 보기로 한 것(`account` 전체 훑기가 없어지는지)은 답이 났다: 없어졌다.

### 6.2 큰 장부의 장부 전체 잔액은 그대로 상한 밖이다

- 확인: 큰 장부의 버퍼 read는 V6 앞뒤 모두 약 12만 5천이고, 라인마다 거래를 찾는 중첩 루프가 그대로다(계획 원문의 `Index Scan using transaction_pkey`, loops 54,981). 앞선 진단 문서 6장의 원인이 남아 있다. V6은 이 원인을 건드리지 않는다. 푸는 것은 #58의 쿼리 변경이다.
- 시간은 참고값이지만 7번의 최솟값도 1.8초를 넘어(V6 1,837.9ms, V5 1,981.4ms) 상한 200ms와 자릿수가 다르다. load가 섞였어도 상한 밖이라는 판정은 바뀌지 않는다(앞선 진단의 조용한 측정도 1.9초였다).

### 6.3 Spring Boot 4.2

- 확인: 다섯 SQL과 바인드 타입이 같다(4.3). 같은 DB에서 DB가 하는 일이 Spring Boot 이전 앞뒤가 같다는 것은 SQL 문장과 로그의 바인드 타입이 같다는 데서 나온 추론이다. 서버가 받은 매개변수 타입은 장부 전체 잔액 하나로만 확인했다.
- 확인하지 못한 것: Hibernate 7.4의 객체 변환, 연결 풀, API 전체 시간. API가 생긴 뒤 k6로 잰다.
- 확인: 일반 계획으로 바뀌는 실행 번호가 pgJDBC 42.7.14에서도 같다(10번째, 4.4). 앞선 문서의 근거로 채택된 #112는 이 버전에서도 필요하다.

### 6.4 메모리

- 확인: `memory.current`가 한도에 가깝고(최대 1,072,541,696바이트, 한도 1,073,741,824바이트) `memory.events`의 `max`가 655,360이지만 `oom_kill`은 0이다(5장).
- 추정: 파일 캐시가 한도까지 차서 되돌려지는 정상 동작으로 본다. 쿼리가 쓰는 메모리와 파일 캐시의 몫은 나눠 재지 않았다.

### 6.5 다시 잴 것

- #58(잔액 쿼리를 장부 조건으로, PR #154의 cast 포함): `perf/queries/`를 그때의 SQL로 맞추고 조용한 시간에 시간까지 잰다.
- #112: 앱과 같은 연결 설정으로 10번 넘게 실행해 일반 계획으로 바뀌지 않는지.
- #67: 인덱스 없는 조회 세 곳. #9: 휴지통 부분 인덱스 뒤 인덱스 B 재판단(#113).
- V6의 시간 효과만 따로 다시 재지는 않는다(6.1의 이유).

## 7. 목표 대비 판정

기준은 [`docs/perf/README.md`](../README.md) 2장이다. 시간은 참고값이므로 **시간 상한 판정은 하지 않는다.** 다만 큰 장부의 장부 전체 잔액은 7번의 최솟값도 상한 200ms의 9배가 넘어 상한 밖 판정을 유지한다(6.2). 계획과 훑기는 다음과 같다.

| 쿼리 | 조건 | `transaction`·`transaction_line` 전체 훑기 | `account` 전체 훑기 V5 → V6 |
|---|---|---|---|
| 장부 전체 잔액 | `perf_mix_50k` 큰·보통, `perf_l1000_3m` 보통, 리터럴·일반 계획 | 없음(앞뒤 모두) | 있음 → 없음 |
| 계좌 하나 잔액 | 위와 같음 | 없음(앞뒤 모두) | 계획에 `account` 없음 |

- 장부 전체 잔액의 큰 장부는 이번에도 상한 200ms를 크게 넘는다(참고값, 7번의 최솟값~최댓값 V5 1,981.4~2,986.6ms, V6 1,837.9~3,248.2ms). 큰 장부의 버퍼 read는 V5 125,512~125,604, V6 125,396~125,494다.
- 보통 장부는 `perf_mix_50k`와 `perf_l1000_3m` 첫 실행에서 앞뒤 모두 17.4ms 안이다(7번의 최댓값, 참고값). 재실행(load 22.7~40.9)의 보통 장부는 최대 206.6ms다. 재실행 시간은 판정에 쓰지 않는다.
- 거래 목록 50건은 쿼리가 없어 재지 않았다. 월별 통계, 휴지통 목록, 카테고리 사용 여부는 V6과 무관하고 이번에 재지 않았다(4.3의 SQL 대조는 했다).

## 8. 확인과 추정

- 확인: 이 문서의 행 수, 버퍼, 계획 모양, 인덱스, 해시, 실행 번호, SQL 문장은 모두 이번에 직접 얻은 값이다. 계획 원문은 10장에 있다.
- 확인하지 않은 것: 시간은 load가 높은 조건의 값이라 V6의 시간 효과를 확인하지 않았다. 효과의 크기에 대한 설명은 6.1의 추정뿐이다.

## 9. 못 잰 것

- **조용한 상태의 V6 시간 비교**: 측정하는 동안 다른 봇의 worker가 계속 돌았다(2장 표). `perf_mix_50k`의 회차(16:56:47~17:06)가 qa가 비워 준 시간(16:57~17:17)과 겹치지만 그때의 load도 4.0~6.7이었다.
- **`perf_l1000_3m`의 큰 장부**: 그 DB에 큰 장부가 없다.
- **`perf_mix_200k`**: 요청에 없어 재지 않았다.
- 쿼리 시간을 Spring Boot 4.2에서 다시 재는 것: SQL이 같아 재지 않았다.
- `PrepareThresholdCheck`는 `perf_mix_50k`의 큰 장부 하나, 장부 전체 잔액 하나로 봤다.
- V6을 되돌린 상태의 반복 비교(앞뒤 번갈아 재기): V6을 되돌리지 않아 하지 않았다.
- 실제 앱(Hibernate) 경로의 계획 선택(E4의 psql 반복)은 이번에 다시 돌리지 않았다.

## 10. 대표 실행 계획 원문

각 원문은 그 회차 10번 가운데 뒤 7번의 중앙값(가운데 실행)이다. 일반 계획은 `$1` 등이 남은 계획이다.

<details>
<summary>V5 1회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 리터럴</summary>

```text
GroupAggregate  (cost=18867.40..18896.34 rows=1447 width=48) (actual time=2214.693..2217.639 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=148637 read=125515
  ->  Sort  (cost=18867.40..18871.02 rows=1447 width=24) (actual time=2214.451..2215.657 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=148637 read=125515
        ->  Nested Loop  (cost=8.36..18791.44 rows=1447 width=24) (actual time=1.945..2199.320 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=148637 read=125515
              ->  Nested Loop  (cost=7.93..16291.89 rows=4468 width=44) (actual time=1.881..1176.716 rows=54981 loops=1)
                    Buffers: shared hit=4371 read=49857
                    ->  Seq Scan on account a1_0  (cost=0.00..194.88 rows=10 width=20) (actual time=0.351..0.368 rows=10 loops=1)
                          Filter: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Rows Removed by Filter: 7500
                          Buffers: shared hit=1 read=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.93..1605.18 rows=452 width=40) (actual time=0.822..116.464 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4370 read=49757
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.82 rows=452 width=0) (actual time=0.430..0.430 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=10 read=59
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.018..0.018 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=144266 read=75658
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 0.751 ms
Execution Time: 2217.834 ms
```

</details>

<details>
<summary>V6 4회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 리터럴</summary>

```text
GroupAggregate  (cost=18814.89..18843.79 rows=1445 width=48) (actual time=2176.772..2179.852 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=148596 read=125458
  ->  Sort  (cost=18814.89..18818.51 rows=1445 width=24) (actual time=2176.508..2177.729 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=148596 read=125458
        ->  Nested Loop  (cost=12.75..18739.05 rows=1445 width=24) (actual time=1.710..2161.946 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=148596 read=125458
              ->  Nested Loop  (cost=12.32..16239.51 rows=4468 width=44) (actual time=1.582..1175.209 rows=54981 loops=1)
                    Buffers: shared hit=4366 read=49764
                    ->  Bitmap Heap Scan on account a1_0  (cost=4.36..35.05 rows=10 width=20) (actual time=0.070..0.077 rows=10 loops=1)
                          Recheck Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                          Heap Blocks: exact=1
                          Buffers: shared hit=1 read=2
                          ->  Bitmap Index Scan on uq_account_name  (cost=0.00..4.36 rows=10 width=0) (actual time=0.066..0.067 rows=10 loops=1)
                                Index Cond: (ledger_id = '019defb2-a9a9-7e00-d4ca-7b9a0b6c65a6'::uuid)
                                Buffers: shared read=2
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.96..1615.90 rows=455 width=40) (actual time=0.789..116.380 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4365 read=49762
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.84 rows=455 width=0) (actual time=0.423..0.423 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=10 read=59
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.017..0.017 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=144230 read=75694
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 0.777 ms
Execution Time: 2180.090 ms
```

</details>

<details>
<summary>V5 1회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 일반 계획</summary>

```text
GroupAggregate  (cost=15212.37..15224.05 rows=584 width=48) (actual time=2183.088..2185.934 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=148626 read=125526
  ->  Sort  (cost=15212.37..15213.83 rows=584 width=24) (actual time=2182.856..2183.986 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=148626 read=125526
        ->  Nested Loop  (cost=8.36..15185.54 rows=584 width=24) (actual time=2.066..2168.754 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=148626 read=125526
              ->  Nested Loop  (cost=7.93..13186.12 rows=3574 width=44) (actual time=1.938..1162.398 rows=54981 loops=1)
                    Buffers: shared hit=4366 read=49862
                    ->  Seq Scan on account a1_0  (cost=0.00..194.88 rows=8 width=20) (actual time=0.389..0.406 rows=10 loops=1)
                          Filter: (ledger_id = $1)
                          Rows Removed by Filter: 7500
                          Buffers: shared hit=1 read=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.93..1619.39 rows=452 width=40) (actual time=0.790..115.111 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4365 read=49762
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.82 rows=452 width=0) (actual time=0.413..0.413 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=10 read=59
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.018..0.018 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> ($2)::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=144260 read=75664
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 0.903 ms
Execution Time: 2186.119 ms
```

</details>

<details>
<summary>V6 4회차, <code>perf_mix_50k</code>, 장부 전체 잔액, 큰 장부, 일반 계획</summary>

```text
GroupAggregate  (cost=15133.09..15144.77 rows=584 width=48) (actual time=2121.807..2124.832 rows=10 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=148596 read=125458
  ->  Sort  (cost=15133.09..15134.55 rows=584 width=24) (actual time=2121.544..2122.755 rows=53326 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 3620kB
        Buffers: shared hit=148596 read=125458
        ->  Nested Loop  (cost=12.73..15106.26 rows=584 width=24) (actual time=1.704..2108.013 rows=53326 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=148596 read=125458
              ->  Nested Loop  (cost=12.30..13106.85 rows=3574 width=44) (actual time=1.622..1121.792 rows=54981 loops=1)
                    Buffers: shared hit=4366 read=49764
                    ->  Bitmap Heap Scan on account a1_0  (cost=4.34..29.69 rows=8 width=20) (actual time=0.071..0.077 rows=10 loops=1)
                          Recheck Cond: (ledger_id = $1)
                          Heap Blocks: exact=1
                          Buffers: shared hit=1 read=2
                          ->  Bitmap Index Scan on uq_account_name  (cost=0.00..4.34 rows=8 width=0) (actual time=0.067..0.068 rows=10 loops=1)
                                Index Cond: (ledger_id = $1)
                                Buffers: shared read=2
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.96..1630.09 rows=455 width=40) (actual time=0.800..111.058 rows=5498 loops=10)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=54058
                          Buffers: shared hit=4365 read=49762
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.84 rows=455 width=0) (actual time=0.423..0.423 rows=5498 loops=10)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=10 read=59
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.017..0.017 rows=1 loops=54981)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> ($2)::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=144230 read=75694
Planning:
  Buffers: shared hit=12 read=18
Planning Time: 0.839 ms
Execution Time: 2125.027 ms
```

</details>

<details>
<summary>V5 1회차, <code>perf_l1000_3m</code>(첫 실행), 장부 전체 잔액, 보통 장부, 리터럴</summary>

```text
GroupAggregate  (cost=13199.89..13219.85 rows=998 width=48) (actual time=8.027..8.198 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=16563
  ->  Sort  (cost=13199.89..13202.39 rows=998 width=24) (actual time=7.995..8.064 rows=3192 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 221kB
        Buffers: shared hit=16563
        ->  Nested Loop  (cost=8.30..13150.18 rows=998 width=24) (actual time=0.124..7.721 rows=3192 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=16563
              ->  Nested Loop  (cost=7.87..11427.70 rows=3080 width=44) (actual time=0.119..2.410 rows=3289 loops=1)
                    Buffers: shared hit=3407
                    ->  Seq Scan on account a1_0  (cost=0.00..193.75 rows=7 width=20) (actual time=0.004..0.183 rows=6 loops=1)
                          Filter: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                          Rows Removed by Filter: 7494
                          Buffers: shared hit=100
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.87..1600.41 rows=444 width=40) (actual time=0.053..0.335 rows=548 loops=6)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=3289
                          Buffers: shared hit=3307
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.76 rows=444 width=0) (actual time=0.025..0.025 rows=548 loops=6)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=18
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.002..0.002 rows=1 loops=3289)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=13156
Planning:
  Buffers: shared hit=30
Planning Time: 0.171 ms
Execution Time: 8.242 ms
```

</details>

<details>
<summary>V6 4회차, <code>perf_l1000_3m</code>(첫 실행), 장부 전체 잔액, 보통 장부, 리터럴</summary>

```text
GroupAggregate  (cost=13082.94..13102.84 rows=995 width=48) (actual time=7.040..7.213 rows=6 loops=1)
  Group Key: tl1_0.account_id
  Buffers: shared hit=16466
  ->  Sort  (cost=13082.94..13085.42 rows=995 width=24) (actual time=7.008..7.077 rows=3192 loops=1)
        Sort Key: tl1_0.account_id
        Sort Method: quicksort  Memory: 221kB
        Buffers: shared hit=16466
        ->  Nested Loop  (cost=12.65..13033.39 rows=995 width=24) (actual time=0.116..6.746 rows=3192 loops=1)
              Join Filter: (t1_0.occurred_on >= a1_0.opening_date)
              Buffers: shared hit=16466
              ->  Nested Loop  (cost=12.22..11310.91 rows=3080 width=44) (actual time=0.112..1.980 rows=3289 loops=1)
                    Buffers: shared hit=3310
                    ->  Bitmap Heap Scan on account a1_0  (cost=4.34..26.87 rows=7 width=20) (actual time=0.008..0.009 rows=6 loops=1)
                          Recheck Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                          Heap Blocks: exact=1
                          Buffers: shared hit=3
                          ->  Bitmap Index Scan on uq_account_name  (cost=0.00..4.33 rows=7 width=0) (actual time=0.003..0.003 rows=6 loops=1)
                                Index Cond: (ledger_id = 'fea30da9-69b9-2431-59a7-dcd58caf6eaa'::uuid)
                                Buffers: shared hit=2
                    ->  Bitmap Heap Scan on transaction_line tl1_0  (cost=7.89..1607.55 rows=446 width=40) (actual time=0.047..0.293 rows=548 loops=6)
                          Recheck Cond: (account_id = a1_0.id)
                          Heap Blocks: exact=3289
                          Buffers: shared hit=3307
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..7.77 rows=446 width=0) (actual time=0.023..0.023 rows=548 loops=6)
                                Index Cond: (account_id = a1_0.id)
                                Buffers: shared hit=18
              ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..0.55 rows=1 width=20) (actual time=0.001..0.001 rows=1 loops=3289)
                    Index Cond: (id = tl1_0.transaction_id)
                    Filter: ((deleted_at IS NULL) AND ((status)::text <> 'CANCELED'::text))
                    Rows Removed by Filter: 0
                    Buffers: shared hit=13156
Planning:
  Buffers: shared hit=30
Planning Time: 0.167 ms
Execution Time: 7.243 ms
```

</details>

<details>
<summary>V5 1회차, <code>perf_mix_50k</code>, 계좌 하나 잔액, 큰 장부, 리터럴(<code>account</code>가 없는 계획)</summary>

```text
Finalize Aggregate  (cost=62363.31..62363.32 rows=1 width=32) (actual time=19.098..24.546 rows=1 loops=1)
  Buffers: shared hit=55925
  ->  Gather  (cost=62363.09..62363.30 rows=2 width=32) (actual time=18.996..24.541 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=55925
        ->  Partial Aggregate  (cost=61363.09..61363.10 rows=1 width=32) (actual time=17.804..17.805 rows=1 loops=3)
              Buffers: shared hit=55925
              ->  Nested Loop  (cost=148.74..61351.09 rows=4800 width=8) (actual time=1.025..17.676 rows=3644 loops=3)
                    Buffers: shared hit=55925
                    ->  Parallel Bitmap Heap Scan on transaction_line tl1_0  (cost=148.31..26592.99 rows=4940 width=24) (actual time=0.990..6.142 rows=3749 loops=3)
                          Recheck Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                          Heap Blocks: exact=4721
                          Buffers: shared hit=10935
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..145.34 rows=11855 width=0) (actual time=1.177..1.177 rows=11247 loops=1)
                                Index Cond: (account_id = '72dde05e-7807-1d26-b42f-e19d24c701e7'::uuid)
                                Buffers: shared hit=11
                    ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..7.04 rows=1 width=16) (actual time=0.003..0.003 rows=1 loops=11247)
                          Index Cond: (id = tl1_0.transaction_id)
                          Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 0
                          Buffers: shared hit=44990
Planning:
  Buffers: shared hit=16
Planning Time: 0.098 ms
Execution Time: 24.566 ms
```

</details>

<details>
<summary>V6 4회차, <code>perf_l1000_3m</code>(첫 실행), 계좌 하나 잔액, 보통 장부, 리터럴(병렬로 바뀐 것)</summary>

```text
Finalize Aggregate  (cost=12821.32..12821.33 rows=1 width=32) (actual time=1.667..2.335 rows=1 loops=1)
  Buffers: shared hit=4624
  ->  Gather  (cost=12821.21..12821.32 rows=1 width=32) (actual time=1.638..2.333 rows=2 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=4624
        ->  Partial Aggregate  (cost=11821.21..11821.22 rows=1 width=32) (actual time=1.051..1.051 rows=1 loops=2)
              Buffers: shared hit=4624
              ->  Nested Loop  (cost=19.94..11819.17 rows=815 width=8) (actual time=0.136..1.037 rows=450 loops=2)
                    Buffers: shared hit=4624
                    ->  Parallel Bitmap Heap Scan on transaction_line tl1_0  (cost=19.51..4891.75 rows=841 width=24) (actual time=0.130..0.392 rows=462 loops=2)
                          Recheck Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                          Heap Blocks: exact=754
                          Buffers: shared hit=927
                          ->  Bitmap Index Scan on ix_transaction_line_account  (cost=0.00..19.15 rows=1430 width=0) (actual time=0.199..0.199 rows=924 loops=1)
                                Index Cond: (account_id = '6c056941-8206-a21a-b77d-e15c9832c883'::uuid)
                                Buffers: shared hit=3
                    ->  Index Scan using transaction_pkey on transaction t1_0  (cost=0.43..8.24 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=924)
                          Index Cond: (id = tl1_0.transaction_id)
                          Filter: ((deleted_at IS NULL) AND (occurred_on >= '2016-11-01'::date) AND ((status)::text <> 'CANCELED'::text))
                          Rows Removed by Filter: 0
                          Buffers: shared hit=3697
Planning:
  Buffers: shared hit=16
Planning Time: 0.066 ms
Execution Time: 2.344 ms
```

</details>
