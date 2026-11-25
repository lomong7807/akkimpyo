import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '../src/api/apiError'
import { delayed, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
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

const credentials = { email: 'name@example.com', password: 'pass1234' }

/** 탭 하나. 모듈을 새로 불러와 메모리를 다른 탭과 나누지 않는다. 저장소와 잠금은 함께 쓴다. */
async function openTab() {
  vi.resetModules()
  const session = await import('../src/api/session')
  const marks = await import('../src/api/sessionMarks')
  const { request } = await import('../src/api/request')
  return { ...session, ...marks, request }
}
type Tab = Awaited<ReturnType<typeof openTab>>

async function openSignedInTab() {
  const tab = await openTab()
  await tab.login(credentials)
  return tab
}

async function errorOf(promise: Promise<unknown>): Promise<ApiError> {
  return promise.then(
    () => {
      throw new Error('실패해야 하는 요청이 성공했다')
    },
    (error: ApiError) => error,
  )
}

/** 요청이 서버를 다녀올 만큼 기다린다. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

/** 시계를 멈춘 채, 실제 시간이 걸리는 가짜 서버의 일이 끝나기를 기다린다. */
async function settleServer() {
  for (let turn = 0; turn < 30; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}
const stopClock = () => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
async function pass(ms: number) {
  await settleServer()
  await vi.advanceTimersByTimeAsync(ms)
  await settleServer()
}

/** 다른 탭이 세션 잠금을 쥐고 있다. 돌려받은 함수를 부르면 놓는다. */
function holdLock() {
  const released = Promise.withResolvers<void>()
  void locks.request(SESSION_LOCK, {}, () => released.promise)
  return released.resolve
}

const steal = () => locks.request(SESSION_LOCK, { steal: true }, async () => {})

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

/** 로그아웃이 서버에 닿지 않은 기기 */
async function leavePendingLogout(tab: Tab) {
  backend.logoutResponse = () => HttpResponse.error()
  tab.logout()
  await vi.waitFor(() => expect(backend.requests.logout).toHaveLength(1))
  await settle()
  backend.logoutResponse = undefined
  backend.requests.logout.length = 0
  return tab.pendingLogout()!
}

describe('로그아웃 요청', () => {
  it('전용 헤더만 붙이고 본문과 Authorization은 보내지 않는다. 쿠키로 인증한다', async () => {
    const tab = await openSignedInTab()
    tab.logout()
    await vi.waitFor(() => expect(backend.requests.logout).toHaveLength(1))
    const [request] = backend.requests.logout
    expect(request.method).toBe('POST')
    expect(request.headers.get('X-Akkimpyo-Client')).toBe('web')
    expect(request.headers.has('Authorization')).toBe(false)
    expect(request.headers.has('Content-Type')).toBe(false)
    expect(request.credentials).toBe('same-origin')
    expect(await request.text()).toBe('')
  })

  it('답을 기다리지 않고 access token을 바로 버린다', async () => {
    backend.logoutResponse = delayed().respond
    const tab = await openSignedInTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    tab.logout()
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
    await errorOf(tab.request('/me'))
    expect(backend.requests.me).toEqual(['만료'])
  })

  it('잠금을 얻어 보낸다. 다른 탭의 갱신이나 로그인과 겹치지 않는다', async () => {
    const tab = await openSignedInTab()
    const release = holdLock()
    tab.logout()
    await settle()
    expect(backend.requests.logout).toHaveLength(0)
    expect(tab.pendingLogout()).toBeTruthy()
    release()
    await vi.waitFor(() => expect(tab.pendingLogout()).toBeUndefined())
    expect(backend.requests.logout).toHaveLength(1)
  })

  it('204를 받으면 대기가 없어지고 값은 남는다', async () => {
    const tab = await openSignedInTab()
    tab.logout()
    const value = tab.logoutValue()
    expect(tab.pendingLogout()).toBe(value)
    await vi.waitFor(() => expect(tab.pendingLogout()).toBeUndefined())
    expect(tab.logoutValue()).toBe(value)
  })

  it('잠금 기능이 없는 브라우저에서도 보낸다', async () => {
    removeLocks()
    const tab = await openSignedInTab()
    tab.logout()
    await vi.waitFor(() => expect(tab.pendingLogout()).toBeUndefined())
    expect(backend.requests.logout).toHaveLength(1)
  })

  it.each<[string, () => Response]>([
    ['401', () => problem(401, 'UNAUTHENTICATED')],
    ['403', () => problem(403, 'ORIGIN_NOT_ALLOWED')],
    ['404', () => problem(404, 'NOT_FOUND')],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['502', () => new HttpResponse('<html>', { status: 502 })],
    ['연결 오류', () => HttpResponse.error()],
    ['본문 없는 200', () => new HttpResponse(null, { status: 200 })],
    ['JSON 200', () => HttpResponse.json({})],
    ['다른 주소로 보내는 302', () => new HttpResponse(null, { status: 302, headers: { Location: '/login' } })],
  ])('%s이면 실패다. 대기가 남고 다시 보내지 않는다', async (_, respond) => {
    const tab = await openSignedInTab()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    backend.logoutResponse = respond
    tab.logout()
    await vi.waitFor(() => expect(backend.requests.logout).toHaveLength(1))
    await settle()
    expect(backend.requests.logout).toHaveLength(1)
    expect(tab.pendingLogout()).toBe(tab.logoutValue())
    expect(unhandled).not.toHaveBeenCalled()
    process.off('unhandledRejection', unhandled)
  })

  it('5초 동안 답이 없으면 끊고 실패로 본다. 저절로 다시 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    const late = delayed()
    backend.logoutResponse = late.respond
    stopClock()
    tab.logout()
    await late.arrived
    await pass(4_999)
    expect(backend.requests.logout[0].signal.aborted).toBe(false)
    await pass(1)
    expect(backend.requests.logout[0].signal.aborted).toBe(true)
    await pass(60_000)
    expect(backend.requests.logout).toHaveLength(1)
    expect(tab.pendingLogout()).toBeTruthy()
  })

  it('실패한 뒤 잠금을 놓는다', async () => {
    const tab = await openSignedInTab()
    await leavePendingLogout(tab)
    let granted = false
    await locks.request(SESSION_LOCK, {}, async () => {
      granted = true
    })
    expect(granted).toBe(true)
  })

  it('앞 로그아웃의 204가 뒤 로그아웃의 대기를 없애지 않는다', async () => {
    const tab = await openSignedInTab()
    const slow = delayed()
    backend.logoutResponse = slow.respond
    tab.logout()
    await slow.arrived
    const other = await openTab()
    const second = other.recordLogout()
    slow.answer(new HttpResponse(null, { status: 204 }))
    await settle()
    expect(tab.pendingLogout()).toBe(second)
  })

  it('기다리는 사이 새 로그아웃이 생기면 앞의 것은 보내지 않는다', async () => {
    const [tab, other] = [await openSignedInTab(), await openSignedInTab()]
    const release = holdLock()
    tab.logout()
    other.logout()
    release()
    await vi.waitFor(() => expect(tab.pendingLogout()).toBeUndefined())
    await settle()
    expect(backend.requests.logout).toHaveLength(1)
  })
})

describe('기다리던 로그아웃은 로그인 뒤에 나가지 않는다', () => {
  it.each([
    ['같은 탭의 로그인', async (tab: Tab) => tab],
    ['다른 탭의 로그인', async () => openTab()],
  ])('%s', async (_, loginTab) => {
    const tab = await openSignedInTab()
    const value = await leavePendingLogout(tab)
    const signingIn = await loginTab(tab)
    const release = holdLock()
    const login = signingIn.login(credentials)
    // 로그인 뒤에 줄을 선 로그아웃
    signingIn.resendLogout()
    tab.resendLogout()
    await settle()
    expect(backend.requests.login).toHaveLength(1)
    release()
    await login
    await settle()
    expect(backend.requests.login).toHaveLength(2)
    expect(backend.requests.logout).toHaveLength(0)
    expect(tab.pendingLogout()).toBeUndefined()
    expect(tab.logoutValue()).toBe(value)
    await signingIn.request('/me')
    expect(backend.requests.me).toEqual(['user-1'])
  })
})

describe('닿지 못한 로그아웃을 다시 보내기', () => {
  it('대기가 없으면 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    tab.resendLogout()
    await settle()
    expect(backend.requests.logout).toHaveLength(0)
  })

  it('보내서 204를 받으면 대기가 없어진다', async () => {
    const tab = await openSignedInTab()
    await leavePendingLogout(tab)
    const opened = await openTab()
    opened.resendLogout()
    await vi.waitFor(() => expect(opened.pendingLogout()).toBeUndefined())
    expect(backend.requests.logout).toHaveLength(1)
    expect(backend.requests.logout[0].headers.has('Authorization')).toBe(false)
  })

  it('실패하면 되풀이하지 않고 대기가 남는다', async () => {
    const tab = await openSignedInTab()
    const value = await leavePendingLogout(tab)
    backend.logoutResponse = () => problem(500, 'INTERNAL_ERROR')
    tab.resendLogout()
    await settle()
    expect(backend.requests.logout).toHaveLength(1)
    expect(tab.pendingLogout()).toBe(value)
  })

  it('함께 불러도 한 번만 보내고, 끝난 뒤에는 다시 보낼 수 있다', async () => {
    const tab = await openSignedInTab()
    await leavePendingLogout(tab)
    backend.logoutResponse = () => problem(500, 'INTERNAL_ERROR')
    tab.resendLogout()
    tab.resendLogout()
    await settle()
    expect(backend.requests.logout).toHaveLength(1)
    tab.resendLogout()
    await settle()
    expect(backend.requests.logout).toHaveLength(2)
  })

  it('탭 여러 개가 함께 보내도 하나가 끝나면 나머지는 보내지 않는다', async () => {
    await leavePendingLogout(await openSignedInTab())
    const tabs = [await openTab(), await openTab(), await openTab()]
    tabs.forEach((tab) => tab.resendLogout())
    await vi.waitFor(() => expect(tabs[0].pendingLogout()).toBeUndefined())
    await settle()
    expect(backend.requests.logout).toHaveLength(1)
  })
})

