import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, ledgerNameOf, startBackend, type Backend } from './support/backend'
import { itemOf, listOf, listScreen, startList, type List } from './support/listScreen'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { createFakeLocks, createStuckLocks, installLocks, removeLocks, SESSION_LOCK } from './support/webLocks'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()
let backend: Backend
let list: List

beforeEach(() => {
  backend = startBackend(server)
  list = startList(server, backend)
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  removeLocks()
  vi.restoreAllMocks()
})

const RETURN_ADDRESS = 'akkimpyo-return-address'
const ended = '로그인이 풀렸어요. 다시 로그인해 주세요.'
const failed = '불러오지 못했어요.'
const secret = '로그인한 사람만 보는 내용'

const open = (path = '/list') =>
  openApp(path, async (routes) =>
    addScreens([await listScreen(list), { path: '/secret', element: <main>{secret}</main> }])(routes),
  )
type Opened = Awaited<ReturnType<typeof open>>

const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })
const press = (user: Opened['user'], name: string) => user.click(screen.getByRole('button', { name }))
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))
/** 다시 보내는 로그아웃이 표시를 읽기까지 기다렸다가 서버를 다녀올 만큼 기다린다. */
const settleResent = () => act(() => new Promise((resolve) => setTimeout(resolve, 250)))

/** 이 탭의 로그아웃. 화면의 줄이 부르는 것과 같다. */
async function logOut() {
  const { logout } = await import('../src/api/session')
  act(() => logout())
}

/** 지난번에 로그아웃했지만 서버에 닿지 않은 기기 */
async function leavePendingLogout() {
  vi.resetModules()
  const { recordLogout } = await import('../src/api/sessionMarks')
  return recordLogout()
}

async function openAsFirstUser(path?: string) {
  backend.cookieUser = 'user-1'
  const opened = await open(path)
  await screen.findByText(itemOf('user-1'))
  return opened
}

async function logIn(user: Opened['user'], as: string) {
  backend.loginUser = as
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await press(user, '로그인')
}

