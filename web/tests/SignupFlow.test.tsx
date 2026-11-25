import { cleanup, screen, waitFor } from '@testing-library/react'
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
  window.history.replaceState(null, '')
})

const RETURN_ADDRESS = 'akkimpyo-return-address'
const secret = '로그인한 사람만 보는 내용'
const failed = '문제가 생겨 가입하지 못했어요. 잠시 후 다시 시도해 주세요.'

const open = (path: string) => openApp(path, addScreens([{ path: '/secret', element: <main>{secret}</main> }]))
type User = Awaited<ReturnType<typeof open>>['user']

const signupHeading = () => screen.findByRole('heading', { level: 1, name: '가입' })
const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })
const notFound = () => screen.findByRole('heading', { level: 1, name: '찾을 수 없어요.' })
const email = () => screen.getByLabelText<HTMLInputElement>('이메일')
const password = () => screen.getByLabelText<HTMLInputElement>('비밀번호')
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

async function signUp(user: User) {
  await signupHeading()
  if (email().value === '') await user.type(email(), 'new@example.com')
  await user.type(password(), 'pass1234')
  await user.type(screen.getByLabelText('비밀번호 확인'), 'pass1234')
  await user.type(screen.getByLabelText('표시 이름'), '이서연')
  await user.click(screen.getByRole('button', { name: '가입' }))
}

const toSignup = (user: User) => user.click(screen.getByRole('link', { name: '가입' }))
const toLogin = (user: User) => user.click(screen.getByRole('link', { name: '로그인' }))

