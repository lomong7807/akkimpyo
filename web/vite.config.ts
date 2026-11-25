import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const backend = 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
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
