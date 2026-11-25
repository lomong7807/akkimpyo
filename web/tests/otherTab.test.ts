import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessTokenNamed } from './support/accessToken'
import { delayed, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { credentials, errorOf, openSignedInTab, openTab, settle, type Tab } from './support/sessionTab'
import { createFakeLocks, installLocks, removeLocks } from './support/webLocks'

const server = startMockServer()
let backend: Backend

beforeEach(() => {
  localStorage.clear()
  backend = startBackend(server)
  installLocks(createFakeLocks())
})

afterEach(() => {
  removeLocks()
  vi.restoreAllMocks()
})

/** 로그인이 끝났는지 지켜본다. */
function watchEnd(tab: Tab) {
  const ended = vi.fn()
  tab.onSessionEnded(ended)
  return ended
}

/** 다른 탭이 로그아웃했고 서버도 끝냈다. */
async function logOutElsewhere() {
  const other = await openTab()
  other.settleLogout(other.recordLogout())
}

/** 다른 탭이 로그인했다. */
async function logInElsewhere() {
  const other = await openTab()
  other.settleLogout(other.logoutValue())
  other.recordLogin()
}

/** 새로 열어 되찾은 탭 */
async function openRestoredTab() {
  backend.cookieUser = 'user-1'
  const tab = await openTab()
  expect(await tab.restoreSession()).toBe(true)
  return tab
}

const signedIn: [string, () => Promise<Tab>][] = [
  ['로그인한 탭', openSignedInTab],
  ['되찾은 탭', openRestoredTab],
]

describe('로그인 값', () => {
  it('로그인을 보내기 전에 바뀐다', async () => {
    const tab = await openTab()
    const before = tab.recordLogin()
    const login = delayed()
    backend.loginResponse = login.respond
    const signedIn = tab.login(credentials)
    await login.arrived
    expect(tab.loginValue()).not.toBe(before)
    login.answer(backend.issue('user-1'))
    await signedIn
  })

  it('로그인이 거부돼도 바뀌어 있다', async () => {
    const tab = await openTab()
    const before = tab.recordLogin()
    backend.loginResponse = () => problem(401, 'INVALID_CREDENTIALS')
    await errorOf(tab.login(credentials))
    expect(tab.loginValue()).not.toBe(before)
  })

  it('되찾기와 갱신, 로그아웃으로는 바뀌지 않는다', async () => {
    const tab = await openSignedInTab()
    const value = tab.loginValue()
    backend.expireTokens()
    await tab.request('/me')
    expect(await (await openTab()).restoreSession()).toBe(true)
    tab.logout()
    await settle()
    expect(tab.loginValue()).toBe(value)
  })
})

describe.each(signedIn)('%s은', (_, open) => {
  it('로그아웃이 있었으면 요청을 보내지 않고 로그아웃된 것으로 끝낸다', async () => {
    const tab = await open()
    const ended = watchEnd(tab)
    await logOutElsewhere()
    backend.requests.logout.length = 0
    tab.noticeLogout()
    tab.noticeLogout()
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
    await settle()
    expect(backend.requests.logout).toHaveLength(0)
  })

  it('서버에 닿지 않은 로그아웃도 같다', async () => {
    const tab = await open()
    const ended = watchEnd(tab)
    ;(await openTab()).recordLogout()
    tab.noticeLogout()
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
  })

  it('로그아웃한 뒤 다시 로그인했어도 앞 로그인은 끝난 것이다', async () => {
    const tab = await open()
    const ended = watchEnd(tab)
    await logOutElsewhere()
    await logInElsewhere()
    tab.noticeLogout()
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
  })

  it('로그아웃이 없었으면 그대로다', async () => {
    const tab = await open()
    const ended = watchEnd(tab)
    tab.noticeLogout()
    await tab.request('/me')
    expect(ended).not.toHaveBeenCalled()
  })

  it('다른 탭의 로그인으로는 끝나지 않는다', async () => {
    const tab = await open()
    const ended = watchEnd(tab)
    await logInElsewhere()
    tab.noticeLogout()
    await tab.request('/me')
    expect(ended).not.toHaveBeenCalled()
  })

  it('저장소를 모두 지운 신호를 받으면 로그아웃이 있었던 것으로 본다', async () => {
    const tab = await open()
    const ended = watchEnd(tab)
    tab.noticeLogout({ storageCleared: true })
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
  })

  it('요청을 보내기 직전에 보고, 로그아웃이 있었으면 보내지 않는다', async () => {
    const tab = await open()
    const ended = watchEnd(tab)
    await logOutElsewhere()
    backend.requests.me.length = 0
    expect(await errorOf(tab.request('/me'))).toMatchObject({ kind: 'rejected', status: 401, code: 'UNAUTHENTICATED' })
    expect(backend.requests.me).toEqual([])
    expect(backend.requests.refresh.length).toBeLessThanOrEqual(1)
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
  })
})

it('앞서 로그아웃한 적이 있어도, 그 뒤에 로그인했으면 끝나지 않는다', async () => {
  await logOutElsewhere()
  const tab = await openSignedInTab()
  const ended = watchEnd(tab)
  tab.noticeLogout()
  await tab.request('/me')
  expect(ended).not.toHaveBeenCalled()
})

it('로그아웃 값이 지워져도 로그아웃이 있었던 것으로 본다', async () => {
  await logOutElsewhere()
  const tab = await openSignedInTab()
  const ended = watchEnd(tab)
  localStorage.clear()
  tab.noticeLogout()
  expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
})

it('로그인하지 않은 탭은 알리지 않는다', async () => {
  const tab = await openTab()
  const ended = watchEnd(tab)
  await logOutElsewhere()
  tab.noticeLogout()
  tab.noticeLogout({ storageCleared: true })
  expect(ended).not.toHaveBeenCalled()
})

describe('401을 받은 요청을 다시 보내기 직전에도 본다', () => {
  it('새 토큰이 있어도 그사이 로그아웃이 있었으면 보내지 않는다', async () => {
    const tab = await openSignedInTab()
    const ended = watchEnd(tab)
    const late = delayed()
    backend.meResponse = late.respond
    const request = errorOf(tab.request('/me'))
    await late.arrived
    backend.meResponse = undefined
    backend.expireTokens()
    await tab.request('/me')
    backend.requests.me.length = 0
    await logOutElsewhere()
    late.answer(problem(401, 'UNAUTHENTICATED'))
    expect(await request).toMatchObject({ status: 401 })
    expect(backend.requests.me).toEqual([])
    expect(ended).toHaveBeenCalledExactlyOnceWith('logged-out')
  })
})

describe('되살아난 화면', () => {
  /** 화면이 브라우저에 보관된 동안 `change`가 있었다가 되살아났다. */
  async function resumeAfter(tab: Tab, change: () => Promise<unknown> | unknown) {
    const ended = watchEnd(tab)
    tab.suspendSession()
    await change()
    tab.resumeSession()
    return ended
  }

  it('로그아웃 값과 로그인 값이 그대로면 로그인도 그대로이고 갱신하지 않는다', async () => {
    const tab = await openSignedInTab()
    const ended = await resumeAfter(tab, () => {})
    expect(ended).not.toHaveBeenCalled()
    await tab.request('/me')
    expect(backend.requests.refresh).toHaveLength(0)
  })

  it.each<[string, () => Promise<unknown> | unknown]>([
    ['로그아웃 값이 바뀜', logOutElsewhere],
    ['로그아웃 대기가 있음', async () => (await openTab()).recordLogout()],
    ['로그인 값이 바뀜', logInElsewhere],
    ['로그아웃한 뒤 다시 로그인함', async () => (await logOutElsewhere(), logInElsewhere())],
    ['저장소가 지워짐', () => localStorage.clear()],
    ['로그인 값이 지워짐', () => localStorage.removeItem('akkimpyo-login')],
    [
      '저장소를 읽지 못함',
      () =>
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
          throw new DOMException('막힘', 'SecurityError')
        }),
    ],
  ])('%s: 쓰던 로그인을 버리고 새로 연다고 알린다', async (_, change) => {
    const tab = await openSignedInTab()
    const ended = await resumeAfter(tab, change)
    expect(ended).toHaveBeenCalledExactlyOnceWith('replaced')
    backend.requests.me.length = 0
    await errorOf(tab.request('/me'))
    expect(backend.requests.me).toEqual(['만료'])
  })

  it('로그인 값을 남긴 적이 없으면 같은지 알 수 없으므로 새로 연다', async () => {
    const tab = await openRestoredTab()
    expect(tab.loginValue()).toBeUndefined()
    expect(await resumeAfter(tab, () => {})).toHaveBeenCalledExactlyOnceWith('replaced')
  })

  it('로그인 값을 본 뒤 되찾았으면 그대로 연다', async () => {
    await openSignedInTab()
    const tab = await openRestoredTab()
    expect(await resumeAfter(tab, () => {})).not.toHaveBeenCalled()
  })

  it('되찾는 동안 다른 탭이 로그인을 보냈으면 같지 않다', async () => {
    await openSignedInTab()
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const tab = await openTab()
    const restored = tab.restoreSession()
    await refresh.arrived
    await logInElsewhere()
    refresh.answer(backend.issue('user-1'))
    expect(await restored).toBe(true)
    expect(await resumeAfter(tab, () => {})).toHaveBeenCalledExactlyOnceWith('replaced')
  })

  it('되살아났다고 알기 전에 먼저 온 신호도 새로 열게 하고, 두 번 알리지 않는다', async () => {
    const tab = await openSignedInTab()
    const ended = watchEnd(tab)
    tab.suspendSession()
    await logInElsewhere()
    tab.noticeLogout()
    tab.resumeSession()
    expect(ended).toHaveBeenCalledExactlyOnceWith('replaced')
  })

  it('되살아났다고 알기 전에 나가려던 요청은 확인하고 나간다', async () => {
    const tab = await openSignedInTab()
    const ended = watchEnd(tab)
    tab.suspendSession()
    await tab.request('/me')
    await logInElsewhere()
    backend.requests.me.length = 0
    expect(await errorOf(tab.request('/me'))).toMatchObject({ status: 401 })
    expect(backend.requests.me).toEqual([])
    expect(ended).toHaveBeenCalledExactlyOnceWith('replaced')
  })

  it('되살아난 뒤에는 다른 탭의 로그인으로 끝나지 않는다', async () => {
    const tab = await openSignedInTab()
    const ended = await resumeAfter(tab, () => {})
    await logInElsewhere()
    tab.noticeLogout()
    expect(ended).not.toHaveBeenCalled()
  })

  it('로그인하지 않은 화면이면 알리지 않는다', async () => {
    const tab = await openTab()
    expect(await resumeAfter(tab, logInElsewhere)).not.toHaveBeenCalled()
  })

  it('버린 뒤의 되찾기는 앞 로그인의 진행 중이던 갱신을 같이 기다리지 않는다', async () => {
    removeLocks()
    const tab = await openSignedInTab()
    backend.expireTokens()
    const old = delayed()
    backend.refreshResponse = old.respond
    const request = errorOf(tab.request('/me'))
    await old.arrived
    await resumeAfter(tab, logInElsewhere)
    backend.refreshResponse = undefined
    backend.cookieUser = 'user-2'
    expect(await tab.restoreSession()).toBe(true)
    backend.requests.me.length = 0
    old.answer(HttpResponse.json({ accessToken: accessTokenNamed('late-token', { sub: 'user-1' }) }))
    expect(await request).toMatchObject({ status: 401 })
    await tab.request('/me')
    expect(backend.requests.me).toEqual(['user-2'])
  })
})
