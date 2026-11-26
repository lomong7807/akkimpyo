import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { goOffline, goOnline, startOffline } from './support/connection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'

/*
 * 연결 판단(00-common 4.3 [판단 28], #234). 브라우저의 online·offline 신호와 요청의 결과를 함께 본다.
 * 우리 프록시와 서버를 거친 응답에는 X-Request-Id가 있다(ADR 005 결정 7). 그 헤더가 있는 응답을 받아야 연결이 있다고 본다.
 */

const server = startMockServer()

/** 우리 서버의 응답처럼 X-Request-Id를 붙인다. */
const withRequestId = (response: Response) => {
  response.headers.set('X-Request-Id', 'req-1')
  return response
}

let probes = 0
let probeResponse: () => Response = () => withRequestId(problem(404, 'NOT_FOUND'))

beforeEach(() => {
  probes = 0
  probeResponse = () => withRequestId(problem(404, 'NOT_FOUND'))
  server.use(
    http.head('/api/v1/', () => {
      probes += 1
      return probeResponse()
    }),
    http.get('/api/v1/ok', () => withRequestId(HttpResponse.json({}))),
    http.get('/api/v1/broken', () => withRequestId(problem(500, 'INTERNAL_ERROR'))),
    http.get('/api/v1/portal', () => new HttpResponse('<html>로그인하세요</html>', { status: 200 })),
    http.get('/api/v1/unreachable', () => HttpResponse.error()),
    http.get('/api/v1/slow', () => new Promise(() => {})),
  )
})

let stopWatching: (() => void) | undefined

afterEach(() => {
  stopWatching?.()
  stopWatching = undefined
  vi.useRealTimers()
})

async function load({ watch = true } = {}) {
  vi.resetModules()
  const connection = await import('../src/api/connection')
  const { send } = await import('../src/api/http')
  if (watch) stopWatching = connection.watchConnection()
  const changes: string[] = []
  connection.onConnectionChange((next) => changes.push(next))
  const call = (path: `/${string}`, timeoutMs?: number) => send(path, { timeoutMs }).catch(() => undefined)
  return { ...connection, call, changes }
}

/** 시계를 멈춘다. 요청은 흐른다. */
const stopClock = () => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

