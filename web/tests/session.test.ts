import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '../src/api/apiError'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { createFakeLocks, createStuckLocks, installLocks, removeLocks } from './support/webLocks'

const server = startMockServer()

/** 탭 하나. 모듈을 새로 불러와 메모리를 다른 탭과 나누지 않는다. */
async function openTab() {
  vi.resetModules()
  const session = await import('../src/api/session')
  const { request } = await import('../src/api/request')
  return { ...session, request }
}

const credentials = { email: 'name@example.com', password: 'pass1234' }

/**
 * 로그인과 갱신이 되는 가짜 서버. 토큰은 내준 순서대로 token-1, token-2...이고 마지막에 내준 것만 유효하다.
 * 보호된 자원은 /api/v1/ledgers 하나다.
 */
function startBackend() {
  const requests: { refresh: Request[]; login: Request[]; ledgers: (string | null)[] } = {
    refresh: [],
    login: [],
    ledgers: [],
  }
  let issued = 0
  let valid: string | undefined
  let authInFlight = 0
  let maxAuthInFlight = 0

  function issue() {
    issued += 1
    valid = `token-${issued}`
    return HttpResponse.json({ accessToken: valid })
  }

  async function oneAtATime(respond: () => Response | Promise<Response>) {
    authInFlight += 1
    maxAuthInFlight = Math.max(maxAuthInFlight, authInFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    try {
      return await respond()
    } finally {
      authInFlight -= 1
    }
  }

  const backend = {
    requests,
    /** 갱신 요청에 줄 응답. 없으면 새 토큰을 준다. */
    refreshResponse: undefined as (() => Response | Promise<Response>) | undefined,
    expireToken() {
      valid = undefined
    },
    maxAuthInFlight: () => maxAuthInFlight,
  }

  server.use(
    http.post('/api/v1/auth/login', ({ request }) => {
      requests.login.push(request.clone())
      return oneAtATime(issue)
    }),
    http.post('/api/v1/auth/refresh', ({ request }) => {
      requests.refresh.push(request.clone())
      return oneAtATime(backend.refreshResponse ?? issue)
    }),
    http.all('/api/v1/ledgers', async ({ request }) => {
      const authorization = request.headers.get('Authorization')
      requests.ledgers.push(authorization)
      if (valid === undefined || authorization !== `Bearer ${valid}`) return problem(401, 'UNAUTHENTICATED')
      return HttpResponse.json({ method: request.method, body: await request.text() })
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

/** 다음 /ledgers 요청 하나의 응답을 `with`를 부를 때까지 미룬다. */
function delayNextLedgersResponse() {
  const arrived = Promise.withResolvers<void>()
  const answer = Promise.withResolvers<Response>()
  server.use(
    http.get(
      '/api/v1/ledgers',
      () => {
        arrived.resolve()
        return answer.promise
      },
      { once: true },
    ),
  )
  return { arrived: arrived.promise, with: answer.resolve }
}

/** 로그인한 탭. 서버가 access token을 만료시킨 상태로 시작한다. */
async function openTabWithExpiredToken() {
  const backend = startBackend()
  const tab = await openTab()
  await tab.login(credentials)
  backend.expireToken()
  return { backend, tab }
}

afterEach(removeLocks)

describe('로그인', () => {
  it('이메일과 비밀번호를 본문으로 보내고 전용 헤더를 붙인다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    await tab.login(credentials)
    const [request] = backend.requests.login
    expect(await request.json()).toEqual({ email: 'name@example.com', password: 'pass1234' })
    expect(request.headers.get('X-Akkimpyo-Client')).toBe('web')
    expect(request.headers.has('Authorization')).toBe(false)
  })

  it('로그인하면 다음 요청부터 access token을 보낸다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    await tab.login(credentials)
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['Bearer token-1'])
  })

  it('거부되면 갱신하지 않고 오류를 그대로 던진다', async () => {
    const backend = startBackend()
    server.use(http.post('/api/v1/auth/login', () => problem(401, 'INVALID_CREDENTIALS')))
    const tab = await openTab()
    const error = await errorOf(tab.login(credentials))
    expect(error).toMatchObject({ kind: 'rejected', status: 401, code: 'INVALID_CREDENTIALS' })
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it.each([
    ['본문이 없음', null],
    ['필드가 없음', {}],
    ['빈 글자', { accessToken: '' }],
    ['글자가 아님', { accessToken: 1 }],
    ['헤더에 넣을 수 없는 글자', { accessToken: '줄바꿈\n토큰' }],
  ])('응답에 access token이 없으면 서버 오류로 보고 본문을 오류에 남기지 않는다: %s', async (_, body) => {
    server.use(http.post('/api/v1/auth/login', () => HttpResponse.json(body)))
    const tab = await openTab()
    const error = await errorOf(tab.login(credentials))
    expect(error).toMatchObject({ name: 'ApiError', kind: 'server' })
    expect(everythingIn(error)).not.toContain('토큰')
  })
})

describe('access token이 머무는 곳', () => {
  it('로그인하고 갱신해도 저장소, 쿠키, 주소, 방문 기록, console에 남지 않는다', async () => {
    const openDatabase = vi.fn()
    vi.stubGlobal('indexedDB', { open: openDatabase })
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const consoleSpies = methods.map((method) => vi.spyOn(console, method))

    const { backend, tab } = await openTabWithExpiredToken()
    await tab.request('/ledgers')
    backend.expireToken()
    backend.refreshResponse = () => problem(500, 'INTERNAL_ERROR')
    await errorOf(tab.request('/ledgers'))

    expect(backend.requests.ledgers).toContain('Bearer token-2')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(openDatabase).not.toHaveBeenCalled()
    expect(document.cookie).toBe('')
    expect(window.location.href).not.toContain('token-')
    expect(JSON.stringify(window.history.state)).not.toContain('token-')
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })

  it('오류에 access token과 비밀번호가 남지 않는다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const errors: ApiError[] = []
    server.use(http.post('/api/v1/auth/login', () => HttpResponse.error(), { once: true }))
    errors.push(await errorOf(tab.login(credentials)))
    for (const response of [
      () => problem(401, 'UNAUTHENTICATED'),
      () => problem(500, 'INTERNAL_ERROR'),
      () => HttpResponse.error(),
      () => new HttpResponse('{"accessToken":"token-9'),
    ]) {
      backend.refreshResponse = undefined
      await tab.login(credentials)
      backend.expireToken()
      backend.refreshResponse = response
      errors.push(await errorOf(tab.request('/ledgers')))
    }
    expect(errors).toHaveLength(5)
    for (const error of errors) {
      expect(everythingIn(error)).not.toMatch(/token-\d/)
      expect(everythingIn(error)).not.toContain('pass1234')
    }
  })
})

describe('401과 갱신', () => {
  it('access token이 만료되면 갱신을 한 번 하고 원래 요청을 그대로 다시 보낸다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const result = await tab.request('/ledgers', { method: 'POST', body: { name: '내 가계부' } })
    expect(result).toEqual({ method: 'POST', body: '{"name":"내 가계부"}' })
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.ledgers).toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  it('갱신 요청은 쿠키로 인증한다. 전용 헤더를 붙이고 본문과 access token은 보내지 않는다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    await tab.request('/ledgers')
    const [refresh] = backend.requests.refresh
    expect(refresh.headers.get('X-Akkimpyo-Client')).toBe('web')
    expect(refresh.headers.has('Authorization')).toBe(false)
    expect(refresh.credentials).toBe('same-origin')
    expect(await refresh.text()).toBe('')
  })

  it('다시 보낸 요청이 또 401이면 더 갱신하지 않는다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    server.use(http.get('/api/v1/ledgers', () => problem(401, 'UNAUTHENTICATED')))
    const error = await errorOf(tab.request('/ledgers'))
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it.each([
    [401, 'INVALID_CREDENTIALS'],
    [401, 'SOMETHING_NEW'],
    [403, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [500, 'INTERNAL_ERROR'],
  ])('%d %s에는 갱신하지 않는다', async (status, code) => {
    const { backend, tab } = await openTabWithExpiredToken()
    server.use(http.get('/api/v1/ledgers', () => problem(status, code)))
    expect(await errorOf(tab.request('/ledgers'))).toMatchObject({ status, code })
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it('본문을 읽을 수 없는 401에는 갱신하지 않는다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    server.use(http.get('/api/v1/ledgers', () => new HttpResponse('<html>', { status: 401 })))
    expect(await errorOf(tab.request('/ledgers'))).toMatchObject({ status: 401 })
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it('여러 요청이 동시에 401이어도 갱신은 한 번이다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    await Promise.all([tab.request('/ledgers'), tab.request('/ledgers'), tab.request('/ledgers')])
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.ledgers.filter((token) => token === 'Bearer token-2')).toHaveLength(3)
  })

  it('갱신이 끝난 뒤에 늦게 온 401에는 다시 갱신하지 않고 새 토큰으로 보낸다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const answerLate = delayNextLedgersResponse()
    const late = tab.request('/ledgers')
    await answerLate.arrived
    await tab.request('/ledgers')
    answerLate.with(problem(401, 'UNAUTHENTICATED'))
    await late
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.ledgers.at(-1)).toBe('Bearer token-2')
  })

  it('토큰이 다시 만료되면 다시 갱신한다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    await tab.request('/ledgers')
    backend.expireToken()
    await tab.request('/ledgers')
    expect(backend.requests.refresh).toHaveLength(2)
    expect(backend.requests.ledgers.at(-1)).toBe('Bearer token-3')
  })
})

describe('로그인 풀림', () => {
  it.each([
    ['UNAUTHENTICATED', () => problem(401, 'UNAUTHENTICATED')],
    ['읽을 수 없는 본문', () => new HttpResponse('<html>', { status: 401 })],
  ])('갱신 요청이 401이면 알리고 원래 요청의 오류를 던진다: %s', async (_, response) => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.refreshResponse = response
    const error = await errorOf(tab.request('/ledgers'))
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(ended).toHaveBeenCalledTimes(1)
    expect(backend.requests.ledgers).toEqual(['Bearer token-1'])
  })

  it('여러 요청이 함께 풀려도 한 번만 알린다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    await Promise.allSettled([tab.request('/ledgers'), tab.request('/ledgers')])
    expect(ended).toHaveBeenCalledTimes(1)
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('풀린 뒤에는 쓰던 access token을 보내지 않는다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    await errorOf(tab.request('/ledgers'))
    await errorOf(tab.request('/ledgers'))
    expect(backend.requests.ledgers).toEqual(['Bearer token-1', null])
  })

  it('다시 로그인하면 이어서 쓴다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    await errorOf(tab.request('/ledgers'))
    await tab.login(credentials)
    await tab.request('/ledgers')
    expect(backend.requests.ledgers.at(-1)).toBe('Bearer token-2')
  })

  it('알림을 끊으면 더 알리지 않는다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    const stop = tab.onSessionEnded(ended)
    stop()
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    await errorOf(tab.request('/ledgers'))
    expect(ended).not.toHaveBeenCalled()
  })

  it.each([
    ['연결 오류', () => HttpResponse.error(), { kind: 'connection' }],
    ['500', () => problem(500, 'INTERNAL_ERROR'), { kind: 'server', status: 500 }],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 }), { kind: 'server', status: 502 }],
    ['403', () => problem(403, 'ORIGIN_NOT_ALLOWED'), { kind: 'rejected', status: 403 }],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS'), { kind: 'rejected', status: 429 }],
    ['약속과 다른 200', () => HttpResponse.json({}), { kind: 'server' }],
  ])('갱신이 %s로 실패하면 로그인 풀림이 아니다. 갱신의 오류를 던지고 다음 요청에서 다시 갱신한다', async (_, response, expected) => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.refreshResponse = response
    expect(await errorOf(tab.request('/ledgers'))).toMatchObject(expected)
    expect(ended).not.toHaveBeenCalled()

    backend.refreshResponse = undefined
    await tab.request('/ledgers')
    expect(backend.requests.ledgers.at(-1)).toBe('Bearer token-2')
  })
})

