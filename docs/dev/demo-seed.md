# 데모 계정과 예시 데이터 (local 전용)

`server/`에서 `./gradlew demoSeed`로 넣고 `./gradlew demoSeedRemove`로 지운다(#349).

- compose DB(`localhost:5433`)가 떠 있어야 한다. 이 컴퓨터의 다른 DB는 `DB_URL`, `DB_USERNAME`, `DB_PASSWORD`로 준다.
- 앱을 local 프로파일의 시드 모드로 빈 포트에 띄워 일을 마치면 끝난다(`bootRun` 서버가 떠 있어도 된다). 이 실행에만
  가입 허용 목록에 `demo@example.com`을 주고, `ACCESS_TOKEN_SIGNING_KEY`가 셸에 없으면 쓰고 버리는 난수를 준다.
- Gradle 작업 없이: `ACCESS_TOKEN_SIGNING_KEY=… ./gradlew bootRun --args='--spring.profiles.active=local --demo.seed=insert --server.port=0 --SIGNUP_ALLOWLIST=demo@example.com'`(지우기는 `--demo.seed=remove`)
- 넣는 것: 계정 `demo@example.com` / 비밀번호 `demo1234pw`(로컬 전용 값), 장부 `내 가계부` 1개와 기본 카테고리(P-223),
  계좌 지갑(현금) 50,000원·생활비 통장(은행) 1,500,000원·신용카드(카드) 0원(기준일 지난달 1일), 지난달·이번 달 거래 21건
  (지출 15, 수입 3, 이체 3, 실행한 날의 서울 날짜로 이번 달은 오늘까지). 이름과 가맹점은 지어낸 일반 이름이다.
- **두 번 넣으면 건너뛴다.** 날짜를 오늘에 다시 맞추려면 지운 뒤 넣는다.
- **지우기**는 데모 계정과 그 장부의 모든 데이터(구성원, 계좌, 카테고리, 거래와 라인, 변경 이력, refresh token)를 한 트랜잭션으로
  지운다. 다른 사용자의 데이터는 지우지 않고, 데모 장부에 다른 사용자가 있으면 아무것도 지우지 않고 실패한다.

## 운영 차단

- 시드 빈은 local 프로파일에서만 생긴다. 운영은 프로파일 없이 뜨므로 `--demo.seed`를 줘도 아무 일도 하지 않는다. HTTP 경로는 없다.
- **운영 DB를 가리키지 않는다(가리키면 거부한다).** 쓰기 직전에 실제 접속 주소의 호스트가 `localhost`·`127.0.0.1`·`::1`이 아니면 아무것도 쓰지 않고 실패한다.
- 쓰기 직전에 활성 프로파일을 다시 본다. local 밖의 프로파일이 하나라도 섞이면(예: `local,prod`) 아무것도 쓰지 않고 실패한다.