describe('로그아웃하면', () => {
  it('알림 없이 /login으로 바꿔 가고 방문 기록에 넘기는 것이 없다', async () => {
    const opened = await openAsFirstUser('/list?month=2026-11')
    await logOut()
    await loginHeading()
    expect(addressOf(opened)).toBe('/login')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(opened.router.state.location.state).toBeNull()
    expect(screen.queryByText(ended)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('보던 주소를 기억하지 않고 기억해 둔 주소도 지운다', async () => {
    await openAsFirstUser('/list?month=2026-11')
    sessionStorage.setItem(RETURN_ADDRESS, '/secret')
    await logOut()
    await loginHeading()
    expect(sessionStorage.length).toBe(0)
  })

  it('서버의 답을 기다리지 않고 처리 중 표시도 없다', async () => {
    const opened = await openAsFirstUser()
    const slow = delayed()
    backend.logoutResponse = slow.respond
    await logOut()
    expect(addressOf(opened)).toBe('/login')
    expect(await loginHeading()).toBeTruthy()
    expect(document.querySelector('[aria-busy]')).toBeNull()
    await slow.arrived
    expect(backend.requests.logout).toHaveLength(1)
  })

  it.each<[string, () => Response]>([
    ['연결 오류', () => HttpResponse.error()],
    ['401', () => problem(401, 'UNAUTHENTICATED')],
    ['403', () => problem(403, 'ORIGIN_NOT_ALLOWED')],
    ['500', () => problem(500, 'INTERNAL_ERROR')],
  ])('서버에 닿지 않거나 실패해도(%s) 이 기기는 로그아웃되고 다시 열어도 로그인 화면이다', async (_, respond) => {
    const opened = await openAsFirstUser()
    backend.logoutResponse = respond
    await logOut()
    await loginHeading()
    await settle()
    expect(addressOf(opened)).toBe('/login')
    expect(screen.queryByRole('alert')).toBeNull()

    cleanup()
    backend.requests.refresh.length = 0
    const reopened = await open()
    await loginHeading()
    expect(addressOf(reopened)).toBe('/login')
    expect(backend.requests.refresh).toHaveLength(0)
    // 서버의 로그인은 아직 살아 있다
    expect(backend.cookieUser).toBe('user-1')
  })

  it('앞 탭이 멈춰 있어도 바로 /login이다', async () => {
    const opened = await openAsFirstUser()
    installLocks(createStuckLocks())
    await logOut()
    await loginHeading()
    expect(addressOf(opened)).toBe('/login')
  })

  it('저장소가 막혀 있어도 로그아웃된다', async () => {
    const opened = await openAsFirstUser()
    const blocked = () => {
      throw new DOMException('막힘', 'SecurityError')
    }
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(blocked)
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(blocked)
    await logOut()
    await loginHeading()
    expect(addressOf(opened)).toBe('/login')
    await waitFor(() => expect(backend.requests.logout).toHaveLength(1))
  })

  it('기기에 남는 것은 뜻이 없는 임의 값뿐이다', async () => {
    await openAsFirstUser()
    await logOut()
    await loginHeading()
    await waitFor(() => expect(backend.cookieUser).toBeUndefined())
    await settle()
    const stored = Object.entries({ ...localStorage })
    expect(stored.map(([key]) => key).sort()).toEqual(['akkimpyo-logout', 'akkimpyo-logout-done'])
    for (const [, value] of stored) expect(value).toMatch(/^[0-9a-f]{32}$/)
    expect(sessionStorage.length).toBe(0)
    expect(JSON.stringify(window.history.state)).not.toMatch(/user-1|eyJ/)
    expect(document.cookie).toBe('')
  })
})

describe('로그아웃한 뒤', () => {
  it('캐시가 비고, 늦게 온 조회와 저장의 응답이 새 사용자의 캐시와 화면에 들어가지 않는다', async () => {
    const opened = await openAsFirstUser()
    const lateList = delayed()
    list.response = lateList.respond
    await press(opened.user, '새로 받기')
    await lateList.arrived
    const lateSave = delayed()
    list.response = lateSave.respond
    await press(opened.user, '저장')
    await lateSave.arrived
    list.response = undefined
    await logOut()
    await loginHeading()
    const [oldCache] = list.caches
    expect(oldCache.getQueryCache().getAll()).toEqual([])
    expect(oldCache.getMutationCache().getAll()).toEqual([])

    await logIn(opened.user, 'user-2')
    await screen.findByText('찾을 수 없어요.')
    await act(() => opened.router.navigate('/list'))
    await screen.findByText(itemOf('user-2'))
    const dom = recordDom()
    lateList.answer(listOf('user-1'))
    lateSave.answer(listOf('user-1'))
    await settle()
    expect(dom.sawText('user-1')).toBe(false)
    expect(list.caches).toHaveLength(2)
    const data = list.caches[1].getQueryCache().getAll().map((query) => query.state.data)
    expect(JSON.stringify(data)).toContain('user-2')
    expect(JSON.stringify(data)).not.toContain('user-1')
  })

  it('뒤로 가도 앞 사용자의 값이 한 번도 그려지지 않고 다시 /login이며, 그 주소를 기억하지 않는다', async () => {
    const opened = await openAsFirstUser('/list?month=2026-11')
    await act(() => opened.router.navigate('/secret'))
    await screen.findByText(secret)
    await logOut()
    await loginHeading()
    const dom = recordDom()
    list.requests.length = 0
    backend.requests.me.length = 0
    await act(() => opened.router.navigate(-1))
    await settle()
    expect(addressOf(opened)).toBe('/login')
    expect(dom.sawText('user-1')).toBe(false)
    expect(dom.sawText(ledgerNameOf('user-1'))).toBe(false)
    expect(dom.sawText(secret)).toBe(false)
    expect(dom.sawElement('nav, header')).toBe(false)
    expect(list.requests).toEqual([])
    expect(backend.requests.me).toEqual([])
    expect(screen.queryByText(ended)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('다른 계정으로 로그인하면 홈에서 시작하고 앞 사용자의 값이 보이지 않는다', async () => {
    const opened = await openAsFirstUser('/list?month=2026-11')
    await opened.user.type(screen.getByLabelText('메모'), '앞 사용자가 쓰던 값')
    await logOut()
    await loginHeading()
    const dom = recordDom()
    await logIn(opened.user, 'user-2')
    await screen.findByText('찾을 수 없어요.')
    expect(addressOf(opened)).toBe('/home')
    await act(() => opened.router.navigate('/list'))
    await screen.findByText(itemOf('user-2'))
    expect(screen.getByLabelText<HTMLInputElement>('메모').value).toBe('')
    expect(dom.sawText('user-1')).toBe(false)
    expect(list.caches).toHaveLength(2)
  })

  it('로그인이 풀린 뒤 다시 로그인하고 로그아웃하면 "로그인이 풀렸어요."가 다시 나오지 않는다', async () => {
    const { user } = await openAsFirstUser()
    backend.expireTokens()
    backend.cookieUser = undefined
    await press(user, '새로 받기')
    await screen.findByText(ended)
    await logIn(user, 'user-1')
    await screen.findByText(itemOf('user-1'))
    await logOut()
    await loginHeading()
    expect(screen.queryByText(ended)).toBeNull()
  })
})

describe('로그아웃이 서버에 닿지 않은 채 앱을 열면', () => {
  it('로그아웃의 답을 기다리지 않고 알림 없이 바로 로그인 화면이다. 갱신하지 않는다', async () => {
    await leavePendingLogout()
    backend.cookieUser = 'user-1'
    const slow = delayed()
    backend.logoutResponse = slow.respond
    const dom = recordDom()
    const opened = await open('/secret')
    await loginHeading()
    await slow.arrived
    expect(addressOf(opened)).toBe('/login')
    expect(backend.requests.refresh).toHaveLength(0)
    expect(dom.sawText(failed)).toBe(false)
    expect(dom.sawText(secret)).toBe(false)
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('로그아웃을 한 번 다시 보내 서버의 로그인을 끝낸다', async () => {
    await leavePendingLogout()
    backend.cookieUser = 'user-1'
    await open('/login')
    await waitFor(() => expect(backend.cookieUser).toBeUndefined())
    await settleResent()
    expect(backend.requests.logout).toHaveLength(1)
    expect(backend.requests.logout[0].headers.has('Authorization')).toBe(false)
  })

  it('실패해도 되풀이하지 않고, 다시 연결되면 한 번 보낸다', async () => {
    await leavePendingLogout()
    backend.cookieUser = 'user-1'
    backend.logoutResponse = () => HttpResponse.error()
    await open('/secret')
    await loginHeading()
    await settleResent()
    expect(backend.requests.logout).toHaveLength(1)

    act(() => void window.dispatchEvent(new Event('online')))
    await settleResent()
    expect(backend.requests.logout).toHaveLength(2)

    backend.logoutResponse = undefined
    act(() => void window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(backend.cookieUser).toBeUndefined())
    act(() => void window.dispatchEvent(new Event('online')))
    await settleResent()
    expect(backend.requests.logout).toHaveLength(3)
  })

  it('다른 탭이 잠금을 쥐고 멈춰 있어도 로그인 화면이 바로 열린다', async () => {
    await leavePendingLogout()
    installLocks(createStuckLocks())
    await open('/secret')
    await loginHeading()
  })

  it('로그인하면 로그아웃을 다시 보내지 않고 들어간다. 그 뒤 다시 연결돼도 보내지 않는다', async () => {
    await leavePendingLogout()
    backend.logoutResponse = () => HttpResponse.error()
    const { user } = await open('/list')
    await loginHeading()
    await settleResent()
    backend.logoutResponse = undefined
    await logIn(user, 'user-2')
    await screen.findByText(itemOf('user-2'))
    act(() => void window.dispatchEvent(new Event('online')))
    await settleResent()
    expect(backend.requests.logout).toHaveLength(1)
    expect(screen.getByText(itemOf('user-2'))).toBeTruthy()
  })

  it('잠금을 기다리던 다시 보내기는 로그인한 뒤에 나가지 않는다', async () => {
    const locks = createFakeLocks()
    installLocks(locks)
    await leavePendingLogout()
    const login = delayed()
    backend.loginResponse = login.respond
    backend.logoutResponse = () => HttpResponse.error()
    const { user } = await open('/list')
    await loginHeading()
    await settleResent()
    backend.logoutResponse = undefined
    await logIn(user, 'user-2')
    await login.arrived
    act(() => void window.dispatchEvent(new Event('online')))
    login.answer(backend.issue('user-2'))
    await screen.findByText(itemOf('user-2'))
    await settleResent()
    await locks.request(SESSION_LOCK, {}, async () => {})
    expect(backend.requests.logout).toHaveLength(1)
  })
})

describe('로그인하는 동안 다른 탭에서 로그아웃하면', () => {
  it('들어가지 않고 다시 로그인할 수 있다', async () => {
    const login = delayed()
    backend.loginResponse = login.respond
    const opened = await open('/list')
    await loginHeading()
    await logIn(opened.user, 'user-1')
    await login.arrived
    vi.resetModules()
    const other = await import('../src/api/sessionMarks')
    other.recordLogout()
    const dom = recordDom()
    login.answer(backend.issue('user-1'))
    expect(await screen.findByText('문제가 생겨 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(addressOf(opened)).toBe('/login')
    expect(dom.sawText('user-1')).toBe(false)

    backend.loginResponse = undefined
    await press(opened.user, '다시 시도')
    expect(await screen.findByText(itemOf('user-1'))).toBeTruthy()
  })
})

describe('가입하는 동안 다른 탭에서 로그아웃하면', () => {
  it('들어가지 않고 다시 시도할 수 있다', async () => {
    const signup = delayed()
    backend.signupResponse = signup.respond
    const opened = await open('/signup')
    await opened.user.type(await screen.findByLabelText('이메일'), 'new@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.type(screen.getByLabelText('비밀번호 확인'), 'pass1234')
    await opened.user.type(screen.getByLabelText('표시 이름'), '이서연')
    await press(opened.user, '가입')
    await signup.arrived
    const value = await leavePendingLogout()
    const dom = recordDom()
    signup.answer(backend.issue('new-user', 201))
    expect(await screen.findByText('문제가 생겨 가입하지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(addressOf(opened)).toBe('/signup')
    expect(dom.sawText('new-user')).toBe(false)
    expect(backend.requests.me).toEqual([])
    expect(localStorage.getItem('akkimpyo-logout')).toBe(value)
    expect(localStorage.getItem('akkimpyo-logout-done')).toBeNull()

    backend.signupResponse = undefined
    await press(opened.user, '다시 시도')
    await waitFor(() => expect(addressOf(opened)).toBe('/welcome'))
    await waitFor(() => expect(backend.requests.me).toEqual(['new-user']))
  })
})
