import { act } from '@testing-library/react'
import { vi } from 'vitest'

/** 누름을 막는 시간(src/components/pressGuard.ts의 PRESS_GUARD_MS)과 그것을 거는 한 화면(ms) */
const PRESS_GUARD_MS = 300
const FRAME_MS = 17

/** 지금 쓰는 시계. 가짜 rAF로 알아본다. 테스트가 시계를 다시 걸면 rAF가 바뀌어 이 시계가 아니게 된다. */
let running: { frame: typeof requestAnimationFrame; pump: ReturnType<typeof setInterval> } | undefined

/**
 * 누름을 막는 시간을 실제로 기다리지 않게 하는 시계. setTimeout, rAF, Date를 가짜로 바꾸고, 실제로 흐른 시간만큼 따라
 * 보내 진짜 시계처럼 돌게 한다. 막는 시간이 끝나기를 기다리는 곳(untilOpened, untilUnshielded)에서만 그 시간을 앞당긴다.
 * Date는 now에서 시작해 흐른다. 밀리초 경계를 시험하는 파일은 Date를 멈춘 채 쓰고 이 시계를 쓰지 않는다.
 */
export function startGuardClock(now?: Date) {
  vi.useFakeTimers({
    now,
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  })
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

/** 이 시계를 쓰면 누름을 막는 시간이 지난 것으로 한다. 그 사이에 올 다른 시계도 함께 온다. */
export async function passPressGuard() {
  if (usesGuardClock()) await act(() => vi.advanceTimersByTimeAsync(PRESS_GUARD_MS + FRAME_MS))
}

/**
 * 테스트를 끝낸다. 화면에서 빠진 뒤에도 남는 덮개를 걷고 진짜 시계로 돌아간다.
 * 남겨 두면 덮개의 시계가 다음 테스트나 jsdom을 정리한 뒤에 돈다.
 */
export function stopGuardClock() {
  if (usesGuardClock()) act(() => void vi.advanceTimersByTime(PRESS_GUARD_MS + FRAME_MS))
  if (running) clearInterval(running.pump)
  running = undefined
  vi.useRealTimers()
}
