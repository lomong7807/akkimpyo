import { setClock } from '../../src/lib/clock'

/** 시간대를 따로 정하지 않은 테스트의 기기 시간대. 서비스의 시간대다. */
export const SEOUL = 'Asia/Seoul'

/** 시계를 따로 정하지 않은 테스트의 기기의 지금(tests/support/setup.ts) */
export const DEFAULT_NOW = '2026-11-26T12:00:00+09:00'

/**
 * 기기의 시계를 `at`에 멈춰 두고 기기의 시간대를 `timeZone`으로 한다. `at`은 오프셋(Z, +09:00)을 적은 ISO 시각이다.
 * 앱은 지금과 시간대를 이 시계(src/lib/clock)에서만 읽으므로 테스트를 돌리는 기기의 시간대(TZ)와 상관없이 같다.
 * 가짜 Date(vi.setSystemTime)는 앱의 지금을 바꾸지 않는다. 라이브러리의 시계(캐시가 오래됐는지 등)만 바꾼다.
 */
export function setDeviceClock(at: string, timeZone = SEOUL): void {
  const instant = Date.parse(at)
  if (!/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(at) || Number.isNaN(instant)) {
    throw new Error(`오프셋을 적은 ISO 시각이어야 한다: ${at}`)
  }
  setClock({ now: () => instant, timeZone })
}
