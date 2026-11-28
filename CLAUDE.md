# 아낌표 (account-book)

가계부 서비스. 앱 이름은 "아낌표"이고, 코드와 폴더의 `account-book` / `accountbook` 표기는 그대로 둔다.

- `server/` — Spring Boot 4.2.0, Gradle(wrapper 8.14.8), Java 21, PostgreSQL 17, Flyway
- `web/` — React 19, Vite, TypeScript, Vitest
- `e2e/` — Playwright 끝에서 끝까지 테스트(Chromium, WebKit 아이폰 크기). `web/`에서 `npm ci`를 한 뒤 `e2e/`에서 `npm ci`, `npx playwright install chromium webkit`, `npm test`(2026-11-26 확인, 자세한 것은 `e2e/README.md`)
- `compose.yaml` — 로컬 개발용 PostgreSQL
- `docs/planning/` — 기획 문서(무엇을 만들지의 기준)

## 명령

아래 명령은 2026-11-27에 macOS(arm64)에서 실제로 실행해 확인한 것이다(web/의 `npm test`만 예외, 표에 적었다).
확인한 환경: Docker 29.9.2, JDK 21(Corretto 21.0.3) 설치 + Gradle 실행 JVM은 JDK 17, Node 24.3.0 / npm 11.4.2.

### DB (레포 루트)

| 할 일 | 명령 | 결과 |
|---|---|---|
| 띄우기 | `docker compose up -d` | 성공. `db` 서비스(postgres:17) 하나만 뜬다. **127.0.0.1:5433** → 컨테이너 5432. 이 컴퓨터 안에서만 접속된다 |
| 내리기 | `docker compose down` | 성공. 볼륨 `db-data`는 남는다(`-v`를 붙이지 않는다) |

- DB 이름·사용자·비밀번호는 모두 `accountbook`(로컬 전용 값, `compose.yaml`에 있음).
- 서버와 웹은 compose에 없다. 각각 아래 명령으로 따로 띄운다.
- Docker가 실행 중이어야 한다.

### server/ (Gradle wrapper 8.14.8)

| 할 일 | 명령 (`server/`에서) | 결과 |
|---|---|---|
| 설치 | 없음 | 의존성은 첫 Gradle 실행 때 받아진다 |
| 빌드 | `./gradlew build` | 성공. 테스트를 포함하고 `build/libs/`에 jar가 생긴다 |
| 테스트 | `./gradlew test` | 성공 |
| 린트 | 없음 | 린트·포맷 플러그인이 설정돼 있지 않다 |
| 로컬 실행 | `SPRING_PROFILES_ACTIVE=local ACCESS_TOKEN_SIGNING_KEY=$(openssl rand -base64 32) ./gradlew bootRun` | 성공. `127.0.0.1:8080`에 뜨고 `GET /actuator/health`가 200 `{"groups":["liveness","readiness"],"status":"UP"}` 응답 |

- 전제: JDK 21이 설치돼 있어야 한다(Gradle toolchain이 21을 요구). Gradle 자체는 JDK 17로 실행해도 됐다.
- 테스트(`build`, `test`)는 Testcontainers로 PostgreSQL 17을 띄우므로 Docker가 실행 중이어야 한다.
  compose DB와 환경 변수는 필요 없다(서명 키와 DB 접속 값을 테스트가 스스로 만든다).
- 셸에 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`가 있으면 "변수가 없으면 뜨지 않는다"를 보는 `ProfileConfigTest` 2개가 실패한다.
  테스트는 이 변수 없이 돌린다.
- local 프로파일(`application-local.yml`)은 compose DB 접속값과 `server.address: 127.0.0.1`을 준다.
  그래서 compose DB가 떠 있어야 하고, 서버는 이 컴퓨터 안에서만 접속된다. 시작할 때 Flyway가 스키마를 적용한다.
- 서명 키는 실행할 때마다 위처럼 새로 만든다. `application-local.yml`에도 키의 기본값을 두지 않는다.
- 서버가 요구하는 환경 변수(값은 레포에 적지 않는다):

  | 변수 | 모양 | 없으면 |
  |---|---|---|
  | `ACCESS_TOKEN_SIGNING_KEY` | 표준 Base64, 풀면 32바이트(256비트) 이상의 난수. `openssl rand -base64 32` | 어느 프로파일이든 뜨지 않는다 |
  | `DB_URL` | `jdbc:postgresql://호스트:포트/DB이름` | 기본 프로파일은 뜨지 않는다. local 프로파일은 compose DB 값을 쓴다 |
  | `DB_USERNAME` | DB 사용자 이름 | `DB_URL`과 같다 |
  | `DB_PASSWORD` | DB 비밀번호 | `DB_URL`과 같다 |

  `DB_*`를 빈 값으로 주면 local 프로파일에서도 뜨지 않는다(기본값으로 바뀌지 않는다).
  뜨지 않을 때 로그의 `Caused by:`에 빠진 변수 이름이 나온다(값은 나오지 않는다).
- 포트는 설정이 없어 Spring 기본값 **8080**이다. 8080을 다른 프로세스가 쓰고 있으면 `SERVER_PORT=18080`을 앞에 더한다.

### web/ (npm)

| 할 일 | 명령 (`web/`에서) | 결과 |
|---|---|---|
| 설치 | `npm ci` | 성공 |
| 빌드 | `npm run build` | 성공(`tsc -b && vite build`, 산출물 `dist/`) |
| 테스트 | `npm test` | `vitest run`. 전부 통과는 2026-11-23 확인. 기계 부하가 높으면 시간 초과로 실패하는 테스트가 생기고 돌릴 때마다 다르다(2026-11-27) |
| 린트 | `npm run lint` | 성공(`eslint .`) |
| 로컬 실행 | `npm run dev` | 성공. `http://localhost:5173/`이 200 응답 |

- Node 버전 고정 설정(`.nvmrc`, `engines`)은 없다. Node 24.3.0에서 확인했다.
- 개발 서버는 `/api`, `/actuator`를 `http://localhost:8080`으로 프록시한다(`vite.config.ts`).
  local 프로파일 서버(127.0.0.1)에도 닿는다. 서버를 8080이 아닌 포트로 띄우면 프록시가 서버에 닿지 않는다.
- 테스트 파일은 `web/tests/`에 둔다(`tests/**/*.test.{ts,tsx}`만 실행된다).

## 프로젝트 규칙

- **기준 문서**: 무엇을 만들지는 `docs/planning/`이 정한다. 코드와 명세가 다르거나 명세가 모호하면
  문서를 고치지 말고 질문한다.
- **금액**: 원 단위 정수만 쓴다. float/double은 쓰지 않는다.
- **시간대**: Asia/Seoul. 날짜 경계와 월 경계를 다루는 코드는 경계 테스트를 반드시 쓴다.
- **개인신용정보**: 카드번호, 계좌번호 같은 개인신용정보를 저장하거나 접근하는 기능은 만들지 않는다.
  실제 카드 내역은 레포나 테스트 데이터에 넣지 않는다.
- **이름**: 앱 이름은 "아낌표". 코드와 폴더의 account-book 표기는 유지한다.
