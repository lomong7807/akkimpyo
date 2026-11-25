import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '../src/api/apiError'
import { accessTokenNamed, tokenNameIn } from './support/accessToken'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { watchAppTimers } from './support/timers'
import { createFakeLocks, createStuckLocks, installLocks, removeLocks, SESSION_LOCK } from './support/webLocks'

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
 * 로그인과 갱신이 되는 가짜 서버. 토큰의 이름은 내준 순서대로 token-1, token-2...이고 마지막에 내준 것만 유효하다.
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
    valid = backend.makeToken(`token-${issued}`)
    return HttpResponse.json({ accessToken: valid })
  }

  async function oneAtATime(respond: () => Response | Promise<Response>) {
    authInFlight += 1
    maxAuthInFlight = Math.max(maxAuthInFlight, authInFlight)
    // 겹친 요청이 있으면 드러나도록 잠시 쥔다. 시계를 멈춘 시험에서도 흐르게 setImmediate를 쓴다
    for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve))
    try {
      return await respond()
    } finally {
      authInFlight -= 1
    }
  }

  const backend = {
    requests,
    makeToken: (name: string) => accessTokenNamed(name),
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
      requests.ledgers.push(tokenNameIn(authorization))
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

afterEach(() => {
  removeLocks()
  vi.restoreAllMocks()
})

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
    expect(backend.requests.ledgers).toEqual(['token-1'])
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

    expect(backend.requests.ledgers).toContain('token-2')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(openDatabase).not.toHaveBeenCalled()
    expect(document.cookie).toBe('')
    expect(window.location.href).not.toMatch(/token-|eyJ/)
    expect(JSON.stringify(window.history.state)).not.toMatch(/token-|eyJ/)
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
      expect(everythingIn(error)).not.toMatch(/token-\d|eyJ/)
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
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
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
    expect(backend.requests.ledgers.filter((token) => token === 'token-2')).toHaveLength(3)
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
    expect(backend.requests.ledgers.at(-1)).toBe('token-2')
  })

  it('토큰이 다시 만료되면 다시 갱신한다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    await tab.request('/ledgers')
    backend.expireToken()
    await tab.request('/ledgers')
    expect(backend.requests.refresh).toHaveLength(2)
    expect(backend.requests.ledgers.at(-1)).toBe('token-3')
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
    expect(backend.requests.ledgers).toEqual(['token-1'])
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
    expect(backend.requests.ledgers).toEqual(['token-1', null])
  })

  it('다시 로그인하면 이어서 쓴다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    await errorOf(tab.request('/ledgers'))
    await tab.login(credentials)
    await tab.request('/ledgers')
    expect(backend.requests.ledgers.at(-1)).toBe('token-2')
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
    expect(backend.requests.ledgers.at(-1)).toBe('token-2')
  })
})