describe('새로고침한 뒤 로그인 상태 되찾기', () => {
  it('갱신에 성공하면 로그인한 것이고 다음 요청부터 access token을 보낸다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    expect(await tab.restoreSession()).toBe(true)
    await tab.request('/ledgers')
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.ledgers).toEqual(['Bearer token-1'])
  })

  it('갱신이 401이면 로그인하지 않은 것이다. 이 탭에서 로그인이 풀린 것은 아니므로 알리지 않는다', async () => {
    const backend = startBackend()
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    const tab = await openTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    expect(await tab.restoreSession()).toBe(false)
    expect(ended).not.toHaveBeenCalled()
  })

  it.each([
    ['연결 오류', () => HttpResponse.error(), 'connection'],
    ['서버 오류', () => problem(503, 'INTERNAL_ERROR'), 'server'],
  ])('%s이면 로그인했는지 알 수 없으므로 오류를 던지고 다시 부를 수 있다', async (_, response, kind) => {
    const backend = startBackend()
    backend.refreshResponse = response
    const tab = await openTab()
    expect(await errorOf(tab.restoreSession())).toMatchObject({ kind })
    backend.refreshResponse = undefined
    expect(await tab.restoreSession()).toBe(true)
  })

  it('되찾는 동안 보낸 요청과 갱신을 한 번으로 묶는다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    await Promise.all([tab.restoreSession(), tab.request('/ledgers')])
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('이미 로그인했으면 갱신하지 않는다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    await tab.login(credentials)
    expect(await tab.restoreSession()).toBe(true)
    expect(backend.requests.refresh).toHaveLength(0)
  })
})

