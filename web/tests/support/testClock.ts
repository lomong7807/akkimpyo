import { act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, vi } from 'vitest'

/*
 * 공용 시계(docs/qa/test-strategy.md 8절). 가림막(pressGuard)이나 덮개(dialog shield)를 여는 화면을 그리는 파일은 테스트마다
 * 이 시계 하나로 돈다. 앱 그리기 도우미(openApp, renderRoutes, transactionScreen)와 dialog 도우미를 불러오면 켜진다.
 *
 * - 시계를 멈추거나 앞당기는 것은 여기의 holdClock, releaseClock, passTime, passPressGuard로만 한다.
 *   테스트 안에서 vi.useFakeTimers, vi.useRealTimers, vi.setSystemTime을 부르지 않는다(clockRules.ts가 검사한다).
 * - 날짜와 시각은 tests/support/clock.ts의 setDeviceClock으로 정한다. 이 시계는 앱의 지금을 바꾸지 않는다.
 * - userEvent는 setupUser()로 만든다(openApp이 돌려주는 user도 이것이다).
 */

/** 누름을 막는 시간(src/components/pressGuard.ts의 PRESS_GUARD_MS) */
const PRESS_GUARD_MS = 300

/**
 * 공용 시계가 가짜로 바꾸는 것. 앱과 라이브러리가 시간을 재는 것은 모두 이 시계로 간다(받아 둔 목록이 오래됐는지 보는 Date 포함).
 * setInterval, setImmediate, queueMicrotask, nextTick은 진짜로 둔다. waitFor가 확인하는 주기, 가짜 서버(msw)가 요청을 받는 길,
 * 이 시계를 실제 시간에 따라 보내는 펌프가 그것으로 돈다.
 */
const FAKED = ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] as const

/** 닫은 뒤의 덮개(src/components/pressGuard.ts) */
export const SHIELD = 'body > [class*="shield"]'

interface Running {
  /** 이 시계의 가짜 rAF. 다른 시계가 걸리면 rAF가 바뀌어 알아본다 */
  frame: typeof requestAnimationFrame
  pump: ReturnType<typeof setInterval>
  /** 멈췄으면 실제로 흐른 시간을 따라가지 않는다 */
  held: boolean
  /** 펌프가 마지막으로 따라 보낸 때(performance.now) */
  last: number
}

let running: Running | undefined

/**
 * 가짜 시계를 켜고, 실제로 흐른 시간만큼 따라 보내 진짜 시계처럼 돌게 한다. 바쁜 동안 밀린 시간은 다음에 한꺼번에 보낸다.
 * sinon의 shouldAdvanceTime은 쓰지 않는다. 바쁜 동안 실제보다 늦게 가서 누름을 막는 시간을 0ms로 망가뜨린 변이를 놓쳤다(#219).
 */
function startTestClock() {
  vi.useFakeTimers({ toFake: [...FAKED] })
  const pump = setInterval(() => {
    if (!running || !usesTestClock()) return
    const now = performance.now()
    if (running.held) {
      // 시각은 그대로 두고 지금 올 것(0ms로 미룬 일, 라이브러리의 알림)만 부른다
      running.last = now
      vi.advanceTimersByTime(0)
      return
    }
    const elapsed = Math.floor(now - running.last)
    if (elapsed < 1) return
    running.last += elapsed
    vi.advanceTimersByTime(elapsed)
  }, 1)
  running = { frame: requestAnimationFrame, pump, held: false, last: performance.now() }
}

function usesTestClock(): boolean {
  return running !== undefined && vi.isFakeTimers() && requestAnimationFrame === running.frame
}

function testClock(caller: string): Running {
  if (!usesTestClock()) {
    throw new Error(`${caller}: 공용 시계가 켜져 있지 않다. 앱 그리기·dialog 도우미를 쓰는 파일은 공용 시계 하나로 돈다(8절 1)`)
  }
  return running!
}