describe('갱신한 토큰의 사용자가 다를 때', () => {
  const otherUser = (name: string) => accessTokenNamed(name, { sub: 'user-2' })
  const otherLogin = { email: 'other@example.com', password: 'other1234' }

  it('원래 요청을 다시 보내지 않고 새 토큰을 두지 않으며 이 탭의 로그인을 끝낸다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.makeToken = otherUser
    const error = await errorOf(tab.request('/ledgers', { method: 'POST', body: { name: '앞 사람의 내용' } }))
    expect(error).toMatchObject({ kind: 'rejected', status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.ledgers).toEqual(['token-1'])
    expect(ended).toHaveBeenCalledTimes(1)

    await errorOf(tab.request('/ledgers'))
    expect(backend.requests.ledgers).toEqual(['token-1', null])
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('동시에 401을 받은 요청을 하나도 다시 보내지 않고 한 번만 알린다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.makeToken = otherUser
    const errors = await Promise.all([1, 2, 3].map(() => errorOf(tab.request('/ledgers'))))
    for (const error of errors) expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-1', 'token-1'])
    expect(backend.requests.refresh).toHaveLength(1)
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('잠금을 기다리는 동안 이 탭에서 다른 계정으로 로그인했으면, 앞 계정의 요청만 끝내고 로그인은 남긴다', async () => {
    const locks = createFakeLocks()
    installLocks(locks)
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const otherTab = Promise.withResolvers<void>()
    void locks.request(SESSION_LOCK, {}, () => otherTab.promise)
    backend.makeToken = otherUser
    const login = tab.login(otherLogin)
    const error = errorOf(tab.request('/ledgers'))
    await vi.waitFor(() => expect(backend.requests.ledgers).toEqual(['token-1']))
    otherTab.resolve()
    await login
    expect(await error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.refresh).toHaveLength(0)
    expect(ended).not.toHaveBeenCalled()
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
  })

  it('늦게 온 401 앞에 다른 계정으로 로그인했으면, 앞 계정의 요청만 끝내고 로그인은 남긴다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const answerLate = delayNextLedgersResponse()
    const late = errorOf(tab.request('/ledgers'))
    await answerLate.arrived
    backend.makeToken = otherUser
    await tab.login(otherLogin)
    answerLate.with(problem(401, 'UNAUTHENTICATED'))
    expect(await late).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(ended).not.toHaveBeenCalled()
    expect(backend.requests.ledgers).toEqual([])
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-2'])
  })

  it('갱신하는 동안 다른 계정으로 로그인했으면, 늦은 갱신을 버리고 앞 계정의 요청만 끝낸다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const answer = Promise.withResolvers<Response>()
    backend.refreshResponse = () => answer.promise
    const error = errorOf(tab.request('/ledgers'))
    await vi.waitFor(() => expect(backend.requests.refresh).toHaveLength(1))
    backend.makeToken = otherUser
    await tab.login(otherLogin)
    answer.resolve(HttpResponse.json({ accessToken: accessTokenNamed('late-token') }))
    expect(await error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(ended).not.toHaveBeenCalled()
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
  })

  it('같은 사용자면 한 번 다시 보낸다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    backend.makeToken = (name) => accessTokenNamed(name, { sub: 'user-1', iat: 1 })
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
  })

  it.each([
    ['base64url의 - 와 _ 가 든 값', '>>>???~~~'],
    ['한글', '사용자'],
  ])('사용자를 %s로 적어도 같은 사용자로 읽는다', async (_, sub) => {
    const backend = startBackend()
    backend.makeToken = (name) => accessTokenNamed(name, { sub })
    const tab = await openTab()
    await tab.login(credentials)
    backend.expireToken()
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
  })

  const unreadable: [string, (name: string) => string][] = [
    ['JWT가 아님', (name) => name],
    ['마디가 넷', (name) => `a.eyJzdWIiOiJ1c2VyLTEifQ.b.${name}`],
    ['base64가 아님', (name) => `a.~~~.${name}`],
    ['JSON이 아님', (name) => `a.bm90LWpzb24.${name}`],
    ['null', (name) => `a.bnVsbA.${name}`],
    ['sub가 없음', (name) => accessTokenNamed(name, {})],
    ['sub가 글자가 아님', (name) => accessTokenNamed(name, { sub: 1 })],
    ['sub가 빈 글자', (name) => accessTokenNamed(name, { sub: '' })],
  ]

  it.each(unreadable)('새 토큰의 사용자를 읽지 못하면 다른 사용자로 본다: %s', async (_, makeToken) => {
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.makeToken = makeToken
    expect(await errorOf(tab.request('/ledgers'))).toMatchObject({ status: 401 })
    expect(backend.requests.ledgers).toEqual(['token-1'])
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it.each(unreadable)('앞 토큰의 사용자를 읽지 못하면 다른 사용자로 본다: %s', async (_, makeToken) => {
    const backend = startBackend()
    backend.makeToken = makeToken
    const tab = await openTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    await tab.login(credentials)
    backend.expireToken()
    expect(await errorOf(tab.request('/ledgers'))).toMatchObject({ status: 401 })
    expect(backend.requests.ledgers).toEqual(['token-1'])
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('오류와 console에 토큰과 사용자가 남지 않는다', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const consoleSpies = methods.map((method) => vi.spyOn(console, method))
    const { backend, tab } = await openTabWithExpiredToken()
    backend.makeToken = otherUser
    const error = await errorOf(tab.request('/ledgers'))
    expect(everythingIn(error)).not.toMatch(/token-\d|eyJ|user-\d/)
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('토큰 없이 보낸 요청', () => {
  it('누구의 요청인지 알 수 없으므로 401이어도 갱신하지 않고 다시 보내지 않는다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    expect(await errorOf(tab.request('/ledgers'))).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.refresh).toHaveLength(0)
    expect(backend.requests.ledgers).toEqual([null])
    expect(ended).not.toHaveBeenCalled()
  })
})

describe('새로고침한 뒤 로그인 상태 되찾기', () => {
  it('갱신에 성공하면 로그인한 것이고 다음 요청부터 access token을 보낸다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    expect(await tab.restoreSession()).toBe(true)
    await tab.request('/ledgers')
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.ledgers).toEqual(['token-1'])
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

  it('함께 불러도 갱신은 한 번이다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    expect(await Promise.all([tab.restoreSession(), tab.restoreSession()])).toEqual([true, true])
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('되찾는 동안 토큰 없이 보낸 요청은 401로 끝나고, 되찾은 로그인은 남는다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    const [restored, error] = await Promise.all([tab.restoreSession(), errorOf(tab.request('/ledgers'))])
    expect(restored).toBe(true)
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.refresh).toHaveLength(1)
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual([null, 'token-1'])
  })

  it('앞 토큰이 없으므로 사용자를 비교하지 않는다', async () => {
    const backend = startBackend()
    backend.makeToken = (name) => `unreadable.${name}`
    const tab = await openTab()
    expect(await tab.restoreSession()).toBe(true)
    backend.requests.ledgers.length = 0
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1'])
  })

  it('이미 로그인했으면 갱신하지 않는다', async () => {
    const backend = startBackend()
    const tab = await openTab()
    await tab.login(credentials)
    expect(await tab.restoreSession()).toBe(true)
    expect(backend.requests.refresh).toHaveLength(0)
  })
})

describe('잠금 없이 갱신과 로그인이 겹칠 때', () => {
  /** 갱신의 응답을 `answer`로 미룬 채 이 탭에서 로그인에 성공한다. Web Locks는 없다. */
  async function loginDuringRefresh(refreshResponse: Response) {
    const backend = startBackend()
    const answer = Promise.withResolvers<Response>()
    backend.refreshResponse = () => answer.promise
    const tab = await openTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const restored = tab.restoreSession()
    await vi.waitFor(() => expect(backend.requests.refresh).toHaveLength(1))
    await tab.login(credentials)
    backend.refreshResponse = undefined
    answer.resolve(refreshResponse)
    return { backend, tab, ended, restored: await restored }
  }

  it('늦게 온 갱신의 401이 방금 한 로그인을 지우지 않는다', async () => {
    const { backend, tab, ended, restored } = await loginDuringRefresh(problem(401, 'UNAUTHENTICATED'))
    expect(restored).toBe(true)
    expect(ended).not.toHaveBeenCalled()
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1'])
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('늦게 온 갱신의 토큰이 방금 한 로그인을 덮지 않는다', async () => {
    const { backend, tab, restored } = await loginDuringRefresh(HttpResponse.json({ accessToken: accessTokenNamed('late-token') }))
    expect(restored).toBe(true)
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1'])
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('쓰던 토큰이 만료돼 갱신하는 동안 다시 로그인해도, 늦은 401이 새 로그인을 풀지 않고 기다리던 요청은 새 토큰으로 보낸다', async () => {
    const { backend, tab } = await openTabWithExpiredToken()
    const answer = Promise.withResolvers<Response>()
    backend.refreshResponse = () => answer.promise
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const waiting = tab.request('/ledgers')
    await vi.waitFor(() => expect(backend.requests.refresh).toHaveLength(1))
    await tab.login(credentials)
    answer.resolve(problem(401, 'UNAUTHENTICATED'))
    await waiting
    expect(ended).not.toHaveBeenCalled()
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
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
    expect(backend.requests.ledgers).toEqual(['token-1'])
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
    void locks.request(SESSION_LOCK, {}, () => new Promise(() => {}))
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

  it.each([
    ['얻은 뒤', () => createFakeLocks()],
    ['막혔을 때', () => ({ request: () => Promise.reject(new DOMException('막힘', 'SecurityError')) })],
  ])('잠금을 %s에는 기다리던 시계를 남기지 않는다', async (_, locks) => {
    installLocks(locks())
    startBackend()
    const tab = await openTab()
    const running = watchAppTimers()
    const restored = tab.restoreSession()
    await vi.waitFor(() => expect(running()).toBeGreaterThan(0))
    expect(await restored).toBe(true)
    expect(running()).toBe(0)
  })

  it('갱신이 실패해도 잠금을 놓는다', async () => {
    const backend = startBackend()
    backend.refreshResponse = () => problem(500, 'INTERNAL_ERROR')
    const [first, second] = [await openTab(), await openTab()]
    await errorOf(first.restoreSession())
    backend.refreshResponse = undefined
    expect(await second.restoreSession()).toBe(true)
  })

  it('브라우저가 잠금을 막으면 갱신도 잠금 없이 보낸다', async () => {
    installLocks({ request: () => Promise.reject(new DOMException('막힘', 'SecurityError')) })
    const backend = startBackend()
    const tab = await openTab()
    expect(await tab.restoreSession()).toBe(true)
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('브라우저가 잠금을 막으면 로그인도 잠금 없이 보낸다', async () => {
    installLocks({ request: () => Promise.reject(new DOMException('막힘', 'SecurityError')) })
    const backend = startBackend()
    const tab = await openTab()
    await tab.login(credentials)
    expect(backend.requests.login).toHaveLength(1)
  })
})

describe('앞 탭이 멈춰 잠금을 15초 동안 얻지 못하면', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('갱신은 보내지 않고 지연 오류로 끝낸다', async () => {
    installLocks(createStuckLocks())
    const backend = startBackend()
    const tab = await openTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    let settled = false
    const error = errorOf(tab.restoreSession()).finally(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await error).toMatchObject({ name: 'ApiError', kind: 'timeout' })
    expect(backend.requests.refresh).toHaveLength(0)
    expect(ended).not.toHaveBeenCalled()
  })

  it('갱신을 기다리던 요청도 지연 오류다. 로그인 풀림이 아니고 이 탭의 토큰이 남아 다음에 다시 갱신한다', async () => {
    vi.useRealTimers()
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const stuck = createStuckLocks()
    installLocks(stuck)
    const errors = Promise.all([errorOf(tab.request('/ledgers')), errorOf(tab.request('/ledgers'))])
    await stuck.requested
    await vi.advanceTimersByTimeAsync(15_000)
    for (const error of await errors) expect(error).toMatchObject({ kind: 'timeout' })
    expect(backend.requests.refresh).toHaveLength(0)
    expect(ended).not.toHaveBeenCalled()

    vi.useRealTimers()
    installLocks(createFakeLocks())
    backend.requests.ledgers.length = 0
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
  })

  it('로그인은 잠금을 빼앗아 보내고, 그 뒤의 갱신은 정상으로 잠금을 얻는다', async () => {
    const stuck = createStuckLocks()
    installLocks(stuck)
    const frozenTabLost = errorOf(stuck.frozenTab)
    const backend = startBackend()
    const tab = await openTab()
    const login = tab.login(credentials)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(backend.requests.login).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(await frozenTabLost).toMatchObject({ name: 'AbortError' })
    vi.useRealTimers()
    await login
    expect(backend.requests.login).toHaveLength(1)

    backend.expireToken()
    await tab.request('/ledgers')
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
  })

  it('빼앗아 보낸 로그인이 거부되면 다시 보내지 않고 그 오류를 던진다', async () => {
    installLocks(createStuckLocks())
    const bodies: unknown[] = []
    server.use(
      http.post('/api/v1/auth/login', async ({ request }) => {
        bodies.push(await request.json())
        return problem(401, 'INVALID_CREDENTIALS')
      }),
    )
    const tab = await openTab()
    const error = errorOf(tab.login(credentials))
    await vi.advanceTimersByTimeAsync(15_000)
    vi.useRealTimers()
    expect(await error).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' })
    expect(bodies).toHaveLength(1)
  })
})

describe('다른 탭이 잠금을 빼앗으면', () => {
  /** 요청을 중단해도 응답이 오는 경우까지 보려고, 중단 신호를 무시하는 fetch로 바꾼다. */
  function answerRegardlessOfAbort(path: string) {
    const arrived = Promise.withResolvers<AbortSignal>()
    const answer = Promise.withResolvers<Response>()
    const realFetch = fetch
    vi.stubGlobal('fetch', (input: string, init: RequestInit) => {
      if (input !== `/api/v1${path}`) return realFetch(input, init)
      arrived.resolve(init.signal!)
      return answer.promise
    })
    return { arrived: arrived.promise, with: answer.resolve }
  }

  async function steal(locks: Pick<ReturnType<typeof createFakeLocks>, 'request'>) {
    await locks.request(SESSION_LOCK, { steal: true }, async () => {})
  }

  const unauthenticated = () => new Response('{"code":"UNAUTHENTICATED"}', { status: 401 })
  const lateToken = () => Response.json({ accessToken: accessTokenNamed('late-token') })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['성공', lateToken],
    ['401', unauthenticated],
  ])('갱신은 지연 오류로 끝나고 늦게 온 %s은 버린다. 로그인 풀림이 아니다', async (_, late) => {
    const locks = createFakeLocks()
    installLocks(locks)
    const { backend, tab } = await openTabWithExpiredToken()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const answer = answerRegardlessOfAbort('/auth/refresh')
    const error = errorOf(tab.request('/ledgers'))
    const signal = await answer.arrived
    await steal(locks)
    expect(await error).toMatchObject({ name: 'ApiError', kind: 'timeout' })
    expect(everythingIn(await error)).not.toContain('AbortError')
    expect(signal.aborted).toBe(true)

    answer.with(late())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ended).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
    backend.requests.ledgers.length = 0
    await tab.request('/ledgers')
    expect(backend.requests.ledgers).toEqual(['token-1', 'token-2'])
  })

  it('로그인도 지연 오류로 끝나고 늦게 온 성공은 버린다', async () => {
    const locks = createFakeLocks()
    installLocks(locks)
    const backend = startBackend()
    const tab = await openTab()
    const answer = answerRegardlessOfAbort('/auth/login')
    const error = errorOf(tab.login(credentials))
    const signal = await answer.arrived
    await steal(locks)
    expect(await error).toMatchObject({ name: 'ApiError', kind: 'timeout' })
    expect(signal.aborted).toBe(true)

    answer.with(lateToken())
    await new Promise((resolve) => setTimeout(resolve, 20))
    await errorOf(tab.request('/ledgers'))
    expect(backend.requests.ledgers).toEqual([null])
  })

  it('빼앗아 얻은 잠금을 다시 빼앗겨도 지연 오류로 끝난다', async () => {
    const locks = createStuckLocks()
    installLocks(locks)
    startBackend()
    const tab = await openTab()
    const answer = answerRegardlessOfAbort('/auth/login')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const error = errorOf(tab.login(credentials))
    await vi.advanceTimersByTimeAsync(15_000)
    vi.useRealTimers()
    await answer.arrived
    await steal(locks)
    expect(await error).toMatchObject({ name: 'ApiError', kind: 'timeout' })
  })

  it('되찾기도 지연 오류다. 로그인이 필요하다는 뜻이 아니다', async () => {
    const locks = createFakeLocks()
    installLocks(locks)
    startBackend()
    const tab = await openTab()
    const answer = answerRegardlessOfAbort('/auth/refresh')
    const error = errorOf(tab.restoreSession())
    await answer.arrived
    await steal(locks)
    expect(await error).toMatchObject({ kind: 'timeout' })
    answer.with(unauthenticated())
  })
})

function everythingIn(error: ApiError): string {
  return [String(error), error.stack, JSON.stringify(error, Object.getOwnPropertyNames(error)), String(error.cause)].join()
}