describe('탭 사이의 잠금', () => {
  beforeEach(() => installLocks(createFakeLocks()))

  it('탭 여러 개가 함께 갱신해도 갱신 요청은 한 번에 하나이고 탭마다 새 토큰을 받는다', async () => {
    const backend = startBackend()
    const tabs = [await openTab(), await openTab(), await openTab()]
    expect(await Promise.all(tabs.map((tab) => tab.restoreSession()))).toEqual([true, true, true])
    expect(backend.requests.refresh).toHaveLength(3)
    expect(backend.maxAuthInFlight()).toBe(1)
  })

  it('한 탭의 로그인은 다른 탭의 갱신과 겹치지 않는다', async () => {
    const backend = startBackend()
    const [refreshing, signingIn] = [await openTab(), await openTab()]
    await Promise.all([refreshing.restoreSession(), signingIn.login(credentials)])
    expect(backend.maxAuthInFlight()).toBe(1)
  })

  it('한 탭 안에서도 갱신이 끝난 뒤에 로그인을 보내, 늦은 갱신이 새 로그인을 덮지 않는다', async () => {
    const backend = startBackend()
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    const tab = await openTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    await Promise.all([tab.restoreSession(), tab.login(credentials)])
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['Bearer token-1'])
    expect(ended).not.toHaveBeenCalled()
  })

  it('잠금을 기다리는 동안 이 탭의 토큰이 바뀌었으면 갱신하지 않는다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    const login = tab.login(credentials)
    const restored = tab.restoreSession()
    await login
    expect(await restored).toBe(true)
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it('이미 새 토큰이 있으면 다른 탭의 잠금을 기다리지 않고 다시 보낸다', async () => {
    const locks = createFakeLocks()
    installLocks(locks)
    const { tab } = await openTabWithExpiredToken()
    const answerLate = delayNextLedgersResponse()
    const late = tab.request('/ledgers')
    await answerLate.arrived
    await tab.request('/ledgers')
    void locks.request('akkimpyo-session', { signal: new AbortController().signal }, () => new Promise(() => {}))
    answerLate.with(problem(401, 'UNAUTHENTICATED'))
    expect(await late).toMatchObject({ method: 'GET' })
  })

  it('잠금을 얻은 뒤 요청이 지연되면 지연 오류이고 다시 보내지 않는다', async () => {
    const backend = startBackend()
    backend.refreshResponse = () => new Promise(() => {})
    const tab = await openTab()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const error = errorOf(tab.restoreSession())
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await error).toMatchObject({ kind: 'timeout' })
      expect(backend.requests.refresh).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('갱신이 실패해도 잠금을 놓는다', async () => {
    const backend = startBackend()
    backend.refreshResponse = () => problem(500, 'INTERNAL_ERROR')
    const [first, second] = [await openTab(), await openTab()]
    await errorOf(first.restoreSession())
    backend.refreshResponse = undefined
    expect(await second.restoreSession()).toBe(true)
  })

  it('앞 탭이 멈춰 잠금을 15초 동안 얻지 못하면 잠금 없이 갱신한다', async () => {
    installLocks(createStuckLocks())
    const backend = startBackend()
    const tab = await openTab()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const restored = tab.restoreSession()
      await vi.advanceTimersByTimeAsync(14_999)
      expect(backend.requests.refresh).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      await vi.advanceTimersByTimeAsync(5)
      expect(await restored).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

function everythingIn(error: ApiError): string {
  return [String(error), error.stack, JSON.stringify(error, Object.getOwnPropertyNames(error)), String(error.cause)].join()
}
