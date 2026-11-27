import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, startBackend, type Backend } from './support/backend'
import { itemOf, listOf, listScreen, startList, type List } from './support/listScreen'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { recordDom } from './support/recordDom'

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
  vi.restoreAllMocks()
})

const ended = '로그인이 풀렸어요. 다시 로그인해 주세요.'

const open = (path = '/list') => openApp(path, async (routes) => addScreens([await listScreen(list)])(routes))
type Opened = Awaited<ReturnType<typeof open>>

const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })
const press = (user: Opened['user'], name: string) => user.click(screen.getByRole('button', { name }))
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))

async function openAsFirstUser(path?: string) {
  backend.cookieUser = 'user-1'
  const opened = await open(path)
  await screen.findByText(itemOf('user-1'))
  return opened
}

async function openOtherTab() {
  vi.resetModules()
  return import('../src/api/sessionMarks')
}

/** 다른 탭이 로그아웃했고 서버도 끝냈다. 이 탭에는 아직 신호가 오지 않았다. */
async function logOutElsewhere() {
  const other = await openOtherTab()
  other.settleLogout(other.recordLogout())
  backend.cookieUser = undefined
}

const storageEvent = (key: string | null) => act(() => void window.dispatchEvent(new StorageEvent('storage', { key })))

function changeVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  act(() => void document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
}

const pageShow = (persisted: boolean) =>
  act(() => void window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted })))

/** 이 탭이 로그아웃을 알게 되는 길 */
const signals: [string, () => void][] = [
  ['저장소 신호', () => storageEvent('akkimpyo-logout')],
  ['다른 키의 저장소 신호', () => storageEvent('akkimpyo-logout-done')],
  ['화면이 다시 보일 때', () => changeVisibility('visible')],
  ['화면이 열릴 때', () => pageShow(false)],
]

describe.each(signals)('다른 탭에서 로그아웃한 것을 알면: %s', (_, signal) => {
  it('알림 없이 /login으로 가고 서버에 아무것도 보내지 않는다', async () => {
    const opened = await openAsFirstUser('/list?month=2026-11')
    await logOutElsewhere()
    backend.requests.me.length = 0
    list.requests.length = 0
    const dom = recordDom()
    signal()
    await loginHeading()
    await settle()
    expect(addressOf(opened)).toBe('/login')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    expect(opened.router.state.location.state).toBeNull()
    expect(screen.queryByText(ended)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(dom.sawText('user-1')).toBe(false)
    expect(backend.requests.logout).toHaveLength(0)
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.me).toEqual([])
    expect(list.requests).toEqual([])
  })

  it('보던 주소를 기억하지 않는다', async () => {
    await openAsFirstUser('/list?month=2026-11')
    await logOutElsewhere()
    signal()
    await loginHeading()
    expect(sessionStorage.length).toBe(0)
  })

  it('캐시를 비우고 늦게 온 응답을 쓰지 않는다', async () => {
    const { user } = await openAsFirstUser()
    const late = delayed()
    list.response = late.respond
    await press(user, '새로 받기')
    await late.arrived
    await logOutElsewhere()
    signal()
    await loginHeading()
    const [cache] = list.caches
    expect(cache.getQueryCache().getAll()).toEqual([])
    late.answer(listOf('user-1'))
    await settle()
    expect(cache.getQueryCache().getAll()).toEqual([])
  })

  it('로그아웃이 없었으면 화면을 그대로 둔다', async () => {
    const opened = await openAsFirstUser()
    await opened.user.type(screen.getByLabelText('메모'), '쓰던 값')
    signal()
    await settle()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByLabelText<HTMLInputElement>('메모').value).toBe('쓰던 값')
  })

  it('다른 탭의 로그인만으로는 화면을 바꾸지 않는다', async () => {
    const opened = await openAsFirstUser()
    ;(await openOtherTab()).recordLogin()
    signal()
    await settle()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByText(itemOf('user-1'))).toBeTruthy()
  })
})

describe('저장소가 지워지면', () => {
  it('키가 지워진 것도 로그아웃으로 본다', async () => {
    await logOutElsewhere()
    const opened = await openAsFirstUser()
    localStorage.removeItem('akkimpyo-logout')
    storageEvent('akkimpyo-logout')
    await loginHeading()
    expect(addressOf(opened)).toBe('/login')
  })

  it('저장소를 모두 지운 신호(event.key가 null)면 남긴 값이 없었어도 로그아웃으로 본다', async () => {
    const opened = await openAsFirstUser()
    storageEvent(null)
    await loginHeading()
    expect(addressOf(opened)).toBe('/login')
    expect(screen.queryByText(ended)).toBeNull()
  })
})

it('화면이 가려질 때는 보지 않는다', async () => {
  const opened = await openAsFirstUser()
  await logOutElsewhere()
  changeVisibility('hidden')
  await settle()
  expect(addressOf(opened)).toBe('/list')
})

describe('신호를 받지 못했어도', () => {
  it('요청을 보내기 직전에 알고, 보내지 않고 알림 없이 /login으로 간다', async () => {
    const opened = await openAsFirstUser()
    await logOutElsewhere()
    list.requests.length = 0
    await press(opened.user, '새로 받기')
    await loginHeading()
    await settle()
    expect(addressOf(opened)).toBe('/login')
    expect(list.requests).toEqual([])
    expect(backend.requests.refresh).toHaveLength(1)
    expect(screen.queryByText(ended)).toBeNull()
    expect(screen.queryByText('목록을 받지 못함')).toBeNull()
  })

  it('값이 바뀌지 않은 채 서버가 알려 주면 "로그인이 풀렸어요."를 보인다', async () => {
    const opened = await openAsFirstUser()
    backend.cookieUser = undefined
    backend.expireTokens()
    await press(opened.user, '새로 받기')
    expect(await screen.findByText(ended)).toBeTruthy()
  })
})

it('되찾는 중인 탭은 다른 탭의 로그아웃 뒤에 온 응답을 받아들이지 않고 알림 없이 로그인 화면이다', async () => {
  const refresh = delayed()
  backend.refreshResponse = refresh.respond
  const dom = recordDom()
  const opened = await open()
  await refresh.arrived
  await logOutElsewhere()
  storageEvent('akkimpyo-logout')
  refresh.answer(backend.issue('user-1'))
  await loginHeading()
  expect(addressOf(opened)).toBe('/login')
  expect(dom.sawText('user-1')).toBe(false)
  expect(backend.requests.me).toEqual([])
  expect(screen.queryByText(ended)).toBeNull()
})

it('로그아웃을 안 탭에서 다른 계정으로 로그인할 수 있다', async () => {
  const opened = await openAsFirstUser()
  await logOutElsewhere()
  storageEvent('akkimpyo-logout')
  backend.loginUser = 'user-2'
  await opened.user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await press(opened.user, '로그인')
  await screen.findByRole('heading', { level: 1, name: '홈' })
  expect(addressOf(opened)).toBe('/home')
  storageEvent('akkimpyo-login')
  await settle()
  await act(() => opened.router.navigate('/list'))
  expect(await screen.findByText(itemOf('user-2'))).toBeTruthy()
})

it('이 탭의 로그아웃을 다른 탭이 안다', async () => {
  await openAsFirstUser()
  const { logout } = await import('../src/api/session')
  const other = await openOtherTab()
  const before = other.logoutValue()
  act(() => logout())
  expect(other.logoutValue()).not.toBe(before)
  await waitFor(() => expect(other.pendingLogout()).toBeUndefined())
  expect(other.logoutValue()).not.toBe(before)
})
