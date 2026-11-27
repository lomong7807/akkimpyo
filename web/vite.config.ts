import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { reactRouterTreeShake } from './plugins/reactRouterTreeShake'
import { serviceWorker } from './plugins/serviceWorkerPlugin'

const backend = 'http://localhost:8080'

export default defineConfig({
  // reactRouterTreeShake: react-router에서 앱이 쓰지 않는 부품이 첫 화면 JS에 남지 않게 한다(#355). 지우면 원래대로 돌아간다
  plugins: [react(), reactRouterTreeShake(), serviceWorker()],
  build: {
    // modulepreload를 모르는 옛 브라우저용 polyfill을 넣지 않는다(#355). 없어도 따로 싣는 조각의 미리 받기만 빠지고 동작은 같다
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // 첫 화면이 받는 JS를 한 파일로 묶는다(#268). '$initial'은 entry(src/main.tsx)에서 정적 import로 닿는 모듈 전부다.
        // 기본 나눔은 entry와 따로 싣는 화면(app/screens.tsx의 동적 import)이 함께 쓰는 모듈을 쓰는 곳의 조합마다 작은 조각으로
        // 떼어, import 그래프가 조금만 바뀌어도 첫 화면의 파일 수와 파일마다 따로 압축하는 손해가 늘었다.
        // 동적 import로만 닿는 모듈은 이 묶음에 들지 않고 기본 나눔을 따른다. 라이브러리(vendor)를 따로 떼지 않는 것은
        // service worker가 새 판마다 미리 캐시할 파일을 모두 다시 받아(cache: 'reload') 떼어도 덜 받는 것이 없어서다.
        codeSplitting: { groups: [{ name: 'initial', tags: ['$initial'] }] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/actuator': backend,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: 'tests/support/setup.ts',
    // 컴포넌트 CSS를 실제로 넣어, 화면에 적용된 값을 테스트에서 읽는다.
    css: true,
  },
})
