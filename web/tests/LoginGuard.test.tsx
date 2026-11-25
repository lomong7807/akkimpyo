import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, ledgerNameOf, startBackend, type Backend } from './support/backend'
import { startMockServer } from './support/mockServer'
import { addScreens, openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { resetViewport, setViewportWidth } from './support/viewport'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()
let backend: Backend

beforeEach(() => {
  backend = startBackend(server)
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  vi.restoreAllMocks()
})

const RETURN_ADDRESS = 'akkimpyo-return-address'
const secret = '로그인한 사람만 보는 내용'
const ended = '로그인이 풀렸어요. 다시 로그인해 주세요.'

const open = (path: string) => openApp(path, addScreens([{ path: '/secret', element: <main>{secret}</main> }]))
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })
const notFound = () => screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
const failure = () => screen.findByRole('heading', { level: 1, name: '불러오지 못했어요.' })

async function logIn(user: Awaited<ReturnType<typeof open>>['user']) {
  await user.type(await screen.findByLabelText('이메일'), 'name@example.com')
  await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
  await user.click(screen.getByRole('button', { name: '로그인' }))
}

/** 응답이 다 오고 화면이 바뀔 만큼 기다린다. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

const signedIn = () => void (backend.cookieUser = 'user-1')

describe('로그인하지 않고 로그인이 필요한 주소를 열면', () => {
  it.each(['/home', '/secret?month=2026-11', '/없는-주소', '/transactions/1/edit', '/login/help', '/'])(
    '%s에서 /login으로 보낸다',
    async (path) => {
      const { router } = await open(path)
      await loginHeading()
      expect(router.state.location.pathname).toBe('/login')
      expect(router.state.location.search).toBe('')
      expect(router.state.historyAction).toBe('REPLACE')
    },
  )

  it('로그인 풀림 알림은 보이지 않는다', async () => {
    await open('/secret')
    await loginHeading()
    expect(screen.queryByText(ended)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('보호된 화면과 공통 틀이 한 번도 그려지지 않고 내 정보도 부르지 않는다', async () => {
    const dom = recordDom()
    await open('/secret')
    await loginHeading()
    await settle()
    expect(dom.sawText(secret)).toBe(false)
    expect(dom.sawElement('nav, header')).toBe(false)
    expect(backend.requests.me).toEqual([])
  })
})

describe('로그인한 채 로그인이 필요한 주소를 열면', () => {
  beforeEach(signedIn)

  it('그 화면을 공통 틀과 함께 보이고 주소는 그대로다', async () => {
    const { router } = await open('/secret?month=2026-11')
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
    expect(router.state.location.pathname + router.state.location.search).toBe('/secret?month=2026-11')
  })

  it('없는 주소면 찾을 수 없음이다', async () => {
    const { router } = await open('/없는-주소')
    await notFound()
    expect(router.state.location.pathname).toBe('/없는-주소')
  })

  it('갱신과 내 정보를 한 번씩만 부른다', async () => {
    await open('/secret')
    await screen.findByText(secret)
    await settle()
    expect(backend.requests.refresh).toHaveLength(1)
    expect(backend.requests.me).toEqual(['user-1'])
  })

  it('로그인 여부를 확인하는 동안 보호된 화면과 공통 틀을 그리지 않는다', async () => {
    const refresh = delayed()
    backend.refreshResponse = refresh.respond
    const dom = recordDom()
    await open('/secret')
    await refresh.arrived
    await settle()
    expect(dom.sawText(secret)).toBe(false)
    expect(dom.sawElement('nav, header, form')).toBe(false)
    refresh.answer(backend.issue('user-1'))
    expect(await screen.findByText(secret)).toBeTruthy()
  })

  it('내 정보를 받는 동안에도 보호된 화면과 공통 틀을 그리지 않는다', async () => {
    const me = delayed()
    backend.meResponse = me.respond
    const dom = recordDom()
    await open('/secret')
    await me.arrived
    await settle()
    expect(dom.sawText(secret)).toBe(false)
    expect(dom.sawElement('nav, header, form')).toBe(false)
  })
})

describe('로그인 여부를 확인하지 못하면', () => {
  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['연결 오류', () => HttpResponse.error()],
    ['약속과 다른 200', () => HttpResponse.json({})],
    ['403', () => problem(403, 'ORIGIN_NOT_ALLOWED')],
  ])('%s이면 로그인 풀림으로 다루지 않고 "불러오지 못했어요."를 보인다', async (_, respond) => {
    backend.refreshResponse = respond
    const dom = recordDom()
    const { router } = await open('/secret')
    await failure()
    expect(screen.getByRole('link', { name: '로그인하러 가기' })).toBeTruthy()
    await settle()
    expect(router.state.location.pathname).toBe('/secret')
    expect(dom.sawText(secret)).toBe(false)
    expect(dom.sawElement('nav, header, form')).toBe(false)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('/', () => {
  it('로그인했으면 /home이다', async () => {
    signedIn()
    const { router } = await open('/')
    await notFound()
    expect(router.state.location.pathname).toBe('/home')
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('로그인하지 않았으면 /login이고, 로그인하면 /home으로 간다', async () => {
    const { router, user } = await open('/')
    await logIn(user)
    await notFound()
    expect(router.state.location.pathname).toBe('/home')
  })
})

describe('로그인 없이 볼 수 있는 주소', () => {
  it('/login은 로그인 여부를 확인하는 동안에도 바로 열린다', async () => {
    backend.refreshResponse = delayed().respond
    const { router } = await open('/login')
    expect(screen.getByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    await settle()
    expect(router.state.location.pathname).toBe('/login')
  })

  it.each([
    ['로그인하지 않음', () => problem(401, 'UNAUTHENTICATED')],
    ['확인하지 못함', () => problem(500, 'INTERNAL_ERROR')],
  ])('/login은 %s이면 알림 없이 그대로 있다', async (_, respond) => {
    backend.refreshResponse = respond
    const { router } = await open('/login')
    await waitFor(() => expect(backend.requests.refresh).toHaveLength(1))
    await settle()
    expect(backend.requests.refresh).toHaveLength(1)
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  describe.each(['/login', '/signup', '/LOGIN', '/login/'])('로그인한 채 %s을 열면', (path) => {
    beforeEach(signedIn)

    it('/home으로 간다', async () => {
      const { router } = await open(path)
      await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
      expect(router.state.historyAction).toBe('REPLACE')
    })

    it('기억한 주소를 쓰지 않고 지운다', async () => {
      sessionStorage.setItem(RETURN_ADDRESS, '/secret')
      const { router } = await open(path)
      await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
      await waitFor(() => expect(sessionStorage.length).toBe(0))
      await notFound()
      expect(router.state.location.pathname).toBe('/home')
    })
  })

  it.each(['/login', '/signup'])('로그인한 뒤 앱 안에서 %s으로 가도 기억한 주소를 쓰지 않고 /home으로 간다', async (path) => {
    signedIn()
    const { router } = await open('/secret')
    await screen.findByText(secret)
    sessionStorage.setItem(RETURN_ADDRESS, '/secret')
    await router.navigate(path)
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    await notFound()
  })
})

describe('로그인하면', () => {
  it('원래 주소로 쿼리까지 돌아가고 기억한 주소를 지운다', async () => {
    const { router, user } = await open('/secret?month=2026-11')
    await loginHeading()
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret?month=2026-11')
    await logIn(user)
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(router.state.location.pathname + router.state.location.search).toBe('/secret?month=2026-11')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.state).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('원래 주소가 여전히 없으면 찾을 수 없음이다', async () => {
    const { router, user } = await open('/no-such-screen/7')
    await logIn(user)
    await notFound()
    expect(router.state.location.pathname).toBe('/no-such-screen/7')
  })

  it('로그인 화면을 바로 열었으면 /home으로 간다', async () => {
    const { router, user } = await open('/login')
    await logIn(user)
    await notFound()
    expect(router.state.location.pathname).toBe('/home')
  })

  it('로그인 화면에서 새로고침해도 원래 주소로 돌아간다', async () => {
    await open('/secret')
    await loginHeading()
    cleanup()
    const { router, user } = await open('/login')
    await logIn(user)
    expect(await screen.findByText(secret)).toBeTruthy()
    expect(router.state.location.pathname).toBe('/secret')
  })

  it('뒤로 가도 로그인 화면으로 돌아가지 않는다', async () => {
    const { router, user } = await open('/secret')
    await logIn(user)
    await screen.findByText(secret)
    await router.navigate(-1)
    await settle()
    expect(router.state.location.pathname).toBe('/secret')
  })

  it.each(['//evil.example/', 'https://evil.example/', '/\\evil.example', '/login'])(
    '저장소의 주소가 %s로 바뀌어 있으면 버리고 /home으로 간다',
    async (address) => {
      sessionStorage.setItem(RETURN_ADDRESS, address)
      const { router, user } = await open('/login')
      await logIn(user)
      await notFound()
      expect(router.state.location.pathname).toBe('/home')
    },
  )

  it('저장소가 막혀 있으면 /home으로 간다', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('막힘', 'SecurityError')
    })
    const { router, user } = await open('/secret')
    await logIn(user)
    await notFound()
    expect(router.state.location.pathname).toBe('/home')
  })

  it('실패하면 그대로 있고, 다시 성공하면 원래 주소로 간다', async () => {
    backend.loginResponse = () => problem(401, 'INVALID_CREDENTIALS')
    const { router, user } = await open('/secret')
    await logIn(user)
    await screen.findByText('이메일 또는 비밀번호가 맞지 않아요')
    expect(router.state.location.pathname).toBe('/login')
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret')

    backend.loginResponse = undefined
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByText(secret)).toBeTruthy()
  })

  it('토큰, 이메일, 사용자 정보를 저장소에 남기지 않는다', async () => {
    const { user } = await open('/secret')
    await loginHeading()
    expect({ ...sessionStorage }).toEqual({ [RETURN_ADDRESS]: '/secret' })
    await logIn(user)
    await screen.findByText(secret)
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })
})

describe('로그인한 사람의 공통 틀', () => {
  beforeEach(signedIn)

  it('휴대폰 배치는 상단 바에 현재 장부의 이름을 글자로 보인다', async () => {
    await open('/없는-주소')
    await notFound()
    expect(within(screen.getByRole('banner')).getByText(ledgerNameOf('user-1'))).toBeTruthy()
  })

  it('넓은 화면은 사이드바에 보인다', async () => {
    await open('/없는-주소')
    await notFound()
    setViewportWidth(1280)
    const sidebar = screen.getByRole('navigation', { name: '주 메뉴' }).parentElement!
    expect(within(sidebar).getByText(ledgerNameOf('user-1'))).toBeTruthy()
  })
})