async function pass(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  // 확인 요청이 가짜 서버를 다녀올 만큼
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

describe('처음', () => {
  it('브라우저가 연결돼 있다고 하면 연결이 있다', async () => {
    const { connection } = await load()
    expect(connection()).toBe('online')
  })

  it('브라우저가 연결이 없다고 하면 연결이 없다', async () => {
    startOffline()
    const { connection } = await load()
    expect(connection()).toBe('offline')
  })
})

describe('브라우저의 신호', () => {
  it('offline 신호에 바로 없음, online 신호에 바로 있음이 되고 바뀔 때마다 알린다', async () => {
    const { connection, changes } = await load()
    goOffline()
    expect(connection()).toBe('offline')
    goOnline()
    expect(connection()).toBe('online')
    expect(changes).toEqual(['offline', 'online'])
  })

  it('지켜보기를 멈추면 신호를 받지 않는다', async () => {
    const { connection } = await load()
    stopWatching!()
    stopWatching = undefined
    goOffline()
    expect(connection()).toBe('online')
  })
})

describe('요청의 결과', () => {
  it('요청이 응답 없이 실패하면 곧바로 연결이 없다', async () => {
    const { connection, call, changes } = await load()
    await call('/unreachable')
    expect(connection()).toBe('offline')
    expect(changes).toEqual(['offline'])
  })

  it('X-Request-Id가 있는 응답을 받으면 상태 코드와 상관없이 연결이 있다', async () => {
    const { connection, call } = await load()
    await call('/unreachable')
    await call('/broken')
    expect(connection()).toBe('online')
  })

  it('X-Request-Id가 없는 응답(포털 페이지 등)으로는 연결이 있다고 보지 않는다', async () => {
    const { connection, call } = await load()
    await call('/unreachable')
    await call('/portal')
    expect(connection()).toBe('offline')
  })

  it('15초 안에 응답이 없는 지연은 연결 없음이 아니다(서버 오류 쪽)', async () => {
    const { connection, call } = await load()
    await call('/slow', 20)
    expect(connection()).toBe('online')
  })

  it('같은 상태가 이어지면 다시 알리지 않는다', async () => {
    const { call, changes } = await load()
    await call('/unreachable')
    await call('/unreachable')
    await call('/ok')
    await call('/ok')
    expect(changes).toEqual(['offline', 'online'])
  })
})

describe('연결이 돌아왔는지 확인하는 요청', () => {
  beforeEach(stopClock)

  it('신호는 켜져 있는데 요청이 실패해 없음이 되면 5, 10, 20초 간격 뒤 30초마다 HEAD /api/v1/을 보낸다', async () => {
    probeResponse = () => new HttpResponse('포털', { status: 200 })
    const { call } = await load()
    await call('/unreachable')
    let count = 0
    // 간격은 앞 확인의 답을 받은 때부터다
    for (const gap of [5_000, 10_000, 20_000, 30_000, 30_000]) {
      await pass(gap - 1)
      expect(probes).toBe(count)
      await pass(1)
      count += 1
      expect(probes).toBe(count)
    }
  })

  it('확인 요청이 X-Request-Id가 있는 응답을 받으면 연결이 있고 더 보내지 않는다', async () => {
    const { connection, call, changes } = await load()
    await call('/unreachable')
    await pass(5_000)
    expect(connection()).toBe('online')
    expect(changes).toEqual(['offline', 'online'])
    await pass(120_000)
    expect(probes).toBe(1)
  })

  it('확인 요청은 본문, 토큰, 쿠키 없이 캐시를 거치지 않고 다른 주소로 따라가지 않는다', async () => {
    const { call } = await load()
    await call('/unreachable')
    const spy = vi.spyOn(globalThis, 'fetch')
    await pass(5_000)
    expect(spy).toHaveBeenCalledTimes(1)
    const [address, init] = spy.mock.calls[0]
    expect(address).toBe('/api/v1/')
    expect(init).toMatchObject({ method: 'HEAD', cache: 'no-store', credentials: 'omit', redirect: 'error' })
    expect(init?.headers).toBeUndefined()
    expect(init?.body).toBeUndefined()
    spy.mockRestore()
  })

  it('브라우저가 연결이 없다고 하면 확인하지 않고 online 신호를 기다린다', async () => {
    const { call } = await load()
    await call('/unreachable')
    goOffline()
    await pass(120_000)
    expect(probes).toBe(0)
  })

  it('online 신호가 오면 확인을 멈춘다', async () => {
    probeResponse = () => new HttpResponse(null, { status: 502 })
    const { call } = await load()
    await call('/unreachable')
    await pass(5_000)
    goOnline()
    await pass(120_000)
    expect(probes).toBe(1)
  })

  it('화면이 다시 보이면 기다리지 않고 바로 확인한다', async () => {
    const { connection, call } = await load()
    await call('/unreachable')
    await pass(1_000)
    document.dispatchEvent(new Event('visibilitychange'))
    await pass(0)
    expect(probes).toBe(1)
    expect(connection()).toBe('online')
  })

  it('지켜보지 않는 동안(앱이 열리기 전 등)에는 확인하지 않는다', async () => {
    const { call } = await load({ watch: false })
    await call('/unreachable')
    await pass(120_000)
    expect(probes).toBe(0)
  })

  it('지켜보기를 멈추면 예약한 확인도 멈춘다', async () => {
    const { call } = await load()
    await call('/unreachable')
    stopWatching!()
    stopWatching = undefined
    await pass(120_000)
    expect(probes).toBe(0)
  })
})
