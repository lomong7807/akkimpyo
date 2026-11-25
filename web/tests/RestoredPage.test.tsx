import { act, cleanup, screen, waitFor } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../src/styles/base.css'
import { delayed, ledgerNameOf, startBackend, type Backend } from './support/backend'
import { itemOf, listScreen, startList, type List } from './support/listScreen'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { createFakeLocks, installLocks, removeLocks } from './support/webLocks'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()
let backend: Backend
let list: List

beforeEach(() => {
  backend = startBackend(server)
  list = startList(server, backend)
  sessionStorage.clear()
  localStorage.clear()
  installLocks(createFakeLocks())
})

afterEach(() => {
  cleanup()
  removeLocks()
  vi.restoreAllMocks()
  // 가린 채 끝난 테스트가 다음 테스트를 가리지 않게 한다
  act(() => void window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  document.documentElement.removeAttribute('data-covered')
})

const ended = '로그인이 풀렸어요. 다시 로그인해 주세요.'
const failed = '불러오지 못했어요.'

const open = (path = '/list') => openApp(path, async (routes) => addScreens([await listScreen(list)])(routes))
type Opened = Awaited<ReturnType<typeof open>>

const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)))
const isCovered = () => getComputedStyle(document.body).visibility === 'hidden'

async function logIn(user: Opened['user'], as: string) {
  backend.loginUser = as
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await user.click(screen.getByRole('button', { name: '로그인' }))
}

/** 이 화면에서 user-1로 로그인해 자기 목록을 보고 있다. */
async function openAsFirstUser(path = '/list') {
  const opened = await open(path)
  await logIn(opened.user, 'user-1')
  await screen.findByText(itemOf('user-1'))
  await opened.user.type(screen.getByLabelText('메모'), '쓰던 값')
  return opened
}

async function openOtherPage() {
  vi.resetModules()
  return import('../src/api/sessionMarks')
}

/** 화면이 브라우저에 보관된다. */
const hidePage = (persisted = true) =>
  act(() => void window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted })))

/**
 * 보관된 화면이 되살아난다. 브라우저는 다시 보인다는 신호를 먼저 보내고, 두 신호 사이에 응답이 올 틈은 없다.
 * 앞의 신호가 오지 않는 경우도 보려면 `visibility`를 끈다.
 */