describe('잠금을 15초 동안 얻지 못하면', () => {
  it('사용자가 누른 로그아웃은 잠금을 빼앗아 보낸다', async () => {
    const tab = await openSignedInTab()
    const stuck = createStuckLocks()
    installLocks(stuck)
    const frozenTabLost = errorOf(stuck.frozenTab)
    stopClock()
    tab.logout()
    await pass(14_999)
    expect(backend.requests.logout).toHaveLength(0)
    await pass(1)
    expect(await frozenTabLost).toMatchObject({ name: 'AbortError' })
    expect(backend.requests.logout).toHaveLength(1)
    expect(tab.pendingLogout()).toBeUndefined()
  })

  it('빼앗은 뒤에도 대기가 자기 값이 아니면 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    installLocks(createStuckLocks())
    stopClock()
    tab.logout()
    await pass(14_000)
    tab.settleLogout(tab.logoutValue())
    await pass(2_000)
    expect(backend.requests.logout).toHaveLength(0)
  })

  it('다시 보내는 로그아웃은 빼앗지 않고 대기를 남긴다', async () => {
    const tab = await openSignedInTab()
    const value = await leavePendingLogout(tab)
    const stuck = createStuckLocks()
    installLocks(stuck)
    const lost = vi.fn()
    stuck.frozenTab.catch(lost)
    stopClock()
    tab.resendLogout()
    await pass(60_000)
    expect(lost).not.toHaveBeenCalled()
    expect(backend.requests.logout).toHaveLength(0)
    expect(tab.pendingLogout()).toBe(value)
  })
})

