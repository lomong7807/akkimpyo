import { act } from '@testing-library/react'
import { vi } from 'vitest'

/** 누름을 막는 시간(src/components/pressGuard.ts의 PRESS_GUARD_MS) */
const PRESS_GUARD_MS = 300

/** 지금 쓰는 시계. 가짜 rAF로 알아본다. 테스트가 시계를 다시 걸면 rAF가 바뀌어 이 시계가 아니게 된다. */
let running: { frame: typeof requestAnimationFrame; pump: ReturnType<typeof setInterval> } | undefined

/**
 * 누름을 막는 시간을 실제로 기다리지 않게 하는 시계. setTimeout과 rAF를 가짜로 바꾸고, 실제로 흐른 시간만큼 따라 보내
 * 진짜 시계처럼 돌게 한다. 막는 시간이 끝나기를 기다리는 곳(untilOpened, untilUnshielded)에서만 그 시간을 앞당긴다.
 * Date는 바꾸지 않는다. 앱의 지금과 시간대는 기기의 시계(tests/support/clock.ts의 setDeviceClock)로 정한다.
 */
export function startGuardClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  // 가짜로 바꾸지 않은 진짜 시계로 흐른 시간을 잰다. 바쁜 동안 밀린 시간도 다음에 한꺼번에 보낸다
  let last = performance.now()
  const pump = setInterval(() => {
    if (!usesGuardClock()) return
    const elapsed = Math.floor(performance.now() - last)
    if (elapsed < 1) return
    last += elapsed
    vi.advanceTimersByTime(elapsed)
  }, 1)
  running = { frame: requestAnimationFrame, pump }
}

/** 지금 이 시계를 쓰는지. */
export function usesGuardClock(): boolean {
  return running !== undefined && vi.isFakeTimers() && requestAnimationFrame === running.frame
}

/**
 * 누름을 막는 시간이 지난 것으로 한다. 막는 시간은 다음 화면(rAF)부터 세므로 다음 화면까지 보낸 뒤 그 시간을 보낸다.
 * 가짜 rAF가 다음 화면까지 기다리는 시간은 16ms를 넘기도 한다(가짜 시계를 시작한 때보다 앞으로 돌린 뒤, #225).
 */
function passGuardTime() {
  vi.advanceTimersToNextFrame()
  vi.advanceTimersByTime(PRESS_GUARD_MS)
}

/** 이 시계를 쓰면 누름을 막는 시간이 지난 것으로 한다. 그 사이에 올 다른 시계도 함께 온다. */
export async function passPressGuard() {
  if (!usesGuardClock()) return
  await act(async () => {
    vi.advanceTimersToNextFrame()
    await vi.advanceTimersByTimeAsync(PRESS_GUARD_MS)
  })
}

/**
 * 테스트가 다른 가짜 시계를 다시 걸었으면 이 시계로 돌아온다. 그 시계에 남은 것은 버린다(진짜 시계로 돌아갈 때와 같다).
 * 화면을 정리하기(cleanup) 전에 부른다. 화면에서 빠진 뒤의 덮개가 이 시계에 걸려야 stopGuardClock()이 걷는다.
 * 다른 시계에서 정리하면 덮개의 진짜 rAF가 다음 테스트의 이 시계에 300ms를 걸고, 그 테스트가 시계를 다시 걸면 덮개가 남는다.
 */
export function resumeGuardClock() {
  if (usesGuardClock()) return
  stopGuardClock()
  startGuardClock()
}

/**
 * 테스트를 끝낸다. 화면에서 빠진 뒤에도 남는 덮개를 걷고 진짜 시계로 돌아간다.
 * 남겨 두면 덮개의 시계가 다음 테스트나 jsdom을 정리한 뒤에 돈다. 진짜 시계로 돌아가면 가짜 시계에 걸린 것은 돌지 않는다.
 */
export function stopGuardClock() {
  if (usesGuardClock()) act(passGuardTime)
  if (running) clearInterval(running.pump)
  running = undefined
  vi.useRealTimers()
}