describe('/signup을 열면', () => {
  it('로그인 여부를 확인하는 동안에도 바로 열린다', async () => {
    backend.refreshResponse = delayed().respond
    const { router } = await open('/signup')
    expect(screen.getByRole('heading', { level: 1, name: '가입' })).toBeTruthy()
    await settle()
    expect(router.state.location.pathname).toBe('/signup')
  })

  it.each([
    ['로그인하지 않음', () => problem(401, 'UNAUTHENTICATED')],
    ['확인하지 못함', () => problem(500, 'INTERNAL_ERROR')],
  ])('%s이면 그대로 있다', async (_, respond) => {
    backend.refreshResponse = respond
    const { router } = await open('/signup')
    await waitFor(() => expect(backend.requests.refresh).toHaveLength(1))
    await settle()
    expect(router.state.location.pathname).toBe('/signup')
    expect(screen.getByRole('heading', { level: 1, name: '가입' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([390, 1280])('폭 %dpx에서 공통 틀 없이 내용이 하나다', async (width) => {
    await open('/signup')
    setViewportWidth(width)
    await signupHeading()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('banner')).toHaveLength(1)
  })
})

describe('가입하면', () => {
  it('로그인한 상태가 되어 /welcome으로 간다. 화면이 아직 없으므로 새 사용자의 공통 틀과 찾을 수 없음이다', async () => {
    const { router, user } = await open('/signup')
    await signUp(user)
    await notFound()
    expect(router.state.location.pathname).toBe('/welcome')
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.state).toBeNull()
    expect(screen.getAllByText(ledgerNameOf('new-user')).length).toBeGreaterThan(0)
    expect(backend.requests.me).toEqual(['new-user'])
    expect(backend.requests.refresh).toHaveLength(1)
  })

  it('쓴 값을 보낸다', async () => {
    const { user } = await open('/signup')
    await signUp(user)
    await notFound()
    const [request] = backend.requests.signup
    expect(await request.json()).toEqual({ email: 'new@example.com', password: 'pass1234', displayName: '이서연' })
    expect(request.headers.get('X-Akkimpyo-Client')).toBe('web')
  })

  it('기억한 주소가 있어도 쓰지 않고 지운다', async () => {
    const { router, user } = await open('/secret')
    await loginHeading()
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret')
    await toSignup(user)
    await signUp(user)
    await notFound()
    expect(router.state.location.pathname).toBe('/welcome')
    await waitFor(() => expect(sessionStorage.length).toBe(0))
  })

  it('"뒤로" 가도 가입 화면으로 돌아가지 않는다', async () => {
    const { router, user } = await open('/login')
    await toSignup(user)
    await signUp(user)
    await notFound()
    await router.navigate(-1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
  })

  it('앞 사용자의 로그인이 풀린 자리에서 가입하면 앞 사용자의 값이 보이지 않는다', async () => {
    backend.cookieUser = 'user-1'
    const { router, user } = await open('/secret')
    await screen.findByText(secret)
    backend.expireTokens()
    backend.refreshResponse = () => problem(401, 'UNAUTHENTICATED')
    const { request } = await import('../src/api/request')
    await request('/me').catch(() => {})
    await loginHeading()
    const dom = recordDom()
    await toSignup(user)
    await signUp(user)
    await notFound()
    expect(router.state.location.pathname).toBe('/welcome')
    expect(dom.sawText(ledgerNameOf('new-user'))).toBe(true)
    expect(dom.sawText(ledgerNameOf('user-1'))).toBe(false)
    expect(dom.sawText(secret)).toBe(false)
  })

  it('늦게 온 로그인 확인의 결과로 다른 화면으로 옮기거나 다른 사용자가 되지 않는다', async () => {
    const refresh = delayed()
    const signup = delayed()
    backend.refreshResponse = refresh.respond
    backend.signupResponse = signup.respond
    const { router, user } = await open('/signup')
    await refresh.arrived
    await signUp(user)
    await signup.arrived
    refresh.answer(backend.issue('user-1'))
    await settle()
    expect(router.state.location.pathname).toBe('/signup')
    signup.answer(backend.issue('new-user', 201))
    await notFound()
    expect(router.state.location.pathname).toBe('/welcome')
    expect(backend.requests.me).toEqual(['new-user'])
  })

  it('토큰, 이메일, 비밀번호를 저장소에 남기지 않는다', async () => {
    const { user } = await open('/signup')
    await signUp(user)
    await notFound()
    expect(sessionStorage.length).toBe(0)
    // 로그인했음을 다른 화면이 아는, 뜻이 없는 임의 값 하나만 남는다
    expect({ ...localStorage }).toEqual({ 'akkimpyo-login': expect.stringMatching(/^[0-9a-f]{32}$/) })
    expect(document.cookie).toBe('')
  })
})

describe('가입에 실패하면', () => {
  it('그대로 있고, 기억한 주소도 남으며, 다시 성공하면 /welcome으로 간다', async () => {
    backend.signupResponse = () => problem(500, 'INTERNAL_ERROR')
    const { router, user } = await open('/secret')
    await loginHeading()
    await toSignup(user)
    await signUp(user)
    await screen.findByText(failed)
    expect(router.state.location.pathname).toBe('/signup')
    expect(sessionStorage.getItem(RETURN_ADDRESS)).toBe('/secret')
    expect(backend.requests.me).toEqual([])

    backend.signupResponse = undefined
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await notFound()
    expect(router.state.location.pathname).toBe('/welcome')
  })
})

describe('로그인 화면과 이메일을 주고받기', () => {
  it('로그인에서 쓴 이메일이 가입에 채워지고 비밀번호에 초점이 간다. 비밀번호는 넘기지 않는다', async () => {
    const { router, user } = await open('/login')
    await user.type(email(), 'name@example.com')
    await user.type(password(), 'secret12')
    await toSignup(user)
    await signupHeading()
    expect(email().value).toBe('name@example.com')
    expect(password().value).toBe('')
    expect(document.activeElement).toBe(password())
    expect(router.state.location.state).toEqual({ email: 'name@example.com' })
  })

  it('가입에서 쓴 이메일이 로그인에 채워지고 비밀번호에 초점이 간다. 다른 값은 넘기지 않는다', async () => {
    const { router, user } = await open('/signup')
    await user.type(email(), 'name@example.com')
    await user.type(password(), 'pass1234')
    await user.type(screen.getByLabelText('표시 이름'), '이서연')
    await toLogin(user)
    await loginHeading()
    expect(email().value).toBe('name@example.com')
    expect(password().value).toBe('')
    expect(document.activeElement).toBe(password())
    expect(router.state.location.state).toEqual({ email: 'name@example.com' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('쓴 이메일이 없으면 이메일 칸에서 시작한다', async () => {
    const { user } = await open('/login')
    await toSignup(user)
    await signupHeading()
    expect(document.activeElement).toBe(email())
    await toLogin(user)
    await loginHeading()
    expect(document.activeElement).toBe(email())
  })

  it.each([
    ['글자가 아님', { email: 1 }],
    ['객체가 아님', 'name@example.com'],
    ['없음', null],
  ])('방문 기록의 값이 %s이면 빈 칸으로 연다', async (_, state) => {
    const { router } = await open('/login')
    await router.navigate('/signup', { state })
    await signupHeading()
    expect(email().value).toBe('')
    await router.navigate('/login', { state })
    await loginHeading()
    expect(email().value).toBe('')
  })
})

describe('"뒤로"', () => {
  it('앞서 본 화면이 있으면 그 화면으로 돌아간다', async () => {
    const { router, user } = await open('/login')
    await toSignup(user)
    await signupHeading()
    // react-router가 브라우저 방문 기록에 적는 순번. 시험의 라우터는 적지 않는다
    window.history.replaceState({ idx: 1 }, '')
    await user.click(screen.getByRole('button', { name: '뒤로' }))
    await loginHeading()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('POP')
  })

  it('앞서 본 화면이 없으면 로그인으로 간다', async () => {
    const { router, user } = await open('/signup')
    await signupHeading()
    await user.click(screen.getByRole('button', { name: '뒤로' }))
    await loginHeading()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})