describe('로그아웃이 잠금을 빼앗기면', () => {
  it('요청을 끊고, 늦게 온 204로 대기를 없애지 않는다', async () => {
    const tab = await openSignedInTab()
    const answer = answerRegardlessOfAbort('/auth/logout')
    tab.logout()
    const signal = await answer.arrived
    await steal()
    await settle()
    expect(signal.aborted).toBe(true)
    answer.with(new Response(null, { status: 204 }))
    await settle()
    expect(tab.pendingLogout()).toBe(tab.logoutValue())
  })
})

describe('저장소를 쓸 수 없어도', () => {
  it.each<[string, () => void]>([
    [
      '막힘',
      () =>
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
          throw new DOMException('막힘', 'SecurityError')
        }),
    ],
    [
      '가득 참',
      () =>
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('가득 참', 'QuotaExceededError')
        }),
    ],
  ])('%s: 이 탭은 로그아웃되고 요청을 보낸다. 닿지 못하면 이 탭은 대기를 안다', async (_, block) => {
    block()
    const tab = await openSignedInTab()
    const ended = vi.fn()
    tab.onSessionEnded(ended)
    backend.logoutResponse = () => HttpResponse.error()
    tab.logout()
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
    await vi.waitFor(() => expect(backend.requests.logout).toHaveLength(1))
    await settle()
    expect(tab.pendingLogout()).toBeTruthy()
    await errorOf(tab.request('/me'))
    expect(backend.requests.me).toEqual(['만료'])
  })
})
