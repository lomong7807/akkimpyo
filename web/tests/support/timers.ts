import { vi } from 'vitest'

/** 앱이 거는 시계(ms). Node의 fetch가 스스로 쓰는 시계와 나눈다. */
const APP_TIMERS = [5_000, 15_000]

/** 부른 뒤부터 앱이 건 시계 가운데 멈추지 않은 것의 수를 센다. */
export function watchAppTimers(): () => number {
  const set = vi.spyOn(globalThis, 'setTimeout')
  const clear = vi.spyOn(globalThis, 'clearTimeout')
  return () => {
    const cleared = new Set(clear.mock.calls.map(([timer]) => timer))
    return set.mock.results.filter(
      ({ value }, index) => APP_TIMERS.includes(Number(set.mock.calls[index][1])) && !cleared.has(value),
    ).length
  }
}