/**
 * 시계를 멈춘다. 실제로 흐른 시간을 따라가지 않고 passTime으로 보낸 만큼만 간다. 정한 ms의 경계를 보는 곳(300ms 뒤의 글,
 * 15초 동안 응답 없음, 받은 지 30초)에 쓴다. 멈춘 동안에도 요청과 응답은 오가고, 0ms로 미룬 일(라이브러리의 알림 등)은 돈다.
 * waitFor·findBy의 한도는 멈추므로 기다리던 것이 오지 않으면 테스트 시간 한도(5초)까지 기다린 뒤 실패한다.
 */
export function holdClock() {
  testClock('holdClock').held = true
}

/** 멈춘 시계를 다시 흐르게 한다. 멈춘 동안 실제로 흐른 시간은 보내지 않는다. */
export function releaseClock() {
  const clock = testClock('releaseClock')
  clock.held = false
  clock.last = performance.now()
}

/**
 * 누름을 막는 시간이 지난 것으로 한다. 막는 시간은 다음 화면(rAF)부터 세므로 다음 화면까지 보낸 뒤 그 시간을 보낸다.
 * 그 사이에 올 다른 시계도 함께 온다. 가짜 rAF가 다음 화면까지 기다리는 시간은 16ms를 넘기도 한다(#225).
 * 판·덮개를 기다리는 곳은 dialog 도우미(untilOpened, untilUnshielded)를 쓴다(8절 2).
 */
export async function passPressGuard() {
  testClock('passPressGuard')
  await act(async () => {
    vi.advanceTimersToNextFrame()
    await vi.advanceTimersByTimeAsync(PRESS_GUARD_MS)
  })
}

/**
 * `ms`만큼 시간이 지난 것으로 한다. 그 사이에 올 시계는 차례로 온다. 앱의 시계(뼈대를 보이기까지의 300ms, 강조 1초, 15초 응답
 * 없음)와 라이브러리의 시계(받아 둔 목록이 오래되는 30초)를 기다리는 곳에 쓴다. 응답이 오기를 기다려 "일어나지 않음"을 보는
 * 곳에는 쓰지 않는다. 앞당기는 동안 실제 시간은 거의 흐르지 않아 그사이 와야 할 응답이 오지 않는다.
 */
export async function passTime(ms: number) {
  testClock('passTime')
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

/** userEvent를 공용 시계에 잇는다. 누르기 사이의 기다림(delay)을 실제로 기다리지 않고 시계를 그만큼 보낸다. */
export function setupUser() {
  return userEvent.setup({ advanceTimers: (ms) => (usesTestClock() ? vi.advanceTimersByTimeAsync(ms) : undefined) })
}

/**
 * 테스트를 끝낸다. 화면에서 빠진 뒤에도 남는 덮개를 시계를 보내 걷고 진짜 시계로 돌아간다. 걷히지 않는 덮개가 있으면
 * 기다리지 않고 그 테스트의 이름으로 바로 실패한다(8절 4). 남겨 두면 다음 테스트나 jsdom을 정리한 뒤에 그 시계가 돈다.
 */
function stopTestClock() {
  if (!running) return
  const ours = usesTestClock()
  if (ours) {
    act(() => {
      vi.advanceTimersToNextFrame()
      vi.advanceTimersByTime(PRESS_GUARD_MS)
    })
  }
  clearInterval(running.pump)
  running = undefined
  vi.useRealTimers()
  if (document.querySelector(SHIELD)) {
    const why = ours ? '' : ' 테스트 안에서 다른 시계를 걸어 덮개의 시계가 버려졌다(8절 1).'
    throw new Error(`덮개가 걷히지 않았다: ${expect.getState().currentTestName}.${why}`)
  }
}

let used = false

/**
 * 이 파일의 테스트마다 공용 시계를 켜고 끈다. 앱 그리기 도우미와 dialog 도우미가 불러올 때 부른다. 한 파일에서 여러 번 불러도
 * 한 번만 건다. 테스트 파일이 이 도우미를 불러올 때 걸리므로, 그 파일의 beforeEach보다 먼저 켜지고 afterEach(화면 정리) 뒤에 꺼진다.
 */
export function enableTestClock() {
  if (used) return
  used = true
  beforeEach(startTestClock)
  afterEach(stopTestClock)
}
