import { defineConfig, devices } from '@playwright/test'

/**
 * web의 개발 서버를 이 포트로 따로 띄운다. 개발할 때 쓰는 5173과 겹치지 않게 하고,
 * 이미 떠 있는 서버(다른 작업 폴더의 것일 수 있다)를 이어 쓰지 않는다.
 */
const PORT = 5180
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // 들쭉날쭉한 테스트를 다시 돌려 덮지 않는다(docs/qa/test-strategy.md 1절)
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    // 폭 1280px: 넓은 화면(화면설계서 00-common 2.5, 1024px 이상)
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // 폭 402px: 휴대폰 배치. Safari와 같은 엔진이지만 실제 아이폰은 아니다(test-strategy.md 5절)
    { name: 'webkit-iphone', use: { ...devices['iPhone 17'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    cwd: '../web',
    url: baseURL,
    reuseExistingServer: false,
  },
})
