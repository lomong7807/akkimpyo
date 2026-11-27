import type { LazyScreen } from './lazyScreen'

/** requestIdleCallback이 없을 때(Safari) 미루는 시간. 첫 화면의 조회가 먼저 나가도록 둔 틈이다(추정, 재서 고칠 값). */
export const IDLE_FALLBACK_MS = 200

/** 바빠도 이만큼 지나면 받는다 */
const IDLE_TIMEOUT_MS = 2000

/**
 * 자주 가는 화면의 코드를 브라우저가 한가할 때 미리 받아, 처음 옮겨 갈 때 뼈대 없이 바로 그린다(#251).
 * 연결이 없으면 연결될 때까지 기다리고, 데이터 절약을 켰으면 받지 않는다(architect #251). 돌려주는 함수로 취소한다.
 */
export function preloadWhenIdle(screens: LazyScreen[]): () => void {
  if (savesData()) return () => {}
  let cancel = () => {}

  function schedule() {
    if (navigator.onLine === false) {
      window.addEventListener('online', schedule, { once: true })
      cancel = () => window.removeEventListener('online', schedule)
      return
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS })
      cancel = () => window.cancelIdleCallback(id)
    } else {
      const id = window.setTimeout(run, IDLE_FALLBACK_MS)
      cancel = () => window.clearTimeout(id)
    }
  }

  function run() {
    cancel = () => {}
    screens.forEach((screen) => screen.preload())
  }

  schedule()
  return () => cancel()
}

/** 데이터 절약(Save-Data). Network Information API는 Chromium에만 있다. */
function savesData(): boolean {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } }
  return connection?.saveData === true
}