async function showPage({ visibility = true } = {}) {
  if (visibility) {
    act(() => void document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
  }
  act(() => void window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
}

/** 가림을 푸는 순간마다 화면에 남아 있던 글. 그 뒤에 바로 지워도 남는다. */
function watchUncovering() {
  const root = document.documentElement
  const texts: string[] = []
  const remove = root.removeAttribute.bind(root)
  vi.spyOn(root, 'removeAttribute').mockImplementation((name) => {
    if (root.hasAttribute(name)) texts.push(document.body.textContent ?? '')
    remove(name)
  })
  return texts
}

describe('화면이 브라우저에 보관되면', () => {
  it('되살아나 확인하기 전까지 가려져 있다', async () => {
    await openAsFirstUser()
    expect(isCovered()).toBe(false)
    hidePage()
    expect(isCovered()).toBe(true)
    expect(screen.queryByRole('main')).toBeNull()
    act(() => void document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    await settle()
    expect(isCovered()).toBe(true)
  })

  it('되살아났다는 신호보다 먼저 로그인이 바뀐 것을 알아도 그 신호가 올 때까지 가려져 있다', async () => {
    await openAsFirstUser()
    hidePage()
    ;(await openOtherPage()).recordLogin()
    act(() => void document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    await settle()
    expect(isCovered()).toBe(true)
    await showPage()
    expect(isCovered()).toBe(false)
  })

  it('보관되지 않고 닫히는 화면은 가리지 않는다', async () => {
    await openAsFirstUser()
    hidePage(false)
    expect(isCovered()).toBe(false)
  })
})

describe('되살아난 화면의 표시가 그대로면', () => {
  it('갱신하지 않고 쓰던 화면을 그대로 연다', async () => {
    const opened = await openAsFirstUser()
    hidePage()
    await showPage()
    expect(isCovered()).toBe(false)
    await settle()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByText(itemOf('user-1'))).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>('메모').value).toBe('쓰던 값')
    expect(backend.requests.login).toHaveLength(1)
    // 앱을 열 때의 확인 한 번뿐이다
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('지금 화면의 조회를 한 번씩 다시 보낸다', async () => {
    await openAsFirstUser()
    list.requests.length = 0
    backend.requests.me.length = 0
    hidePage()
    await showPage()
    await settle()
    expect(list.requests).toEqual(['user-1'])
    expect(backend.requests.me).toEqual(['user-1'])
  })

  it('보관되지 않은 화면이 열릴 때는 다시 보내지 않는다', async () => {
    await openAsFirstUser()
    list.requests.length = 0
    act(() => void window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })))
    await settle()
    expect(list.requests).toEqual([])
  })

  it('다시 되살아나면 또 한 번 보낸다', async () => {
    await openAsFirstUser()
    hidePage()
    await showPage()
    await settle()
    list.requests.length = 0
    hidePage()
    expect(isCovered()).toBe(true)
    await showPage()
    await settle()
    expect(isCovered()).toBe(false)
    expect(list.requests).toEqual(['user-1'])
  })

  it('연결이 없으면 화면을 그대로 둔다', async () => {
    const opened = await openAsFirstUser()
    list.response = () => HttpResponse.error()
    backend.meResponse = () => HttpResponse.error()
    hidePage()
    await showPage()
    await settle()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByText(itemOf('user-1'))).toBeTruthy()
    expect(screen.queryByText(failed)).toBeNull()
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('서버가 그 로그인을 폐기했으면 다시 보낸 조회로 알게 되어 "로그인이 풀렸어요."를 보인다', async () => {
    const opened = await openAsFirstUser()
    backend.expireTokens()
    backend.cookieUser = undefined
    hidePage()
    await showPage()
    expect(await screen.findByText(ended)).toBeTruthy()
    expect(addressOf(opened)).toBe('/login')
  })

  it('토큰이 만료됐을 뿐이면 갱신해 이어 쓴다', async () => {
    const opened = await openAsFirstUser()
    backend.expireTokens()
    hidePage()
    await showPage()
    await waitFor(() => expect(backend.requests.refresh).toHaveLength(2))
    await settle()
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByLabelText<HTMLInputElement>('메모').value).toBe('쓰던 값')
  })
})

/** 되살아난 화면에 오는 신호. 브라우저에 따라 화면이 다시 보인다는 신호가 먼저 온다. */
const arrivals = [
  ['다시 보인다는 신호가 먼저 옴', { visibility: true }],
  ['열렸다는 신호만 옴', { visibility: false }],
] as const

describe.each(arrivals)('보관된 동안 로그아웃했으면(%s)', (_, arrival) => {
  it.each<[string, () => Promise<void>]>([
    [
      '서버도 끝냄',
      async () => {
        const other = await openOtherPage()
        other.settleLogout(other.recordLogout())
        backend.cookieUser = undefined
      },
    ],
    [
      '서버에 닿지 않음',
      async () => {
        ;(await openOtherPage()).recordLogout()
      },
    ],
  ])('앞 사용자의 화면을 한 번도 보이지 않고 알림 없이 로그인 화면이다: %s', async (_, logOut) => {
    const opened = await openAsFirstUser('/list?month=2026-11')
    hidePage()
    await logOut()
    const uncovered = watchUncovering()
    list.requests.length = 0
    backend.requests.me.length = 0
    await showPage(arrival)
    expect(isCovered()).toBe(false)
    await loginHeading()
    await settle()
    expect(addressOf(opened)).toBe('/login')
    expect(uncovered).toHaveLength(1)
    expect(uncovered.join()).not.toMatch(/user-1|쓰던 값/)
    expect(list.requests).toEqual([])
    expect(backend.requests.me).toEqual([])
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('서버에 닿지 않은 로그아웃이면 되찾지 않는다', async () => {
    await openAsFirstUser()
    hidePage()
    ;(await openOtherPage()).recordLogout()
    backend.requests.refresh.length = 0
    await showPage(arrival)
    await loginHeading()
    await settle()
    expect(backend.requests.refresh).toHaveLength(0)
  })
})

describe.each(arrivals)('보관된 동안 다른 계정으로 로그인했으면(%s)', (_, arrival) => {
  it('앞 사용자의 값을 한 번도 보이지 않고 새 사용자의 화면을 처음부터 연다', async () => {
    const opened = await openAsFirstUser()
    hidePage()
    ;(await openOtherPage()).recordLogin()
    backend.cookieUser = 'user-2'
    backend.requests.refresh.length = 0
    const uncovered = watchUncovering()
    const dom = recordDom()
    await showPage(arrival)
    expect(await screen.findByText(itemOf('user-2'))).toBeTruthy()
    expect(isCovered()).toBe(false)
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByLabelText<HTMLInputElement>('메모').value).toBe('')
    expect(uncovered).toHaveLength(1)
    expect(uncovered.join()).not.toMatch(/user-1|쓰던 값/)
    expect(dom.sawText('user-1')).toBe(false)
    expect(dom.sawText(ledgerNameOf('user-2'))).toBe(true)
    expect(backend.requests.refresh).toHaveLength(1)
    expect(list.caches).toHaveLength(2)
    expect(list.caches[0].getQueryCache().getAll()).toEqual([])
    expect(screen.queryByText(ended)).toBeNull()
  })

  it('로그아웃하고 로그인했어도 같다', async () => {
    const opened = await openAsFirstUser()
    hidePage()
    const other = await openOtherPage()
    other.settleLogout(other.recordLogout())
    other.recordLogin()
    backend.cookieUser = 'user-2'
    const uncovered = watchUncovering()
    await showPage(arrival)
    expect(await screen.findByText(itemOf('user-2'))).toBeTruthy()
    expect(addressOf(opened)).toBe('/list')
    expect(uncovered).toHaveLength(1)
    expect(uncovered.join()).not.toMatch(/user-1|쓰던 값/)
  })

  it('확인하는 동안에는 빈 화면이다', async () => {
    await openAsFirstUser()
    hidePage()
    ;(await openOtherPage()).recordLogin()
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    await showPage(arrival)
    await refresh.arrived
    expect(isCovered()).toBe(false)
    expect(document.body.textContent).toBe('')
  })

  it('확인하지 못하면 "불러오지 못했어요."이고 다시 시도할 수 있다', async () => {
    const { user } = await openAsFirstUser()
    hidePage()
    ;(await openOtherPage()).recordLogin()
    backend.cookieUser = 'user-2'
    backend.refreshResponse = () => problem(500, 'INTERNAL_ERROR')
    await showPage(arrival)
    expect(await screen.findByText(failed)).toBeTruthy()
    backend.refreshResponse = undefined
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText(itemOf('user-2'))).toBeTruthy()
  })
})

describe('표시를 확인할 수 없으면', () => {
  it.each<[string, () => void]>([
    ['저장소가 지워짐', () => localStorage.clear()],
    [
      '저장소를 읽지 못함',
      () =>
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
          throw new DOMException('막힘', 'SecurityError')
        }),
    ],
  ])('쓰던 화면을 버리고 서버에 확인해 새로 연다: %s', async (_, change) => {
    const opened = await openAsFirstUser()
    hidePage()
    change()
    backend.requests.refresh.length = 0
    await showPage()
    await screen.findByText(itemOf('user-1'))
    expect(addressOf(opened)).toBe('/list')
    expect(screen.getByLabelText<HTMLInputElement>('메모').value).toBe('')
    expect(backend.requests.refresh).toHaveLength(1)
  })
})

describe('로그인하지 않은 화면이 되살아나면', () => {
  it('로그인 화면을 그대로 연다', async () => {
    const opened = await open('/login')
    await waitFor(() => expect(backend.requests.refresh).toHaveLength(1))
    await settle()
    await opened.user.type(screen.getByLabelText('이메일'), 'name')
    hidePage()
    expect(isCovered()).toBe(true)
    ;(await openOtherPage()).recordLogin()
    await showPage()
    expect(isCovered()).toBe(false)
    expect(screen.getByLabelText<HTMLInputElement>('이메일').value).toBe('name')
  })

  it('확인하지 못한 화면을 그대로 연다', async () => {
    backend.refreshResponse = () => problem(500, 'INTERNAL_ERROR')
    await open('/list')
    await screen.findByText(failed)
    hidePage()
    await showPage()
    expect(isCovered()).toBe(false)
    expect(screen.getByText(failed)).toBeTruthy()
  })
})
