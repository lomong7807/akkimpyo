import { randomBytes } from 'node:crypto'
import { defineConfig, devices } from '@playwright/test'

/**
 * web의 개발 서버를 이 포트로 따로 띄운다. 개발할 때 쓰는 5173과 겹치지 않게 하고,
 * 이미 떠 있는 서버(다른 작업 폴더의 것일 수 있다)를 이어 쓰지 않는다.
 */
const PORT = 5180
const baseURL = `http://localhost:${PORT}`

/** 개발 서버가 /api를 넘기는 서버의 포트(web/vite.config.ts의 backend). 서버를 이 포트로 띄운다 */
const SERVER_PORT = 8080

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 들쭉날쭉한 테스트를 다시 돌려 덮지 않는다(docs/qa/test-strategy.md 1절)
  retries: 0,
  // 테스트마다 걸린 시간을 남긴다
  reporter: 'list',
  use: {
    baseURL,
    // 장부 시간대(CLAUDE.md). 기기의 오늘(계좌 기준일, 거래 날짜의 기본값)이 실행하는 컴퓨터의 시간대에 따라 달라지지 않게 한다
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
  },
  projects: [
    // 폭 1280px: 넓은 화면(화면설계서 00-common 2.5, 1024px 이상)
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // 폭 402px: 휴대폰 배치. Safari와 같은 엔진이지만 실제 아이폰은 아니다(test-strategy.md 5절)
    { name: 'webkit-iphone', use: { ...devices['iPhone 17'] } },
  ],
  webServer: [
    {
      // server/에서 ./gradlew bootJar로 만든 jar. 이름은 server/settings.gradle의 이름과 build.gradle의 version을 따른다.
      // DB는 local 프로파일의 기본값(레포 루트 compose.yaml의 DB)이고, 환경 변수 DB_URL·DB_USERNAME·DB_PASSWORD를 주면 그것을 쓴다.
      command: 'java -jar build/libs/account-book-server-0.0.1-SNAPSHOT.jar',
      cwd: '../server',
      url: `http://127.0.0.1:${SERVER_PORT}/actuator/health`,
      reuseExistingServer: false,
      // 시작할 때 Flyway가 스키마를 적용한다
      timeout: 120_000,
      env: {
        // local 프로파일에서만 refresh 쿠키의 Secure와 __Secure- 접두어가 꺼져 http에서도 브라우저가 쿠키를 남긴다(RefreshCookie)
        SPRING_PROFILES_ACTIVE: 'local',
        SERVER_PORT: String(SERVER_PORT),
        WEB_ORIGIN: baseURL,
        // 테스트마다 새 이메일로 가입한다(test-strategy.md 4절, tests/support/ledger.ts). 테스트용 도메인은 여기에만 둔다
        SIGNUP_ALLOWLIST: '@example.com',
        // 실행마다 새로 만드는 테스트용 서명 키. 어디에도 적거나 남기지 않는다(서버 테스트의 TestAccessTokens와 같은 방식)
        ACCESS_TOKEN_SIGNING_KEY: randomBytes(32).toString('base64'),
      },
    },
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      cwd: '../web',
      url: baseURL,
      reuseExistingServer: false,
    },
  ],
})
