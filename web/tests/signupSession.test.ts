import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '../src/api/apiError'
import { accessTokenNamed, tokenNameIn } from './support/accessToken'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { createFakeLocks, createStuckLocks, installLocks, removeLocks, SESSION_LOCK } from './support/webLocks'

const server = startMockServer()

/** 탭 하나. 모듈을 새로 불러와 메모리를 다른 탭과 나누지 않는다. */
async function openTab() {
  vi.resetModules()
  const session = await import('../src/api/session')
  const { request } = await import('../src/api/request')
  return { ...session, request }
}

const account = { email: ' Name@Example.COM ', password: 'pass 1234', displayName: ' 이서연 ' }

/** 가입, 로그인, 갱신이 되는 가짜 서버. 토큰의 이름은 내준 길의 이름이다. 보호된 자원은 /api/v1/ledgers 하나다. */
function startBackend() {
  const requests = { signup: [] as Request[], refresh: 0, ledgers: [] as (string | null)[] }
  let inFlight = 0
  const backend = {
    requests,
    maxInFlight: 0,
    signupResponse: () => HttpResponse.json({ accessToken: accessTokenNamed('signup') }, { status: 201 }) as Response,
  }

  async function oneAtATime(respond: () => Response) {
    inFlight += 1
    backend.maxInFlight = Math.max(backend.maxInFlight, inFlight)
    // 겹친 요청이 있으면 드러나도록 잠시 쥔다. 시계를 멈춘 시험에서도 흐르게 setImmediate를 쓴다
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve))
    inFlight -= 1
    return respond()
  }

  server.use(
    http.post('/api/v1/auth/signup', ({ request }) => {
      requests.signup.push(request.clone())
      return oneAtATime(backend.signupResponse)
    }),
    http.post('/api/v1/auth/login', () => HttpResponse.json({ accessToken: accessTokenNamed('login') })),
    http.post('/api/v1/auth/refresh', () => {
      requests.refresh += 1
      return oneAtATime(() => HttpResponse.json({ accessToken: accessTokenNamed('refresh') }))
    }),
    http.get('/api/v1/ledgers', ({ request }) => {
      const authorization = request.headers.get('Authorization')
      requests.ledgers.push(tokenNameIn(authorization))
      return authorization ? HttpResponse.json({}) : problem(401, 'UNAUTHENTICATED')
    }),
  )
  return backend
}

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  return promise.then(
    () => {
      throw new Error('실패해야 하는 요청이 성공했다')
    },
    (error: ApiError) => error,
  )
}

function everythingIn(error: ApiError): string {
  return [String(error), error.stack, JSON.stringify(error, Object.getOwnPropertyNames(error)), String(error.cause)].join()
}

afterEach(() => {
  removeLocks()
  vi.restoreAllMocks()
})

describe('가입', () => {
  it('받은 값을 바꾸지 않고 본문으로 보내고 전용 헤더를 붙인다. access token은 보내지 않는다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    await tab.login({ email: 'other@example.com', password: 'other1234' })
    await tab.signup(account)
    const [request] = backend.requests.signup
    expect(await request.json()).toEqual({
      email: ' Name@Example.COM ',
      password: 'pass 1234',
      displayName: ' 이서연 ',
    })
    expect(request.headers.get('X-Akkimpyo-Client')).toBe('web')
    expect(request.headers.get('Content-Type')).toBe('application/json')
    expect(request.headers.has('Authorization')).toBe(false)
  })

  it('브라우저 캐시에 남기지 않고 다른 주소로 따라가지 않는다', async () => {
    startBackend()
    const tab = await openTab()
    const fetch = vi.spyOn(globalThis, 'fetch')
    await tab.signup(account)
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/auth/signup',
      expect.objectContaining({ cache: 'no-store', redirect: 'error' }),
    )
  })

  it('성공하면 로그인한 상태가 되어 다음 요청부터 받은 access token을 보낸다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    await tab.signup(account)
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['signup'])
    expect(await tab.restoreSession()).toBe(true)
    expect(backend.requests.refresh).toBe(0)
  })

  it('거부되면 갱신하지 않고 입력란의 오류를 담은 오류를 던진다. 로그인한 상태가 되지 않는다', async () => {
    const backend = startBackend()
    const fieldErrors = [{ field: 'email', code: 'DUPLICATE', message: '이미 있다' }]
    backend.signupResponse = () => problem(400, 'VALIDATION_FAILED', { fieldErrors })
    const tab = await openTab()
    const error = await errorOf(tab.signup(account))
    expect(error).toMatchObject({
      kind: 'rejected',
      status: 400,
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'email', code: 'DUPLICATE' }],
    })
    expect(backend.requests.refresh).toBe(0)
    expect(backend.requests.signup).toHaveLength(1)
    await errorOf(tab.request('/ledgers'))
    expect(backend.requests.ledgers).toEqual([null])
  })

  it.each([
    ['본문이 없음', null],
    ['필드가 없음', {}],
    ['헤더에 넣을 수 없는 글자', { accessToken: '줄바꿈 토큰' }],
  ])('응답에 access token이 없으면 서버 오류로 본다: %s', async (_, body) => {
    const backend = startBackend()
    backend.signupResponse = () => HttpResponse.json(body, { status: 201 })
    const tab = await openTab()
    const error = await errorOf(tab.signup(account))
    expect(error).toMatchObject({ name: 'ApiError', kind: 'server' })
    expect(everythingIn(error)).not.toContain('토큰')
  })

  it.each([
    ['거부', () => problem(400, 'VALIDATION_FAILED', { detail: 'pass 1234', fieldErrors: [] })],
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 오류', () => HttpResponse.error()],
  ])('%s의 오류, 저장소, console에 쓴 값이 남지 않는다', async (_, response) => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const consoleSpies = methods.map((method) => vi.spyOn(console, method))
    const backend = startBackend()
    backend.signupResponse = response
    const tab = await openTab()
    const error = await errorOf(tab.signup(account))
    expect(everythingIn(error)).not.toMatch(/pass 1234|Name@Example|이서연/)
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    // 로그인했음을 다른 화면이 아는, 뜻이 없는 임의 값 하나만 남는다
    expect({ ...localStorage }).toEqual({ 'akkimpyo-login': expect.stringMatching(/^[0-9a-f]{32}$/) })
    expect(sessionStorage.length).toBe(0)
  })
})

