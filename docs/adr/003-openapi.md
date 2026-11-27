# ADR 003: API 명세(OpenAPI)를 코드에서 만든다

- 상태: 제안됨 (2026-11-26)
- 결정한 사람: owner(OpenAPI를 자동으로 만들고 운영에서는 끈다, 2026-11-23), architect(서버에 주소를 두지 않고 파일만 만드는 것, 의존성 구성, Swagger UI와 `example`을 쓰지 않는 것, 2026-11-26, #102). 나머지는 ledger의 초안이다(검토: architect, security)

## 배경

- owner가 2026-11-23에 정한 것은 "API 명세는 OpenAPI로 만든다. 운영 환경에서는 명세 문서 화면을 끈다"다(설계 5.1, 11장). 라이브러리를 새로 넣는 것도 owner가 승인했다. Spring Boot 4.2와 맞는 버전이 없으면 멈추고 보고한다(#32).
- 서버와 화면은 `/api/v1` 아래 JSON API 하나로 만난다. 경로, 값, 오류의 규칙은 ADR 002가 정하고 세부 경로와 필드는 OpenAPI 문서가 기준이다(ADR 002 1절, 4절).
- API 이슈(#13, #14, #15 등)는 "성공 응답과 오류 응답이 OpenAPI 문서에 나온다"를 수용 기준으로 둔다. #32는 #12 뒤, #13 앞이다.
- 서버는 Spring Boot 4.2.0, Spring Framework 7.1.0, Jackson 3.1.8, Gradle 8.14.8, Java 21이다. 컨트롤러는 `/error` 하나뿐이다(확인, main `981256b`).
- 운영은 프로파일 없이 `java -jar`로 띄운다(확인, PR #110, 머지 전).

## 조사한 것 (2026-11-26)

### 문서와 릴리스에서 확인한 것

| 무엇 | 결과 | 근거 |
|---|---|---|
| Spring Boot 4.2와 맞는 springdoc-openapi | **있다. 3.2.1이다**(2026-11-20). Spring Boot 4.2.0으로 만들었고 호환표에 4.2.x → 3.2.1로 적혀 있다. Spring Boot 4.2.0은 2026-11-19에 나왔다 | [릴리스](https://github.com/springdoc/springdoc-openapi/releases/tag/v3.2.1), [호환표](https://springdoc.org/faq.html#_what_is_the_compatibility_matrix_of_springdoc_openapi_with_spring_boot), [POM](https://repo1.maven.org/maven2/org/springdoc/springdoc-openapi/3.2.1/springdoc-openapi-3.2.1.pom) |
| Jackson 3 | 3.2.1부터 swagger-core 3.0.0(2026-10-28)과 Jackson 3(`tools.jackson`)을 쓴다 | 위 릴리스 |
| 유지 관리 | 3.x는 2025-11-21 뒤 안정 버전이 여덟 번 나왔다. 열린 이슈는 2개다. Spring 팀이 아닌 커뮤니티가 만들고 커밋 대부분이 한 사람의 것이다(2,498건, 다음 사람 34건). 라이선스는 Apache-2.0이다 | GitHub API, [README](https://github.com/springdoc/springdoc-openapi/blob/v3.2.1/README.md) |
| 보안 수정 | 지금 major와 바로 앞 major의 마지막 minor에만 준다. 3.1.1에서 `Accept-Language`로 메모리를 소진시키는 취약점(high)을 고쳤다. Swagger UI가 품은 DOMPurify의 취약점은 3.1.1과 3.2.1에서 고쳤다 | [SECURITY.md](https://github.com/springdoc/springdoc-openapi/blob/v3.2.1/SECURITY.md), [GHSA-rhhx-6j8h-8cvw](https://github.com/springdoc/springdoc-openapi/security/advisories/GHSA-rhhx-6j8h-8cvw) |
| 버전 규칙 | 패치 버전이 Spring Boot 기준과 swagger-core의 major를 바꾼다(3.2.0은 Boot 4.1.2와 swagger-core 2, 3.2.1은 Boot 4.2.0과 swagger-core 3) | [#3448](https://github.com/springdoc/springdoc-openapi/issues/3448) |
| Boot를 올릴 때 깨진 선례 | Boot 3.5.0으로 올린 서버가 springdoc 2.8.8 때문에 뜨지 않은 사례가 보고됐다(이름이 바뀐 Boot 메서드를 불렀다) | [spring-boot #45648](https://github.com/spring-projects/spring-boot/issues/45648) |
| Spring 자체의 OpenAPI 지원 | 없다. 두 번 거절됐다 | [spring-boot #20396](https://github.com/spring-projects/spring-boot/issues/20396), [spring-framework #29864](https://github.com/spring-projects/spring-framework/issues/29864) |
| springdoc Gradle 플러그인 | 2.1.0(2026-11-06). 앱을 직접 띄워 받는다. Boot 2.7~4.1, Gradle 8.0~9.8에서 시험했다고 적혀 있고 4.2는 없다 | [2.0.0](https://github.com/springdoc/springdoc-openapi-gradle-plugin/releases/tag/2.0.0), [2.1.0](https://github.com/springdoc/springdoc-openapi-gradle-plugin/releases/tag/2.1.0) |
| restdocs-api-spec | 0.20.2(2026-10-16). Boot 4.0.5 기준이고 0.20.x는 Boot 4에서 호환 문제가 남을 수 있다고 적혀 있다 | [0.20.1](https://github.com/ePages-de/restdocs-api-spec/releases/tag/0.20.1), [POM](https://repo1.maven.org/maven2/com/epages/restdocs-api-spec/0.20.2/restdocs-api-spec-0.20.2.pom) |
| springfox | 3.0.0(2020-07-14) 뒤로 없다 | [Maven Central](https://repo1.maven.org/maven2/io/springfox/springfox-boot-starter/maven-metadata.xml) |

### 레포 밖 임시 사본에서 돌려 확인한 것

main `981256b`와 PR #178의 `70d7fb8`(지금은 머지됨)을 레포 밖에 복사해 springdoc 3.2.1을 붙였다. 임시 컨트롤러와 필터 체인은 뒤의 것에 붙였다. 커밋하지 않았다. 환경은 macOS arm64, JDK 21이다. 처음 초안의 구성(`compileOnly`와 `testAndDevelopmentOnly`, 설정 클래스는 main)으로 돌렸고 결정 2의 구성으로는 돌리지 않았다. 두 구성 모두 springdoc이 테스트의 실행 경로에는 있고 운영 jar에는 없다.

- springdoc이 테스트의 실행 경로에 있고 문서를 끄고 YAML 변환기를 뺀 채로 main의 기존 테스트 947개가 그대로 통과한다(넣기 전에도 947개).
- **라이브러리가 실행 경로에 있기만 해도 API가 YAML을 받는다.** 함께 들어오는 `jackson-dataformat-yaml` 때문에 Spring이 YAML 변환기를 더한다. 로그인을 흉내 낸 API에 `Content-Type: application/yaml`을 보내면 415가 아니라 200이고, `Accept: application/yaml`이면 YAML로 답한다. 문서를 꺼도(`enabled=false`) 같다. 라이브러리가 컴파일에만 있고 실행 경로에 없으면 변환기가 생기지 않아 415다.
- 운영 jar에 라이브러리가 없으면 `SPRINGDOC_API_DOCS_ENABLED=true`를 줘도 문서 주소는 404이고 YAML은 415다. 어노테이션 클래스가 없어도 그것을 붙인 컨트롤러와 DTO는 정상으로 동작한다.
- 지금 main의 컴파일 경로와 운영 실행 경로에는 springdoc, swagger, commons-lang3, `jackson-dataformat-*`가 없다. `jakarta.xml.bind-api`는 운영 실행 경로에 있다(의존성 목록, main `981256b`). 임시 사본의 변환기 목록에는 YAML 말고 JAXB의 XML 변환기도 있었다.
- 설정을 바꾸지 않으면 문서가 우리 API와 다르다.
  - `/error`가 메서드 7개로 실린다.
  - 서버 주소에 요청이 온 주소가 그대로 실린다(`http://localhost:57867`).
  - 오류 응답이 하나도 실리지 않는다. 처리기가 상태를 `ResponseEntity`로 정하기 때문이다(추정).
  - 성공 응답의 형식이 `*/*`다. `ResponseEntity.status(201)`은 200으로 실린다.
  - 이름이 같은 DTO 둘이 조용히 하나로 합쳐져 통계 응답에 거래 라인의 모양이 실렸다.
  - 이름이 같은 메서드 둘은 `operationId`가 `list`, `list_1`이 된다.
  - `null`이 될 수 있는 필드와 늘 있는 필드가 구분되지 않는다. `HH:mm` 시각은 `time-local`로 실린다.
- `Problem` record에서 확장 필드(`code`의 열거, `requestId`, `fieldErrors`)가 든 스키마가 나오고, `ErrorCode`에서 만든 상태별 응답이 `application/problem+json`으로 동작에 붙는다.
- 결정 5~7의 설정으로 위의 것이 고쳐지거나 피해진다. 같은 문서를 서로 다른 JVM(테스트와 `bootRun`)에서, `ko`와 `en`으로 받아도 바이트까지 같았다.
- 문서를 처음 만드는 데 0.3~0.4초가 걸린다. 기동까지 쓴 CPU 시간(6번씩 잰 평균)은 라이브러리가 없을 때 16.0초와 16.3초(두 묶음), 있고 꺼졌을 때 16.2초, 켰을 때 17.2초다. 다른 작업이 도는 기기라 기동 시각(벽시계)으로는 차이를 가리지 못했다.
- 운영 jar에 넣으면 2.3MB(파일 8개) 커진다.
- 기본 거부 필터 체인을 붙이면 꺼진 문서 주소는 토큰 없이 401, 로그인한 채로는 404다. 없는 경로와 상태가 같다. 켠 문서의 YAML 주소는 공개 목록에 없어도 로그인하면 200이었다.
- 비밀번호 필드에 `format = "password"`, `accessMode = WRITE_ONLY`를 주면 `format: password`, `writeOnly: true`로 실린다. 예시 값은 저절로 생기지 않는다.

### 확인하지 못한 것

- 결정 2의 구성으로 실제로 빌드하고 문서를 만드는 것. #32에서 확인하고, 안 되면 이 ADR을 고친다.
- CI(Linux)에서도 같은 문서가 나오는지. 같은 기기에서만 비교했다.
- #12의 실제 필터 체인과 함께 쓰는 것. 임시 체인으로만 봤다.
- `application/xml`과 `application/cbor` 본문의 응답, JSON 변환기만 남긴 구성. YAML 변환기 하나를 빼는 것까지만 돌려 봤다.
- OpenAPI 3.1 검증기와 클라이언트 코드 생성기(웹, Swift)가 이 문서를 받아들이는지.
- 응답 필드를 한꺼번에 필수로 적는 것과 동작마다 오류 응답을 골라 붙이는 것(결정 6, 7). 필드 하나씩 적는 것과 모든 동작에 다 붙이는 것까지만 돌려 봤다.
- swagger-core 3.0.0은 Jackson 3.2.3을 요구하고 Boot가 3.1.8로 낮춘다. 위에서 본 범위에서는 동작했다. springdoc도 Boot 4.2.0 위에서 만들어져 같은 조합일 것이다(추정).
- SmallRye OpenAPI의 Spring 확장(4.4.1)을 Spring Boot에서 쓰는 방법.

## 결정

### 1. 라이브러리는 springdoc-openapi 3.2.1이다

- `springdoc-openapi-starter-webmvc-api`를 쓴다. JSON 문서만 내고 화면(Swagger UI)은 들어 있지 않다.
- 고른 기준은 다음과 같다: Spring Boot 4.2를 공식으로 지원한다, Jackson 3을 쓴다, 최근에도 릴리스가 나온다, 코드에서 만든다(owner 결정), 운영에 넣지 않고 쓸 수 있다.
- 버전은 숫자 하나로 고정한다. 범위(`3.2.+`)를 쓰지 않는다. 올릴 때는 패치라도 호환표와 `server/openapi.json`(결정 8)의 차이를 본다.
- Spring Boot를 올리는 PR은 호환표를 먼저 본다. 맞는 버전이 아직 없으면 기다린다. 보안 수정처럼 급하면 테스트 의존성과 문서 테스트를 빼는 것으로 먼저 올리고, 되돌릴 이슈를 남긴다. 운영의 동작은 달라지지 않는다(결정 2).
- 보안 공지는 springdoc 저장소에서 직접 본다. springdoc을 올릴 때와 주간 보안 점검 때 본다(점검에는 security가 넣는다). OSV는 springdoc의 공지를 모른다(security가 2026-11-26에 확인. 취약한 3.1.0을 물어도 0건이다). CI의 OSV 검사(#98)만으로는 다음 취약점을 알 수 없다.

### 2. 운영과 로컬 서버에 넣지 않는다

- springdoc은 `testImplementation`이다. main에는 `compileOnly 'io.swagger.core.v3:swagger-annotations:3.0.0'`만 둔다. 운영 jar에도 `bootRun`에도 springdoc이 없다.
- 설정 클래스(`OpenAPI` 빈, 오류 응답을 붙이는 것)는 `src/test`의 `@TestConfiguration`이고 문서 테스트만 불러온다. `Problem`과 `ErrorCode`가 package-private이라 같은 패키지(`app.accountbook.api`)에 둔다.
- 이유는 넷이다.
  - 환경 변수나 프로파일을 잘못 줘도 운영에서 켜지지 않는다.
  - 운영에 YAML 변환기와 쓰지 않는 파일 8개가 들어오지 않는다.
  - Boot를 올릴 때 springdoc이 맞지 않아도 운영 서버는 뜬다.
  - main 코드가 springdoc, swagger의 모델, commons-lang3을 쓰면 컴파일이 실패한다. 그래서 ArchUnit 규칙을 두지 않고 ADR 004 결정 7도 그대로다.
- 어노테이션(`io.swagger.v3.oas.annotations`)은 api 패키지에서만 쓰고 도메인 모듈에는 붙이지 않는다. 글로만 둔다. 어겨도 운영에서 실패하지 않는다.
- 어노테이션 jar의 열거(`Schema.AccessMode` 등)를 어노테이션 밖의 코드에서 쓰지 않는다. 컴파일은 되지만 운영에서만 실패한다. 이것도 글로만 두고, 어긴 사례가 나오면 그때 규칙을 더한다.
- `./gradlew build`가 `productionRuntimeClasspath`에 springdoc과 swagger(어노테이션 jar 포함)가 없는지 본다(Gradle 확인 하나, security 권고). 막는 것은 의존성 범위가 `implementation`으로 바뀌는 것이다. 바뀌어도 테스트는 모두 통과하고 문서도 꺼져 있어(결정 3) 겉으로 드러나지 않는다.
- 이 구성의 실제 빌드는 #32에서 확인한다(미확인). 안 되면 이 ADR을 고친다.

### 3. 기본값은 꺼짐이고, 문서 주소의 응답은 없는 경로와 같다

- `application.yml`에 `springdoc.api-docs.enabled: false` 한 줄을 둔다. 운영과 `bootRun`에는 springdoc이 없어 이 줄이 하는 일이 없다. 그래도 두는 이유는 둘이다.
  - 라이브러리의 기본값은 켜짐이다. 이 줄이 없으면 모든 테스트 컨텍스트에 문서 주소가 생겨 운영과 달라진다.
  - 의존성 범위가 잘못 바뀌어도 꺼져 있다.
- `true`로 두는 곳은 문서 테스트 하나다. springdoc의 나머지 설정(결정 5~8)도 그 테스트에만 둔다.
- 기준은 "문서 주소의 응답이 없는 경로와 같다"다. 프로파일 없이 띄운 서버에서 로그인 전후 모두 테스트한다(요청 id 말고 같다). 주소는 `/v3/api-docs`, `/v3/api-docs.yaml`, `/swagger-ui.html`, `/swagger-ui/index.html`이다. 기본 거부(#12)에서는 토큰이 없으면 401, 로그인하면 404가 된다.
- 이 테스트는 springdoc이 실행 경로에 있는 채로 돌아 위 설정을 확인한다. 운영에 라이브러리가 없는 것은 결정 2의 Gradle 확인이 본다.

### 4. 서버에 문서 주소를 두지 않는다

- 명세는 `server/openapi.json`(결정 8)으로만 낸다. 운영에도 로컬에도 문서 주소가 없다. frontend가 보는 것은 파일이고(결정 10), 주소는 같은 내용을 얻는 두 번째 길이다.
- 필터 체인의 공개 목록을 건드리지 않는다.
- 문서 테스트 안에서만 문서 주소를 켜고 테스트용 access token을 붙여 받는다. 인증된 요청은 체인을 지난다(추정. 임시 체인에서는 지났다). #12의 실제 체인이 막으면 문서 테스트의 설정에서만 연다.

### 5. 문서에 싣지 않는 것

- `/api/v1/**`만 싣는다(`springdoc.paths-to-match`). `/error`와 테스트용 컨트롤러가 빠진다.
- 서버 주소는 `/`로 고정한다. 요청이 온 주소에서 만들지 않는다.
- 문서 정보는 이름과 `v1`뿐이다. 빌드 시각, 커밋, 라이브러리 버전을 넣지 않는다.
- 내부 주소, 패키지와 클래스의 전체 이름, 예외 이름, SQL, DB 주소, 비밀값을 넣지 않는다. 문서 문자열에 `app.accountbook`, `java.`, `springframework`, `localhost`, `127.0.0.1`, `jdbc:`, `Exception`, `eyJ`(JWT의 앞글자), `/Users/`와 테스트가 쓰는 비밀값(서명 키, DB 비밀번호)이 없는지 테스트한다.
- `example`, `examples`를 쓰지 않는다. 문서 전체에서 0개인 것을 테스트한다. JSON의 키로 세고, 이름이 `example`인 속성(`properties` 아래)은 세지 않는다. 형식은 `format`, `pattern`, 범위로 적는다. 비밀번호와 토큰이 예시로 새는 길과 실제 거래 내역이 예시로 들어오는 길을 함께 막는다. `default`는 쿼리 값(`limit` 등)에만 쓴다.
- 비밀번호 필드는 `format: password`와 `writeOnly`다. 이름에 `password`가 든 필드가 지키는지 테스트한다. 토큰 필드는 예시를 두지 않는 것으로 충분하다.
- 설명(`description`)은 어노테이션에 적은 것만 나간다. javadoc은 읽지 않는다.

### 6. 성공 응답과 스키마

- 응답 형식은 컨트롤러가 `produces`로 선언한다(ADR 002 5절). 빠졌을 때를 위해 기본값도 `application/json`으로 둔다.
- 상태는 `@ResponseStatus`로 적는다. 상태가 둘인 것(거래 만들기의 201과 200)은 어노테이션으로 둘 다 적는다.
- 응답 필드는 모두 필수다. 값이 없는 필드는 빼지 않고 `null`로 넣기 때문이다(ADR 002 2절). `null`이 될 수 있는 필드에는 `@Nullable`(JSpecify, 이미 컴파일 경로에 있다)을 붙이고 springdoc의 널 표시 설정(`springdoc.model-converters.java-nullable-property-customizer.enabled`)을 켠다. 요청 필드의 필수 여부는 `@NotNull`, `@NotBlank`가 정한다.
- 요청 DTO와 응답 DTO를 나눈다. 같은 타입을 쓰면 필수 여부가 섞인다.
- `HH:mm` 시각은 문자열과 `pattern`으로 적는다.
- 타입으로 드러나지 않는 규칙(거래의 줄 순서, 금액 부호, #14)은 `description`에 적는다.
- api 패키지의 요청·응답 타입은 이름이 겹치지 않는다. `operationId`는 메서드 이름이고 전체에서 하나뿐이다(`listTransactions`처럼 적는다). 둘 다 테스트한다.
- OpenAPI 버전은 라이브러리 기본값인 3.1이다.

### 7. 오류 응답

- 오류의 스키마는 `Problem`과 `InvalidField` record에서, 상태별 공통 응답(`components.responses`)은 `ErrorCode`에서 만든다. 손으로 옮겨 적지 않는다. 형식은 `application/problem+json`이고 설명에 그 상태의 code 이름을 적는다. code가 늘면 문서가 따라 바뀐다.
- `Problem`은 `fieldErrors`와 `current`를 빼고 모두 필수다. `code`는 열거로 나온다. 더 늘 수 있고 모르는 `code`는 `status`로 처리한다는 것(ADR 002 4절)을 설명에 적는다. `current`의 타입은 처음 쓰는 이슈가 정한다.
- 동작에 저절로 붙는 것은 다음과 같다. 나머지(그 밖의 403, 409, 429, 로그인 실패의 401 등)는 그 동작에 어노테이션으로 적는다.

| 조건 | 붙는 상태 |
|---|---|
| 모든 동작 | 400, 500 |
| 로그인이 필요한 동작 | 401 |
| `/api/v1/auth` 아래의 동작 | 403(`ORIGIN_NOT_ALLOWED`) |
| 본문이 있는 동작 | 415 (413은 #21 뒤) |
| 경로에 id가 있는 동작 | 404 |

- 400이 모든 동작에 붙는 것은 `produces`가 있는 동작이 받을 수 없는 `Accept`에 400 `MALFORMED_REQUEST`를 내기 때문이다(ADR 002 5절).
- springdoc이 예외 처리기에서 응답을 짐작하는 기능(`springdoc.override-with-generic-response`)은 끈다.
- 기본 인증은 Bearer JWT로 적고 공개 동작에만 빈 `@SecurityRequirements`를 붙인다. 문서의 공개 동작과 필터 체인의 공개 목록(`/api/v1` 아래)이 같은지 테스트한다.
- `/api/v1/auth` 아래의 동작에는 필수 헤더 `X-Akkimpyo-Client`를 싣는다(ADR 001 결정 5). 위 표의 403과 같은 조건이다.

### 8. 파일로 남기고 테스트로 검사한다

- 만든 문서를 `server/openapi.json`으로 커밋한다. 키를 정렬해 늘 같은 내용이 나오게 한다(`springdoc.writer-with-order-by-keys`).
- 문서를 켠 서버를 띄우는 테스트(문서 테스트) 하나가 다음을 본다. `./gradlew build`에 들어가므로 CI 설정은 바꾸지 않는다.
  - 문서를 받을 수 있고 JSON이다.
  - `server/openapi.json`과 내용이 같다. 다르면 새 문서를 `build/` 아래에 쓰고 복사 명령을 알리며 실패한다.
  - 모든 `$ref`가 가리키는 것이 있다.
  - `/api/v1`의 컨트롤러 동작이 모두 실려 있고 저마다 2xx, 400, 500이 있다.
  - 결정 5~7에서 테스트한다고 적은 것.
- 파일을 `docs/` 아래에 두지 않는다. 문서만 바뀐 PR에서는 CI가 돌지 않아 손으로 고친 것을 잡지 못한다(확인, `ci.yml`의 `paths-ignore`).
- 문서는 문서 테스트가 띄운 서버가 만들고 파일은 그것을 받은 테스트가 쓴다. 빌드 때 따로 만들려면 앱과 DB를 한 번 더 띄워야 하는데, 테스트에는 이미 PostgreSQL(Testcontainers)이 있다.
- 앞 버전과 비교해 깨지는 변경을 가려내는 도구는 두지 않는다. PR의 파일 차이를 사람이 본다.

### 9. JSON만 받는다

- 구조가 있는 본문의 변환기는 JSON만 남긴다(main의 api MVC 설정). YAML과 XML 변환기가 빠진다. 문자열, 바이트, 파일처럼 프레임워크가 쓰는 것 가운데 무엇을 남길지는 #32가 정한다(security 권고).
- 운영에는 springdoc이 없어 YAML 변환기가 생기지 않는다(확인). 그래도 이 설정을 두는 이유는 둘이다.
  - 테스트에는 YAML 변환기가 있다. 빼지 않으면 테스트에서만 YAML을 받아 운영과 동작이 다르고, ADR 001 결정 5(본문은 JSON만)를 테스트로 고정할 수 없다.
  - 다른 라이브러리가 YAML이나 CBOR을 들여와도 ADR 001 결정 5가 지켜진다. XML 변환기는 지금 운영에도 있다(추정. `jakarta.xml.bind-api`가 운영 실행 경로에 있다).
- `application/yaml`, `application/xml`, `application/cbor` 본문은 415, `Accept`가 그 형식뿐이면 400인 것을 테스트한다.
- YAML 변환기를 빼도 문서 테스트가 받는 문서는 정상이다(확인).

### 10. frontend에게 알리는 방법

- frontend가 보는 명세는 레포의 `server/openapi.json`이다. 서버를 띄우지 않아도 되고, 어느 커밋의 명세인지 분명하다.
- 이 파일을 바꾸는 PR은 본문에 바뀐 동작을 적고 ledger가 frontend에게 알린다. 필드나 경로를 없애거나 뜻을 바꾸는 것은 ADR 002 8절을 따른다.
- 문서를 외부 편집기 사이트에 올리지 않는다.

## 검토한 대안

| 내용 | 좋은 점 | 대가 | 판단 |
|---|---|---|---|
| `testAndDevelopmentOnly`로 넣어 로컬 서버에만 문서 주소를 둔다(처음 초안) | 서버를 띄워 바로 받을 수 있다 | 같은 내용을 얻는 두 번째 길인데 그 때문에 필터 체인의 조건부 공개, `local` 설정, #119 선행이 생긴다. 설정 클래스가 main에 있어 잘못 쓰면 운영에서만 실패하고 ArchUnit 규칙이 필요하다 | 채택하지 않음(architect, #102). 개발용 주소가 필요해지면 의존성 범위와 설정을 더한다 |
| springdoc을 `implementation`으로 넣고 설정으로만 끈다 | 가장 흔한 방식이다. 테스트와 운영의 실행 경로가 같다 | 설정 하나로 운영에서 켜진다. 꺼도 YAML 변환기와 파일 8개가 운영에 남는다. Boot를 올릴 때 springdoc이 운영 기동을 막을 수 있다 | 채택하지 않음 |
| `springdoc.api-docs.enabled: false`를 두지 않는다 | 운영에서 하는 일이 없는 설정이 `application.yml`에 남지 않는다 | 모든 테스트 컨텍스트에 문서 주소가 생긴다. 결정 3의 테스트를 쓸 수 없고 의존성 범위가 바뀌면 운영에서 켜진다 | 채택하지 않음 |
| 변환기를 빼는 설정(결정 9)을 두지 않는다 | 운영에는 YAML 변환기가 없어 테스트 때문인 설정이 main에 생기지 않는다 | 테스트에서만 YAML을 받는다. 다른 라이브러리가 들여온 형식은 조용히 열린다 | 채택하지 않음 |
| 테스트 의존성에서 `jackson-dataformat-yaml`만 뺀다 | main의 설정이 필요 없다 | springdoc이 그 클래스를 써서 뜨지 않을 수 있다(미확인). 다른 라이브러리가 들여오는 것은 막지 못한다 | 채택하지 않음 |
| Swagger UI까지 넣는다(`webmvc-ui`) | 브라우저에서 읽고 바로 불러 볼 수 있다 | 화면 라이브러리의 취약점(DOMPurify)을 따라가야 하고 주소를 열어야 한다 | 채택하지 않음 |
| springdoc Gradle 플러그인으로 빌드 때 만든다 | 테스트와 나뉜다 | 빌드에서 앱과 DB를 띄워야 한다. 빌드 플러그인이 하나 늘고 Boot 4.2에서 시험했다는 기록이 없다 | 채택하지 않음 |
| Spring REST Docs와 restdocs-api-spec | 테스트한 것만 문서에 나온다. 운영 코드에 어노테이션이 없다 | API마다 테스트에 문서 코드를 써야 한다. Boot 4.0.5 기준이고 호환 문제가 남을 수 있다고 적혀 있다 | 채택하지 않음 |
| 명세를 손으로 먼저 쓴다 | 구현 전에 화면과 맞출 수 있다 | 코드와 어긋난다. owner가 자동 생성으로 정했다 | 채택하지 않음 |
| SmallRye OpenAPI의 Spring 확장(4.4.1, 2026-11-05) | 유지 관리된다 | Spring Boot에서 실행 중에 문서를 내는 방법을 확인하지 못했다 | 채택하지 않음 |
| springfox | 예전 예제가 많다 | 2020년 뒤로 멈췄다 | 채택하지 않음 |
| 지금 버전을 기다리거나 Boot를 낮춘다 | 없다 | 맞는 버전이 이미 있다 | 필요 없음 |

## 결과

- 좋아지는 것: 서버와 화면이 같은 명세를 본다. 명세가 바뀌면 PR의 파일 차이로 드러나고 코드와 다르면 CI가 실패한다. 운영과 로컬 서버에는 라이브러리도 문서 주소도 더해지지 않는다.
- 대가: 서버를 띄워도 문서를 받을 수 없고 파일을 봐야 한다. API를 바꿀 때마다 `server/openapi.json`도 바꿔 커밋한다. API PR 둘이 동시에 열리면 이 파일이 충돌하고 다시 만들어야 한다. 이름과 널 표시의 규칙(결정 6)을 지켜야 한다. 테스트 컨텍스트가 하나 늘어 몇 초 길어진다(추정).
- 받아들인 위험: springdoc 3.2.1은 나온 지 6일, swagger-core 3.0.0은 한 달 된 버전이다. 운영에 들어가지 않으므로 문제가 생겨도 문서에 그친다.
- 받아들인 위험: 한 사람이 거의 다 만드는 라이브러리다. 멈추면 결정 8의 파일을 남기고 도구를 바꾼다. 우리 코드에 남는 것은 테스트의 설정 클래스 하나와 어노테이션이다.
- 받아들인 위험: 테스트와 운영의 실행 경로가 springdoc과 함께 들어오는 파일만큼 다르다. 지금까지 본 동작의 차이는 YAML이고 결정 9가 없앤다.
- 받아들인 위험: 어노테이션 jar의 열거를 어노테이션 밖에서 쓰면 운영에서만 실패한다. 글로만 금지한다(결정 2).
- 받아들인 위험: 문서의 설명은 사람이 적는다. 코드와 어긋나도 테스트가 잡지 못한다.
- 되돌리기: 의존성 두 줄, Gradle 확인, 설정 한 줄, 테스트와 그 설정 클래스, 파일을 지운다. DB와 API의 동작은 바뀌지 않는다. 어노테이션은 남겨도 되지만 `compileOnly` 의존성이 필요하다. 결정 9는 ADR 001 결정 5를 지키는 것이라 남긴다.
- 다시 검토할 조건: 결정 2의 구성이 #32에서 빌드되지 않을 때, 개발용 문서 주소가 필요해질 때, Spring Boot를 올리는데 맞는 springdoc이 나오지 않을 때, 네이티브 앱(4단계)이나 웹이 클라이언트 코드를 생성하기로 할 때(열거와 필수의 뜻, 깨지는 변경의 자동 검사), 밖에 API를 공개할 때, `example` 없이는 이해하기 어렵다는 말이 나올 때(비밀 필드만 막는 것으로 좁힌다).

이 결정으로 고칠 문서와 이슈는 다음과 같다. "지금"은 2026-11-26에 읽은 상태다(확인).

| 대상 | 지금 | 고칠 것 |
|---|---|---|
| #32의 수용 기준 | `server/openapi.json`과 빌드 실패, "문서 주소의 응답이 없는 경로와 같다", 의존성 구성과 실제 빌드 확인, `bootJar` 확인이 들어갔다(ledger, 2026-11-26) | 변환기를 JSON만 남기는 것과 415 테스트(결정 9)가 없다 |
| #32의 "검토와 알림" | "문서 주소와 보는 방법을 frontend 봇에게 알린다" | 문서 주소가 없다. `server/openapi.json`과 다시 만드는 방법을 알린다(결정 10) |
| #32의 크기 | S. 다시 본다고 적혀 있다 | 결정 8의 검사와 결정 9를 넣어 다시 본다 |
| #12 | 공개 주소는 로그인과 `/actuator/health`다 | 없다. 문서 주소를 더하지 않는다(결정 4) |
| #13, #14, #15 등 API 이슈 | "성공 응답과 오류 응답이 OpenAPI 문서에 나온다" | 없다. `server/openapi.json`의 차이와 결정 8의 테스트로 닫는다. 이름 규칙(결정 6)을 따른다 |
| ADR 004 결정 7 | 규칙은 실제로 어긴 사례가 나왔을 때만 늘린다 | 없다. 예외를 두지 않는다(결정 2) |
| 주간 보안 점검(security), 의존성 자동 갱신(#98, #104) | springdoc이 없다. OSV는 springdoc의 공지를 모른다 | 점검에 springdoc 저장소의 공지를 직접 보는 것을 넣는다(결정 1, security). 자동 갱신이 이 의존성을 어떻게 다루는지는 확인하지 못했다(devops) |
| 루트 `CLAUDE.md` | 명세 파일을 보는 방법이 없다 | #32가 바꾸지 않기로 했다. 보는 방법과 파일을 다시 만드는 방법은 #32의 PR 본문과 테스트의 실패 문구에 적는다 |
