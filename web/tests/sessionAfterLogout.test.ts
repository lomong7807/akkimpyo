import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessTokenNamed } from './support/accessToken'
import { delayed, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import {
  answerRegardlessOfAbort,
  credentials,
  errorOf,
  openSignedInTab,
  openTab,
  pass,
  settle,
  stopClock,
  type Tab,
} from './support/sessionTab'
import { createFakeLocks, createStuckLocks, installLocks, removeLocks, SESSION_LOCK } from './support/webLocks'

const server = startMockServer()
let backend: Backend
let locks: ReturnType<typeof createFakeLocks>

beforeEach(() => {
  localStorage.clear()
  backend = startBackend(server)
  locks = createFakeLocks()
  installLocks(locks)
})

afterEach(() => {
  removeLocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const lateToken = () => HttpResponse.json({ accessToken: accessTokenNamed('late-token') })
const noContent = () => new HttpResponse(null, { status: 204 })

/** access token을 쓰지 않는 탭인지 본다. */
async function expectSignedOut(tab: Tab) {
  backend.requests.me.length = 0
  await errorOf(tab.request('/me'))
  expect(backend.requests.me.filter((user) => user !== '만료')).toEqual([])
}

/** 다른 탭에서 로그아웃했고 서버에 닿지 않았다. */
async function logOutElsewhere() {
  const other = await openTab()
  return other.recordLogout()
}

/** 다른 탭에서 로그아웃했고 서버도 끝냈다. */
async function logOutElsewhereCompletely() {
  const other = await openTab()
  const value = other.recordLogout()
  other.settleLogout(value)
  return value
}

/** 다음 잠금을 놓고 결과를 돌려주기까지의 사이에 이 탭에서 로그아웃한다. */
function logOutAfterUnlock(tab: Tab) {
  installLocks({
    request: async (...args) => {
      const result = await locks.request(...args)
      installLocks(locks)
      tab.logout()
      return result
    },
  })
}

const logouts: [string, () => Promise<string>][] = [
  ['대기 중인 로그아웃', logOutElsewhere],
  ['끝난 로그아웃', logOutElsewhereCompletely],
]

describe('로그아웃 대기가 있는 동안', () => {
  it('되찾기는 갱신을 보내지 않고 로그인이 필요하다고 바로 답한다', async () => {
    await logOutElsewhere()
    backend.cookieUser = 'user-1'
    const release = Promise.withResolvers<void>()
    void locks.request(SESSION_LOCK, {}, () => release.promise)
    const tab = await openTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    // 로그아웃 요청이 잠금을 쥐고 있어도 기다리지 않는다
    expect(await tab.restoreSession()).toBe(false)
    expect(backend.requests.refresh).toHaveLength(0)
    expect(ended).not.toHaveBeenCalled()
    release.resolve()
  })

  it('로그인하면 다시 갱신할 수 있다', async () => {
    await logOutElsewhere()
    const tab = await openSignedInTab()
    backend.expireTokens()
    await tab.request('/me')
    expect(backend.requests.refresh).toHaveLength(1)
    expect(await (await openTab()).restoreSession()).toBe(true)
  })
})

describe('로그아웃이 끝난 뒤', () => {
  it('되찾기는 서버에 확인한다', async () => {
    await logOutElsewhereCompletely()
    const tab = await openTab()
    expect(await tab.restoreSession()).toBe(false)
    expect(backend.requests.refresh).toHaveLength(1)
  })
})

describe.each(logouts)('되찾는 동안 다른 탭에서 %s이 있었으면', (_, logOut) => {
  it.each<[string, () => Response]>([
    ['성공', lateToken],
    ['401', () => problem(401, 'UNAUTHENTICATED')],
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 오류', () => HttpResponse.error()],
  ])('늦게 온 %s을 쓰지 않고 로그인이 필요하다고 답한다', async (_, respond) => {
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const tab = await openTab()
    const restored = tab.restoreSession()
    await refresh.arrived
    await logOut()
    refresh.answer(respond())
    expect(await restored).toBe(false)
    await expectSignedOut(tab)
  })

  it('잠금을 기다리던 되찾기는 갱신을 보내지 않는다', async () => {
    const release = Promise.withResolvers<void>()
    void locks.request(SESSION_LOCK, {}, () => release.promise)
    const tab = await openTab()
    const restored = tab.restoreSession()
    await logOut()
    release.resolve()
    expect(await restored).toBe(false)
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it('답이 없어 다시 보낼 갱신도 보내지 않는다', async () => {
    backend.refreshResponse = delayed().respond
    stopClock()
    const tab = await openTab()
    const restored = tab.restoreSession()
    await pass(4_000)
    await logOut()
    await pass(60_000)
    expect(await restored).toBe(false)
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('로그아웃이 잠금을 빼앗아도 로그인이 필요하다고 답한다', async () => {
    const answer = answerRegardlessOfAbort('/auth/refresh')
    const tab = await openTab()
    const restored = tab.restoreSession()
    const signal = await answer.arrived
    await logOut()
    await locks.request(SESSION_LOCK, { steal: true }, async () => {})
    expect(await restored).toBe(false)
    expect(signal.aborted).toBe(true)
    answer.with(lateToken())
    await settle()
    await expectSignedOut(tab)
  })

  it('앞 탭이 멈춰 잠금을 얻지 못해도 로그인이 필요하다고 답한다', async () => {
    installLocks(createStuckLocks())
    stopClock()
    const tab = await openTab()
    const restored = tab.restoreSession()
    await pass(10_000)
    await logOut()
    await pass(5_000)
    expect(await restored).toBe(false)
    expect(backend.requests.refresh).toHaveLength(0)
  })
})

describe('쓰던 탭의 요청이나 갱신이 진행되는 동안', () => {
  it.each(logouts)('다른 탭에서 %s이 있었으면 늦게 온 401에 갱신하지 않고 로그아웃된 것으로 끝낸다', async (_, logOut) => {
    const tab = await openSignedInTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const late = delayed()
    backend.meResponse = late.respond
    const request = errorOf(tab.request('/me'))
    await late.arrived
    await logOut()
    late.answer(problem(401, 'UNAUTHENTICATED'))
    expect(await request).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.refresh).toHaveLength(0)
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
    await expectSignedOut(tab)
  })

  it.each(logouts)('다른 탭에서 %s이 있었으면 늦게 온 토큰을 버리고 로그아웃된 것으로 끝낸다', async (_, logOut) => {
    const tab = await openSignedInTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    backend.expireTokens()
    const request = errorOf(tab.request('/me'))
    await refresh.arrived
    await logOut()
    refresh.answer(backend.issue('user-1'))
    expect(await request).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
    await expectSignedOut(tab)
  })

  it('다른 탭에서 로그아웃했으면 늦게 온 401을 로그인 풀림으로 알리지 않는다', async () => {
    const tab = await openSignedInTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    backend.expireTokens()
    const request = errorOf(tab.request('/me'))
    await refresh.arrived
    await logOutElsewhere()
    refresh.answer(problem(401, 'UNAUTHENTICATED'))
    await request
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
  })

  it('이 탭에서 로그아웃하면 늦게 온 토큰이 되살리지 않고 한 번만 알린다', async () => {
    removeLocks()
    const tab = await openSignedInTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    backend.expireTokens()
    const request = errorOf(tab.request('/me'))
    await refresh.arrived
    tab.logout()
    refresh.answer(backend.issue('user-1'))
    await request
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
    await expectSignedOut(tab)
  })

  it('이 탭에서 로그아웃하고 다른 계정으로 로그인하면 그 로그인이 남는다', async () => {
    removeLocks()
    const tab = await openSignedInTab()
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    backend.expireTokens()
    const request = errorOf(tab.request('/me'))
    await refresh.arrived
    tab.logout()
    backend.loginUser = 'user-2'
    await tab.login(credentials)
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.requests.me.length = 0
    refresh.answer(backend.issue('user-1'))
    await request
    await tab.request('/me')
    expect(backend.requests.me).toEqual(['user-2'])
    expect(ended).not.toHaveBeenCalled()
  })
})

describe('앱을 여는 중에 로그아웃하면', () => {
  it('늦게 온 갱신이 로그인을 되살리지 않는다', async () => {
    removeLocks()
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const tab = await openTab()
    const restored = tab.restoreSession()
    await refresh.arrived
    tab.logout()
    refresh.answer(lateToken())
    expect(await restored).toBe(false)
    await expectSignedOut(tab)
  })
})

describe('로그아웃 대기가 있는 채 로그인하면', () => {
  it('로그아웃을 다시 보내지 않고 로그인을 바로 보낸다', async () => {
    await logOutElsewhere()
    const tab = await openTab()
    await tab.login(credentials)
    await settle()
    expect(backend.requests.login).toHaveLength(1)
    expect(backend.requests.logout).toHaveLength(0)
  })

  it('성공하면 대기가 없어지고 값은 남는다', async () => {
    const value = await logOutElsewhere()
    const tab = await openSignedInTab()
    expect(tab.pendingLogout()).toBeUndefined()
    expect(tab.logoutValue()).toBe(value)
  })

  it('답이 오기 전에는 대기가 남아 있다', async () => {
    const value = await logOutElsewhere()
    const login = delayed()
    backend.loginResponse = login.respond
    const tab = await openTab()
    const signedIn = tab.login(credentials)
    await login.arrived
    expect(tab.pendingLogout()).toBe(value)
    login.answer(backend.issue('user-1'))
    await signedIn
    expect(tab.pendingLogout()).toBeUndefined()
  })

  it.each<[string, () => Response]>([
    ['거부', () => problem(401, 'INVALID_CREDENTIALS')],
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['연결 오류', () => HttpResponse.error()],
    ['읽을 수 없는 응답', () => HttpResponse.json({})],
  ])('%s이면 대기가 남는다', async (_, respond) => {
    const value = await logOutElsewhere()
    backend.loginResponse = respond
    const tab = await openTab()
    await errorOf(tab.login(credentials))
    expect(tab.pendingLogout()).toBe(value)
  })

  it('지연되면 대기가 남는다', async () => {
    const value = await logOutElsewhere()
    backend.loginResponse = delayed().respond
    stopClock()
    const tab = await openTab()
    const error = errorOf(tab.login(credentials))
    await pass(15_000)
    expect(await error).toMatchObject({ kind: 'timeout' })
    expect(tab.pendingLogout()).toBe(value)
  })

  it('잠금을 빼앗기면 늦게 온 성공을 버리고 대기가 남는다', async () => {
    const value = await logOutElsewhere()
    const answer = answerRegardlessOfAbort('/auth/login')
    const tab = await openTab()
    const error = errorOf(tab.login(credentials))
    const signal = await answer.arrived
    await locks.request(SESSION_LOCK, { steal: true }, async () => {})
    expect(await error).toMatchObject({ kind: 'timeout' })
    expect(signal.aborted).toBe(true)
    answer.with(lateToken())
    await settle()
    expect(tab.pendingLogout()).toBe(value)
    await expectSignedOut(tab)
  })
})

describe('로그인하는 동안 새로 로그아웃하면', () => {
  async function logInWhile(logOut: () => Promise<string>) {
    const login = delayed()
    backend.loginResponse = login.respond
    const tab = await openTab()
    const error = errorOf(tab.login(credentials))
    await login.arrived
    const value = await logOut()
    login.answer(backend.issue('user-1'))
    return { tab, error: await error, value }
  }

  it.each<[string, () => Promise<unknown>]>([
    ['앞선 로그아웃이 없음', async () => {}],
    ['앞선 로그아웃이 대기 중', logOutElsewhere],
    ['앞선 로그아웃이 끝남', logOutElsewhereCompletely],
  ])('받은 토큰을 쓰지 않고 새 로그아웃의 대기가 남는다: %s', async (_, before) => {
    await before()
    const { tab, error, value } = await logInWhile(logOutElsewhere)
    expect(error).toMatchObject({ name: 'ApiError', kind: 'timeout' })
    expect(tab.pendingLogout()).toBe(value)
    await expectSignedOut(tab)
    expect(await tab.restoreSession()).toBe(false)
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it('로그인이 잠금을 기다리는 동안 한 로그아웃도 이긴다', async () => {
    const release = Promise.withResolvers<void>()
    void locks.request(SESSION_LOCK, {}, () => release.promise)
    const tab = await openTab()
    const error = errorOf(tab.login(credentials))
    const value = await logOutElsewhere()
    release.resolve()
    expect(await error).toMatchObject({ kind: 'timeout' })
    expect(tab.pendingLogout()).toBe(value)
    await expectSignedOut(tab)
  })

  it('새 로그아웃의 요청은 로그인이 끝난 뒤에 나가, 방금 생긴 쿠키를 지운다', async () => {
    const order: string[] = []
    const login = delayed()
    backend.loginResponse = async () => {
      const response = await login.respond()
      order.push('login')
      return response
    }
    backend.logoutResponse = () => {
      order.push('logout')
      return noContent()
    }
    const [tab, other] = [await openTab(), await openTab()]
    const error = errorOf(tab.login(credentials))
    await login.arrived
    other.logout()
    await settle()
    expect(order).toEqual([])
    login.answer(backend.issue('user-1'))
    await error
    await vi.waitFor(() => expect(other.pendingLogout()).toBeUndefined())
    expect(order).toEqual(['login', 'logout'])
  })

  it('잠금을 놓는 사이에 이 탭의 로그인이 끝났으면 성공으로 알리지 않는다', async () => {
    const tab = await openTab()
    logOutAfterUnlock(tab)
    expect(await errorOf(tab.login(credentials))).toMatchObject({ kind: 'timeout' })
    await expectSignedOut(tab)
  })

  it('다시 로그인하면 들어간다', async () => {
    const { tab } = await logInWhile(logOutElsewhere)
    backend.loginResponse = undefined
    await tab.login(credentials)
    expect(tab.pendingLogout()).toBeUndefined()
    backend.requests.me.length = 0
    await tab.request('/me')
    expect(backend.requests.me).toEqual(['user-1'])
  })
})

describe('되찾은 뒤 잠금을 놓는 사이에', () => {
  it('이 탭의 로그인이 끝났으면 되찾지 못한 것이다', async () => {
    backend.cookieUser = 'user-1'
    const tab = await openTab()
    logOutAfterUnlock(tab)
    expect(await tab.restoreSession()).toBe(false)
  })
})
