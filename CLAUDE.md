# 아낌표 (account-book)

가계부 서비스. 앱 이름은 "아낌표"이고, 코드와 폴더의 `account-book` / `accountbook` 표기는 그대로 둔다.

- `server/` — Spring Boot 4.2, Gradle, Java 21, PostgreSQL, Flyway
- `web/` — React 19, Vite, TypeScript, Vitest
- `compose.yaml` — 로컬 개발용 PostgreSQL
- `docs/planning/` — 기획 문서(무엇을 만들지의 기준)

## 명령

아래 명령은 2026-11-23에 macOS(arm64)에서 실제로 실행해 확인한 것이다.
확인한 환경: Docker 29.9.2, JDK 21(Corretto 21.0.3) 설치 + Gradle 실행 JVM은 JDK 17, Node 24.3.0 / npm 11.4.2.

### DB (레포 루트)

| 할 일 | 명령 | 결과 |
|---|---|---|
| 띄우기 | `docker compose up -d` | 성공. `db` 서비스(postgres:17) 하나만 뜬다. 호스트 포트 **5433** → 컨테이너 5432 |
| 내리기 | `docker compose down` | 성공. 볼륨 `db-data`는 남는다(`-v`를 붙이지 않는다) |

- DB 이름·사용자·비밀번호는 모두 `accountbook`(로컬 전용 값, `compose.yaml`에 있음).
- 서버와 웹은 compose에 없다. 각각 아래 명령으로 따로 띄운다.
- Docker가 실행 중이어야 한다.

### server/ (Gradle wrapper 8.14.3)

| 할 일 | 명령 (`server/`에서) | 결과 |
|---|---|---|
| 설치 | 없음 | 의존성은 첫 Gradle 실행 때 받아진다 |
| 빌드 | `./gradlew build` | 성공. 테스트를 포함하고 `build/libs/`에 jar가 생긴다 |
| 테스트 | `./gradlew test` | 성공(57개 통과). `build`의 일부로 실행해 확인 |
| 린트 | 없음 | 린트·포맷 플러그인이 설정돼 있지 않다 |
| 로컬 실행 | `./gradlew bootRun` | 성공. `/actuator/health`가 `{"status":"UP"}` 응답 |

- 전제: JDK 21이 설치돼 있어야 한다(Gradle toolchain이 21을 요구). Gradle 자체는 JDK 17로 실행해도 됐다.
- 테스트는 Testcontainers로 PostgreSQL을 띄우므로 Docker가 실행 중이어야 한다. compose DB는 필요 없다.
- `bootRun`은 compose DB(`localhost:5433`)가 떠 있어야 한다. 시작할 때 Flyway가 스키마를 적용한다.
- 포트는 설정이 없어 Spring 기본값 **8080**이다. 확인 당시 8080을 다른 프로세스가 쓰고 있어
  `SERVER_PORT=18080 ./gradlew bootRun`으로 확인했다. 기본 포트 8080으로 뜨는 것은 직접 확인하지 못했다.
- DB 접속 정보는 환경변수 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`로 바꿀 수 있다(기본값은 compose DB).

### web/ (npm)

| 할 일 | 명령 (`web/`에서) | 결과 |
|---|---|---|
| 설치 | `npm ci` | 성공 |
| 빌드 | `npm run build` | 성공(`tsc -b && vite build`, 산출물 `dist/`) |
| 테스트 | `npm test` | 성공(1개 통과, `vitest run`) |
| 린트 | `npm run lint` | 성공(`eslint .`) |
| 로컬 실행 | `npm run dev` | 성공. `http://localhost:5173/`이 200 응답 |

- Node 버전 고정 설정(`.nvmrc`, `engines`)은 없다. Node 24.3.0에서 확인했다.
- 개발 서버는 `/api`, `/actuator`를 `http://localhost:8080`으로 프록시한다(`vite.config.ts`).
  서버를 8080이 아닌 포트로 띄우면 프록시가 서버에 닿지 않는다.
- 테스트 파일은 `web/tests/`에 둔다(`tests/**/*.test.{ts,tsx}`만 실행된다).

## 프로젝트 규칙

- **기준 문서**: 무엇을 만들지는 `docs/planning/`이 정한다. 코드와 명세가 다르거나 명세가 모호하면
  문서를 고치지 말고 질문한다.
- **금액**: 원 단위 정수만 쓴다. float/double은 쓰지 않는다.
- **시간대**: Asia/Seoul. 날짜 경계와 월 경계를 다루는 코드는 경계 테스트를 반드시 쓴다.
- **개인신용정보**: 카드번호, 계좌번호 같은 개인신용정보를 저장하거나 접근하는 기능은 만들지 않는다.
  실제 카드 내역은 레포나 테스트 데이터에 넣지 않는다.
- **이름**: 앱 이름은 "아낌표". 코드와 폴더의 account-book 표기는 유지한다.
