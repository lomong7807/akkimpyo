import { afterEach, describe, expect, it, vi } from 'vitest'
import { goOffline, goOnline } from './support/connection'

/*
 * 연결 없음 띠를 보일 때(00-common 6.1 (6) [판단 56], #235). 신호로 끊기면 2초가 넘을 때, 요청이 연결 문제로 실패하면 바로 띄운다.
 * 화면을 그리지 않고 가짜 시계로 경계를 잰다.
 */

let stop: (() => void) | undefined

afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
})

async function load() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.resetModules()
  const connection = await import('../src/api/connection')
  const band = await import('../src/features/connection/bandState')
  const stopWatching = connection.watchConnection()
  const stopBand = band.watchConnectionBand()
  stop = () => {
    stopBand()
    stopWatching()
  }
  const read = () => band.bandStateNow()
  return { read }
}

describe('띠를 띄우는 때', () => {
  it('신호로 끊기면 1999ms까지는 없고 2000ms에 띄운다', async () => {
    const { read } = await load()
    goOffline()
    vi.advanceTimersByTime(1_999)
    expect(read()).toBe('hidden')
    vi.advanceTimersByTime(1)
    expect(read()).toBe('shown')
  })

  it('2초 안에 돌아오면 띄우지 않고, 다시 끊기면 2초를 처음부터 센다', async () => {
    const { read } = await load()
    goOffline()
    vi.advanceTimersByTime(1_500)
    goOnline()
    expect(read()).toBe('hidden')
    goOffline()
    vi.advanceTimersByTime(1_999)
    expect(read()).toBe('hidden')
    vi.advanceTimersByTime(1)
    expect(read()).toBe('shown')
  })

  it('띠가 보인 뒤에 돌아오면 바로 지우고 다시 연결됐다고 알린다. 띠를 띄우지 않았으면 알리지 않는다', async () => {
    const { read } = await load()
    goOffline()
    vi.advanceTimersByTime(2_000)
    goOnline()
    expect(read()).toBe('reconnected')
    goOffline()
    expect(read()).toBe('hidden')
    vi.advanceTimersByTime(2_000)
    expect(read()).toBe('shown')
  })

  it('멈추면 시계가 남지 않는다', async () => {
    const { read } = await load()
    goOffline()
    stop!()
    stop = undefined
    vi.advanceTimersByTime(2_000)
    expect(read()).toBe('hidden')
    expect(vi.getTimerCount()).toBe(0)
  })
})