describe('탭 사이의 잠금', () => {
  it('가입은 다른 탭의 갱신과 겹치지 않는다', async () => {
    installLocks(createFakeLocks())
    const backend = startBackend()
    const [refreshing, signingUp] = [await openTab(), await openTab()]
    await Promise.all([refreshing.restoreSession(), signingUp.signup(account)])
    expect(backend.requests.refresh).toBe(1)
    expect(backend.requests.signup).toHaveLength(1)
    expect(backend.maxInFlight).toBe(1)
  })

  it('한 탭 안에서도 갱신이 끝난 뒤에 보내, 늦은 갱신이 가입한 로그인을 덮지 않는다', async () => {
    installLocks(createFakeLocks())
    const backend = startBackend()
    const tab = await openTab()
    await Promise.all([tab.restoreSession(), tab.signup(account)])
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['signup'])
  })

  describe('앞 탭이 멈춰 잠금을 15초 동안 얻지 못하면', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('로그인처럼 잠금을 빼앗아 한 번 보낸다', async () => {
      const stuck = createStuckLocks()
      installLocks(stuck)
      const frozenTabLost = errorOf(stuck.frozenTab)
      const backend = startBackend()
      const tab = await openTab()
      const signup = tab.signup(account)
      await vi.advanceTimersByTimeAsync(14_999)
      expect(backend.requests.signup).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      expect(await frozenTabLost).toMatchObject({ name: 'AbortError' })
      vi.useRealTimers()
      await signup
      expect(backend.requests.signup).toHaveLength(1)
      await tab.request('/ledgers')
      expect(backend.requests.ledgers).toEqual(['signup'])
    })
  })

  it('다른 탭이 잠금을 빼앗으면 지연 오류로 끝나고 늦게 온 성공은 버린다', async () => {
    const locks = createFakeLocks()
    installLocks(locks)
    const backend = startBackend()
    const tab = await openTab()
    // 요청을 중단해도 응답이 오는 경우까지 보려고, 중단 신호를 무시하는 fetch로 바꾼다
    const arrived = Promise.withResolvers<AbortSignal>()
    const answer = Promise.withResolvers<Response>()
    const realFetch = fetch
    vi.stubGlobal('fetch', (input: string, init: RequestInit) => {
      if (input !== '/api/v1/auth/signup') return realFetch(input, init)
      arrived.resolve(init.signal!)
      return answer.promise
    })
    try {
      const error = errorOf(tab.signup(account))
      const signal = await arrived.promise
      await locks.request(SESSION_LOCK, { steal: true }, async () => {})
      expect(await error).toMatchObject({ name: 'ApiError', kind: 'timeout' })
      expect(signal.aborted).toBe(true)
      answer.resolve(Response.json({ accessToken: accessTokenNamed('late') }, { status: 201 }))
      await new Promise((resolve) => setTimeout(resolve, 20))
      await errorOf(tab.request('/ledgers'))
      expect(backend.requests.ledgers).toEqual([null])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
