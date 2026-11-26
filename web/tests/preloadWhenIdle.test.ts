import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LazyScreen } from '../src/app/lazyScreen'
import { IDLE_FALLBACK_MS, preloadWhenIdle } from '../src/app/preloadWhenIdle'

/* 자주 가는 화면의 코드를 브라우저가 한가할 때 미리 받는다(#251). 연결이 없거나 데이터 절약이면 서두르지 않는다. */

function fakeScreen(): LazyScreen {
  return { Screen: () => null, preload: vi.fn() }
}

/** 한가해지면 부를 일. requestIdleCallback이 받은 것이다 */
let idle: (() => void) | undefined
const requestIdle = vi.fn((callback: () => void) => {
  idle = callback
  return 7
})
const cancelIdle = vi.fn()

beforeEach(() => {
  idle = undefined
  vi.stubGlobal('requestIdleCallback', requestIdle)
  vi.stubGlobal('cancelIdleCallback', cancelIdle)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  requestIdle.mockClear()
  cancelIdle.mockClear()
})

describe('미리 받기', () => {
  it('브라우저가 한가해지면 받는다. 그 전에는 받지 않는다', () => {
    const [list, entry] = [fakeScreen(), fakeScreen()]
    preloadWhenIdle([list, entry])
    expect(list.preload).not.toHaveBeenCalled()
    // 바빠도 2초가 지나면 받는다
    expect(requestIdle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 })
    idle!()
    expect(list.preload).toHaveBeenCalledTimes(1)
    expect(entry.preload).toHaveBeenCalledTimes(1)
  })

  it('requestIdleCallback이 없으면(Safari) 잠시 뒤에 받는다', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    // 가짜 시계가 requestIdleCallback을 다시 넣지 않게 setTimeout만 바꾼다
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const list = fakeScreen()
    preloadWhenIdle([list])
    vi.advanceTimersByTime(IDLE_FALLBACK_MS - 1)
    expect(list.preload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(list.preload).toHaveBeenCalledTimes(1)
  })

  it('연결이 없으면 연결될 때까지 기다린다', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const list = fakeScreen()
    preloadWhenIdle([list])
    expect(requestIdle).not.toHaveBeenCalled()
    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    idle!()
    expect(list.preload).toHaveBeenCalledTimes(1)
  })

  it('데이터 절약을 켰으면 받지 않는다(architect #251)', () => {
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { connection: { saveData: true } }))
    const list = fakeScreen()
    preloadWhenIdle([list])()
    expect(requestIdle).not.toHaveBeenCalled()
    expect(list.preload).not.toHaveBeenCalled()
  })

  it('취소하면 받지 않는다', () => {
    const list = fakeScreen()
    preloadWhenIdle([list])()
    expect(cancelIdle).toHaveBeenCalledWith(7)
  })

  it('연결을 기다리는 동안 취소하면 연결되어도 받지 않는다', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const list = fakeScreen()
    preloadWhenIdle([list])()
    onLine.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(requestIdle).not.toHaveBeenCalled()
    expect(list.preload).not.toHaveBeenCalled()
  })
})
