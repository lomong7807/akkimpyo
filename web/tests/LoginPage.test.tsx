import { onlineManager } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { useNavigate, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { watchConnection } from '../src/api/connection'
import { login } from '../src/api/session'
import PlainLayout from '../src/app/PlainLayout'
import { createQueryClient } from '../src/app/queryClient'
import LoginPage from '../src/features/auth/LoginPage'
import { goOffline, goOnline } from './support/connection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { renderRoutes } from './support/renderRoutes'
import { holdClock, passTime, setupUser } from './support/testClock'
import { resetViewport, setViewportWidth } from './support/viewport'

vi.stubGlobal('scrollTo', vi.fn())

const server = startMockServer()

afterEach(() => {
  cleanup()
  resetViewport()
  signIn.mockClear()
})

const emailRequired = '이메일을 입력해 주세요'
const emailFormat = '이메일 주소 형식을 확인해 주세요'
const passwordRequired = '비밀번호를 입력해 주세요'
const refused = '이메일 또는 비밀번호가 맞지 않아요'
const failed = '문제가 생겨 로그인하지 못했어요. 잠시 후 다시 시도해 주세요.'
const lost = '연결이 끊겨 로그인하지 못했어요. 연결되면 다시 시도해 주세요.'
const offlineReason = '연결되면 로그인할 수 있어요'

const email = () => screen.getByLabelText<HTMLInputElement>('이메일')
const password = () => screen.getByLabelText<HTMLInputElement>('비밀번호')
const loginButton = () => screen.getByRole('button', { name: '로그인' })
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })

const signIn = vi.fn(login)

/** 로그인한 뒤 어디로 갈지는 앱이 정한다(LoginReturn.test.tsx). 여기서는 홈으로 보낸다. */
function Login({ sessionEnded = false, initialEmail = '' }) {
  const navigate = useNavigate()
  return (
    <LoginPage
      signIn={signIn}
      onSignedIn={() => navigate('/home', { replace: true })}
      sessionEnded={sessionEnded}
      initialEmail={initialEmail}
    />
  )
}

function routesWith(login: ReactNode): RouteObject[] {
  return [
    { element: <PlainLayout />, children: [{ path: '/login', element: login }] },
    { path: '/home', element: <h1>홈</h1> },
    { path: '/signup', element: <h1>가입</h1> },
  ]
}

function openLogin({ queryClient = createQueryClient(), sessionEnded = false, initialEmail = '' } = {}) {
  const login = <Login sessionEnded={sessionEnded} initialEmail={initialEmail} />
  const router = renderRoutes(routesWith(login), '/login', queryClient)
  return { user: setupUser(), router }
}

/** 로그인 API의 응답을 정하고, 받은 본문을 모아 돌려준다. */
function respondToLogin(respond: () => Response | Promise<Response>) {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/auth/login', async ({ request }) => {
      bodies.push(await request.json())
      return respond()
    }),
  )
  return bodies
}

const success = () => HttpResponse.json({ accessToken: 'token-1' })

async function fill(user: ReturnType<typeof setupUser>, emailValue: string, passwordValue: string) {
  await user.type(email(), emailValue)
  await user.type(password(), passwordValue)
}

async function fillAndSubmit(user: ReturnType<typeof setupUser>) {
  await fill(user, 'name@example.com', 'pass1234')
  await user.click(loginButton())
}

describe('로그인(A-02)의 요소', () => {
  it.each([390, 768, 1280])('폭 %dpx에서 공통 틀 없이 제목과 칸, 버튼을 그린다', (width) => {
    openLogin()
    setViewportWidth(width)
    expect(screen.getByRole('heading', { level: 1, name: '로그인' })).toBeTruthy()
    expect(loginButton().getAttribute('type')).toBe('submit')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
  })

  it('이메일 칸은 입력 형식 이메일, 자동 완성 username이고 자동 대문자와 맞춤법 검사, 자동 고침을 끈다', () => {
    openLogin()
    // type="email"이면 브라우저가 값을 바꿔(한글 도메인을 xn--으로) 쓴 값을 검사할 수 없다
    expect(email().type).toBe('text')
    expect(email().getAttribute('inputmode')).toBe('email')
    expect(email().getAttribute('autocorrect')).toBe('off')
    expect(email().autocomplete).toBe('username')
    expect(email().getAttribute('autocapitalize')).toBe('none')
    expect(email().getAttribute('spellcheck')).toBe('false')
    expect(email().placeholder).toBe('name@example.com')
  })

  it('비밀번호 칸은 가려져 있고 자동 완성이 current-password다', () => {
    openLogin()
    expect(password().type).toBe('password')
    expect(password().autocomplete).toBe('current-password')
  })

  it('비밀번호 칸의 보기 버튼 이름은 "비밀번호 보기"이고, 누르면 "비밀번호 숨기기"다', async () => {
    const { user } = openLogin()
    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(password().type).toBe('text')
    await user.click(screen.getByRole('button', { name: '비밀번호 숨기기' }))
    expect(password().type).toBe('password')
  })

  it('화면을 열면 이메일 칸에 초점을 둔다', () => {
    openLogin()
    expect(document.activeElement).toBe(email())
  })

  it('가입 화면에서 넘어온 이메일이 있으면 채우고 비밀번호 칸에 초점을 둔다', async () => {
    const bodies = respondToLogin(success)
    const { user } = openLogin({ initialEmail: ' Name@example.com' })
    expect(email().value).toBe(' Name@example.com')
    expect(document.activeElement).toBe(password())
    await user.keyboard('pass1234{Enter}')
    await vi.waitFor(() => expect(bodies).toEqual([{ email: ' Name@example.com', password: 'pass1234' }]))
  })

  it('1단계에 없는 요소를 두지 않는다', () => {
    openLogin()
    expect(screen.queryByText('비밀번호를 잊었어요')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('넓은 화면에서는 폭 400px로 가운데에 두고, 휴대폰 배치에서는 폭을 줄이지 않는다', () => {
    openLogin()
    const page = screen.getByRole('main').firstElementChild!
    setViewportWidth(1280)
    const wide = getComputedStyle(page)
    expect(wide.maxWidth).toBe('var(--width-auth)')
    expect(wide.getPropertyValue('margin-inline')).toBe('auto')
    expect(wide.justifyContent).toBe('center')
    setViewportWidth(390)
    expect(getComputedStyle(page).maxWidth).not.toBe('var(--width-auth)')
  })
})

describe('입력값 검사', () => {
  it.each([
    ['', emailRequired],
    ['   ', emailRequired],
    ['\t \f', emailRequired],
    ['name', emailFormat],
    ['@example.com', emailFormat],
    ['name@', emailFormat],
    ['name@@example.com', emailFormat],
    ['a@b@c', emailFormat],
    ['na me@example.com', emailFormat],
    ['name@exam ple.com', emailFormat],
    ['이름@example.com', emailFormat],
    ['name@한글.kr', emailFormat],
    ['na\u200bme@example.com', emailFormat],
    ['na\u0007me@example.com', emailFormat],
    // 소문자로 바꾸면 ASCII k가 되는 켈빈 기호
    ['\u212Aim@example.com', emailFormat],
    // trim()은 지우지만 서버는 거부하는 글자
    ['\u00a0name@example.com', emailFormat],
    ['name@example.com\u00a0', emailFormat],
    ['\ufeffname@example.com', emailFormat],
    ['\u00a0', emailFormat],
    ['\vname@example.com', emailFormat],
  ])('이메일 "%s"로 칸을 벗어나면 "%s"를 보인다', async (value, message) => {
    const { user } = openLogin()
    if (value) await user.paste(value)
    await user.tab()
    expect(screen.getByText(message)).toBeTruthy()
    expect(email().getAttribute('aria-invalid')).toBe('true')
    expect(password().hasAttribute('aria-invalid')).toBe(false)
  })

  it.each([
    'name@example.com',
    '  Name@Example.COM  ',
    '\t\f name@example.com \f\t',
    'a@b',
    "!#$%&'*+/=?^_`{|}~.-@xn--bj0bj06e.kr",
  ])('이메일 "%s"는 맞는 형식이다', async (value) => {
    const { user } = openLogin()
    await user.paste(value)
    await user.tab()
    expect(email().value).toBe(value)
    expect(email().hasAttribute('aria-invalid')).toBe(false)
  })

  it('비밀번호가 빈 채로 칸을 벗어나면 "비밀번호를 입력해 주세요"를 보인다', async () => {
    const { user } = openLogin()
    await user.click(password())
    await user.tab()
    expect(screen.getByText(passwordRequired)).toBeTruthy()
  })

  it.each(['1', ' ', 'a'.repeat(100)])('비밀번호의 길이와 구성은 검사하지 않는다: "%s"', async (value) => {
    const bodies = respondToLogin(success)
    const { user } = openLogin()
    await fill(user, 'name@example.com', value)
    await user.click(loginButton())
    await vi.waitFor(() => expect(bodies).toEqual([{ email: 'name@example.com', password: value }]))
  })

  it('입력하는 동안에는 새 오류를 띄우지 않는다', async () => {
    const { user } = openLogin()
    await user.type(email(), 'name')
    expect(screen.queryByText(emailFormat)).toBeNull()
  })

  it('오류가 보이는 칸은 고칠 때마다 다시 검사해 맞으면 바로 지운다', async () => {
    const { user } = openLogin()
    await user.tab()
    expect(screen.getByText(emailRequired)).toBeTruthy()
    await user.type(email(), 'n')
    expect(screen.queryByText(emailRequired)).toBeNull()
    expect(screen.getByText(emailFormat)).toBeTruthy()
    await user.type(email(), 'ame@example.com')
    expect(screen.queryByText(emailFormat)).toBeNull()
  })

  it('오류 없이 벗어난 칸을 틀리게 고쳐도 칸을 벗어나기 전에는 오류를 띄우지 않는다', async () => {
    const { user } = openLogin()
    await user.type(email(), 'a@b')
    await user.tab()
    await user.click(email())
    await user.keyboard('{Backspace}')
    expect(email().value).toBe('a@')
    expect(screen.queryByText(emailFormat)).toBeNull()
  })

  it('오류를 고친 뒤 다시 틀리게 고쳐도 칸을 벗어나기 전에는 오류를 띄우지 않는다', async () => {
    const { user } = openLogin()
    await user.tab()
    await user.type(email(), 'name@example.com')
    await user.type(email(), '{Backspace>11/}')
    expect(email().value).toBe('name@')
    expect(screen.queryByText(emailFormat)).toBeNull()
    await user.tab()
    expect(screen.getByText(emailFormat)).toBeTruthy()
  })
})

describe('제출할 때의 검사', () => {
  it('빈 채로 누르면 두 오류를 보이고 첫 오류 칸인 이메일로 초점이 가며 보내지 않는다', async () => {
    const bodies = respondToLogin(success)
    const { user } = openLogin()
    await user.click(loginButton())
    expect(screen.getByText(emailRequired)).toBeTruthy()
    expect(screen.getByText(passwordRequired)).toBeTruthy()
    expect(document.activeElement).toBe(email())
    expect(bodies).toEqual([])
  })

  it('이메일이 맞고 비밀번호가 비었으면 비밀번호로 초점이 간다', async () => {
    const { user } = openLogin()
    await user.type(email(), 'name@example.com')
    await user.click(loginButton())
    expect(screen.getByText(passwordRequired)).toBeTruthy()
    expect(document.activeElement).toBe(password())
  })

  it('키보드로 눌러도 첫 오류 칸으로 초점이 간다', async () => {
    const { user } = openLogin()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toBe(loginButton())
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(email())
  })

  it('오류가 있어도 버튼은 누를 수 있다', async () => {
    const { user } = openLogin()
    await user.click(loginButton())
    expect(loginButton().hasAttribute('aria-disabled')).toBe(false)
    expect(loginButton().hasAttribute('disabled')).toBe(false)
  })

  it.each([
    ['로그인', loginButton],
    ['가입', () => screen.getByRole('link', { name: '가입' })],
    ['비밀번호 보기', () => screen.getByRole('button', { name: '비밀번호 보기' })],
  ])('"%s"를 누르는 사이에 오류 문구가 나와 버튼이 밀리지 않는다', async (_, target) => {
    const { user } = openLogin()
    await user.pointer({ keys: '[MouseLeft>]', target: target() })
    expect(screen.queryByText(emailRequired)).toBeNull()
    expect(document.activeElement).toBe(email())
  })

  it('다른 칸을 누르면 벗어난 칸을 검사하고 초점이 옮겨 간다', async () => {
    const { user } = openLogin()
    await user.pointer({ keys: '[MouseLeft>]', target: password() })
    expect(document.activeElement).toBe(password())
    expect(screen.getByText(emailRequired)).toBeTruthy()
  })
})

describe('보내기', () => {
  it('공백과 대문자가 섞인 이메일과 비밀번호를 쓴 그대로 보내고, 화면의 값도 그대로다', async () => {
    const bodies = respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const { user } = openLogin()
    await fill(user, ' Name@Example.COM ', ' Pass 1234 ')
    await user.click(loginButton())
    await screen.findByText(refused)
    expect(bodies).toEqual([{ email: ' Name@Example.COM ', password: ' Pass 1234 ' }])
    expect(email().value).toBe(' Name@Example.COM ')
    expect(password().value).toBe(' Pass 1234 ')
  })

  it('비밀번호 칸에서 엔터를 누르면 로그인 버튼을 누른 것과 같다', async () => {
    const bodies = respondToLogin(success)
    const { user } = openLogin()
    await fill(user, 'name@example.com', 'pass1234{Enter}')
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
  })

  it('브라우저가 양식을 직접 보내 페이지를 새로 열지 않는다', () => {
    openLogin()
    expect(fireEvent.submit(loginButton().closest('form')!)).toBe(false)
  })

  it('입력값을 주소에 싣지 않는다', async () => {
    respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const { user, router } = openLogin()
    await fillAndSubmit(user)
    await screen.findByText(refused)
    expect(router.state.location.search).toBe('')
    expect(email().hasAttribute('name')).toBe(false)
    expect(password().hasAttribute('name')).toBe(false)
  })
})

describe('처리 중', () => {
  it('버튼 안에 돌아가는 원이 보이고 두 칸은 읽기 전용이며 응답이 오면 되돌린다', async () => {
    const answer = Promise.withResolvers<Response>()
    respondToLogin(() => answer.promise)
    const { user } = openLogin()
    await fillAndSubmit(user)

    await vi.waitFor(() => expect(loginButton().getAttribute('aria-busy')).toBe('true'))
    expect(loginButton().querySelector('.status-motion')).toBeTruthy()
    expect(email().readOnly).toBe(true)
    expect(password().readOnly).toBe(true)

    answer.resolve(problem(401, 'INVALID_CREDENTIALS'))
    await screen.findByText(refused)
    expect(loginButton().hasAttribute('aria-busy')).toBe(false)
    expect(email().readOnly).toBe(false)
    expect(password().readOnly).toBe(false)
  })

  it('두 번 누르거나 엔터를 눌러도 한 번만 보낸다', async () => {
    const bodies = respondToLogin(() => new Promise(() => {}))
    const { user } = openLogin()
    await fill(user, 'name@example.com', 'pass1234')
    await user.dblClick(loginButton())
    await user.type(password(), '{Enter}')
    await user.click(loginButton())
    expect(bodies).toHaveLength(1)
  })

  it('처리 중에 "가입"으로 떠나면 로그인이 끝나도 화면을 옮기지 않고 비밀번호를 캐시에 남기지 않는다', async () => {
    const answer = Promise.withResolvers<Response>()
    const bodies = respondToLogin(() => answer.promise)
    const queryClient = createQueryClient()
    const { user, router } = openLogin({ queryClient })
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
    await user.click(screen.getByRole('link', { name: '가입' }))
    answer.resolve(success())
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
    expect(router.state.location.pathname).toBe('/signup')
  })

  /* 거부 문구도 다시 보내는 동안 지우지 않고 새 결과가 올 때까지 남긴다(designer 검토 2026-11-26, #224) */
  it('다시 보내는 동안 앞선 거부 문구를 남기고 로그인만 돈다', async () => {
    const answers = [Promise.resolve(problem(401, 'INVALID_CREDENTIALS')), new Promise<Response>(() => {})]
    const bodies = respondToLogin(() => answers.shift()!)
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByText(refused)
    await user.click(loginButton())
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([refused])
    expect(loginButton().getAttribute('aria-busy')).toBe('true')
  })
})

describe('서버가 거부함', () => {
  it.each([
    ['401 INVALID_CREDENTIALS', () => problem(401, 'INVALID_CREDENTIALS')],
    ['모르는 code의 401', () => problem(401, 'SOMETHING_NEW')],
    ['본문을 읽을 수 없는 401', () => new HttpResponse('<html>', { status: 401 })],
    [
      '400 VALIDATION_FAILED',
      () =>
        problem(400, 'VALIDATION_FAILED', {
          fieldErrors: [{ field: 'email', code: 'INVALID_FORMAT', message: '이메일 형식이 아니다' }],
        }),
    ],
  ])('%s이면 버튼 바로 위에 구분 없는 문구를 보인다', async (_, response) => {
    respondToLogin(response)
    const { user } = openLogin()
    await fillAndSubmit(user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(refused)
    expect(loginButton().previousElementSibling!.contains(alert)).toBe(true)
    expect(email().hasAttribute('aria-invalid')).toBe(false)
    expect(password().hasAttribute('aria-invalid')).toBe(false)
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  })

  it('입력값이 남고 서버가 쓴 문장은 보이지 않는다', async () => {
    respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByText(refused)
    expect(email().value).toBe('name@example.com')
    expect(password().value).toBe('pass1234')
    expect(document.body.textContent).not.toContain('개발자가 읽는 한 줄')
  })

  it('갱신하지 않고 로그인 요청을 한 번만 보낸다', async () => {
    const bodies = respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const refresh = vi.fn(() => problem(401, 'UNAUTHENTICATED'))
    server.use(http.post('/api/v1/auth/refresh', refresh))
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByText(refused)
    expect(bodies).toHaveLength(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('칸을 고쳐도 거부 문구는 다시 보낼 때까지 남는다', async () => {
    respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByText(refused)
    await user.type(email(), 'm')
    await user.type(password(), '5')
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([refused])
  })

  it('다시 보낸 것이 또 거부되면 문구를 새로 그려 다시 읽히게 한다', async () => {
    respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const { user } = openLogin()
    await fillAndSubmit(user)
    const first = await screen.findByRole('alert')
    await user.click(loginButton())
    await vi.waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([refused])
    expect(loginButton().hasAttribute('aria-busy')).toBe(false)
  })

  it('다시 보낸 것이 서버 오류면 거부 문구를 "다시 시도" 문구로 바꾼다', async () => {
    const answers = [problem(401, 'INVALID_CREDENTIALS'), problem(500, 'INTERNAL_ERROR')]
    respondToLogin(() => answers.shift()!)
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByText(refused)
    await user.click(loginButton())
    await screen.findByText(failed)
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([failed])
    expect(retryButton()).toBeTruthy()
  })

  it('비운 채로 다시 누르면 앞선 거부 문구를 지우고 칸의 오류만 보인다', async () => {
    respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByText(refused)
    await user.clear(password())
    await user.click(loginButton())
    expect(screen.getByText(passwordRequired)).toBeTruthy()
    await vi.waitFor(() => expect(screen.queryByText(refused)).toBeNull())
  })
})

describe('연결이 없을 때(00-common 4.3, 1B #238)', () => {
  /** 브라우저의 연결 신호를 앱이 받게 하고 테스트가 끝나면 멈춘다 */
  function watch() {
    const stop = watchConnection()
    onTestFinished(stop)
  }

  it('로그인 버튼은 비활성이고 바로 위에 "연결되면 로그인할 수 있어요"를 보인다. 칸은 쓸 수 있고 엔터로도 보내지 않는다', async () => {
    watch()
    const bodies = respondToLogin(success)
    const { user } = openLogin()
    act(() => goOffline())
    expect(loginButton().getAttribute('aria-disabled')).toBe('true')
    const reason = loginButton().previousElementSibling as HTMLElement
    expect(reason.textContent).toBe(offlineReason)
    expect(reason.getAttribute('role')).toBe('status')
    await fill(user, 'name@example.com', 'pass1234')
    await user.click(loginButton())
    await user.type(password(), '{Enter}')
    expect(bodies).toEqual([])
    expect(email().value).toBe('name@example.com')
    act(() => goOnline())
  })

  it('연결이 돌아오면 그 줄을 지우고 바로 누를 수 있다', async () => {
    watch()
    respondToLogin(success)
    const { user, router } = openLogin()
    act(() => goOffline())
    act(() => goOnline())
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(loginButton().getAttribute('aria-disabled')).toBeNull()
    await fillAndSubmit(user)
    await screen.findByRole('heading', { name: '홈' })
    expect(router.state.location.pathname).toBe('/home')
  })

  it.each([
    ['맞지 않는 비밀번호', () => problem(401, 'INVALID_CREDENTIALS'), refused],
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR'), failed],
  ])('앞선 실패 문구(%s)가 있으면 연결이 끊길 때 안내 줄이 그것을 대신하고, 다시 연결돼도 되살리지 않는다(designer #238)', async (_, respond, message) => {
    watch()
    respondToLogin(respond)
    const { user } = openLogin()
    await fillAndSubmit(user)
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    act(() => goOffline())
    expect(screen.queryByText(message)).toBeNull()
    expect(loginButton().previousElementSibling!.textContent).toBe(offlineReason)
    act(() => goOnline())
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(screen.queryByText(message)).toBeNull()
    expect(loginButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('요청 중에 끊기면 그 줄 대신 "연결이 끊겨 로그인하지 못했어요."와 "다시 시도"(연결이 없는 동안 비활성)를 보이고, 돌아오면 누를 수 있다', async () => {
    watch()
    const answers = [() => HttpResponse.error(), success]
    respondToLogin(() => answers.shift()!())
    const { user, router } = openLogin()
    await fillAndSubmit(user)
    expect((await screen.findByRole('alert')).textContent).toBe(lost)
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    expect(loginButton().getAttribute('aria-disabled')).toBe('true')
    act(() => goOnline())
    expect(retryButton().getAttribute('aria-disabled')).toBeNull()
    await user.click(retryButton())
    await screen.findByRole('heading', { name: '홈' })
    expect(router.state.location.pathname).toBe('/home')
  })
})

describe('서버 오류와 지연', () => {
  it.each([
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['403', () => problem(403, 'ORIGIN_NOT_ALLOWED')],
    ['400 MALFORMED_REQUEST', () => problem(400, 'MALFORMED_REQUEST')],
    ['약속과 다른 200', () => HttpResponse.json({})],
  ])('%s이면 버튼 바로 위에 문구와 "다시 시도"를 보이고 입력값이 남는다', async (_, response) => {
    respondToLogin(response)
    const { user, router } = openLogin()
    await fillAndSubmit(user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(failed)
    const notice = loginButton().previousElementSibling as HTMLElement
    expect(notice.contains(alert)).toBe(true)
    expect(within(notice).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    expect(email().value).toBe('name@example.com')
    expect(password().value).toBe('pass1234')
    expect(router.state.location.pathname).toBe('/login')
  })

  it('15초 동안 응답이 없으면 같은 문구를 보인다', async () => {
    respondToLogin(() => new Promise(() => {}))
    const { user } = openLogin()
    await fill(user, 'name@example.com', 'pass1234')
    holdClock()
    fireEvent.click(loginButton())
    await passTime(14_900)
    expect(screen.queryByRole('alert')).toBeNull()
    await passTime(200)
    expect(screen.getByRole('alert').textContent).toBe(failed)
  })

  it('저절로 다시 보내지 않는다', async () => {
    const bodies = respondToLogin(() => problem(500, 'INTERNAL_ERROR'))
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(bodies).toHaveLength(1)
  })

  it('TanStack이 연결 없음이라고 해도 멈춰 기다리지 않고 실패를 알린다', async () => {
    onlineManager.setOnline(false)
    try {
      respondToLogin(() => problem(500, 'INTERNAL_ERROR'))
      const { user } = openLogin()
      await fillAndSubmit(user)
      expect((await screen.findByRole('alert')).textContent).toBe(failed)
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('"다시 시도"를 누르면 같은 값으로 다시 보낸다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), success]
    const bodies = respondToLogin(() => answers.shift()!())
    const { user, router } = openLogin()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.click(retryButton())
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    expect(bodies).toEqual([
      { email: 'name@example.com', password: 'pass1234' },
      { email: 'name@example.com', password: 'pass1234' },
    ])
  })

  /* 다시 보내는 동안 문구를 남기고 누른 버튼만 도는 표시다(designer 규칙 #102, 계좌 추가·거래 입력과 같다) */
  it('"다시 시도"로 다시 보내는 동안 문구를 둔 채 "다시 시도"만 돌고 로그인은 누를 수 없으며 초점이 남는다', async () => {
    const answers = [Promise.resolve(problem(500, 'INTERNAL_ERROR')), new Promise<Response>(() => {})]
    const bodies = respondToLogin(() => answers.shift()!)
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    retryButton().focus()
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(loginButton().hasAttribute('aria-busy')).toBe(false)
    expect(loginButton().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(retryButton())
    await user.click(loginButton())
    expect(bodies).toHaveLength(2)
  })

  it('로그인을 다시 누르면 문구를 둔 채 로그인만 도는 표시이고 "다시 시도"는 누를 수 없다', async () => {
    const answers = [Promise.resolve(problem(500, 'INTERNAL_ERROR')), new Promise<Response>(() => {})]
    const bodies = respondToLogin(() => answers.shift()!)
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.click(loginButton())
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(loginButton().getAttribute('aria-busy')).toBe('true')
    expect(retryButton().hasAttribute('aria-busy')).toBe(false)
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    await user.click(retryButton())
    expect(bodies).toHaveLength(2)
  })

  it('다시 시도한 것이 또 실패하면 문구를 새로 그려 다시 읽히게 하고 초점은 "다시 시도"에 남는다', async () => {
    const answers = [problem(500, 'INTERNAL_ERROR'), problem(503, 'INTERNAL_ERROR')]
    respondToLogin(() => answers.shift()!)
    const { user } = openLogin()
    await fillAndSubmit(user)
    const first = await screen.findByRole('alert')
    retryButton().focus()
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(retryButton().hasAttribute('aria-busy')).toBe(false)
    expect(loginButton().hasAttribute('aria-disabled')).toBe(false)
    expect(document.activeElement).toBe(retryButton())
  })

  it('다시 보낸 것이 맞지 않는 이메일·비밀번호면 문구를 그것으로 바꾸고 "다시 시도"를 지운다', async () => {
    const answers = [problem(500, 'INTERNAL_ERROR'), problem(401, 'INVALID_CREDENTIALS')]
    respondToLogin(() => answers.shift()!)
    const { user } = openLogin()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.click(retryButton())
    await screen.findByText(refused)
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([refused])
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  })
})

describe('성공', () => {
  it('/home으로 가고 토스트가 없다', async () => {
    respondToLogin(success)
    const { user, router } = openLogin()
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.state).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: '홈' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('이 화면을 떠난 뒤에 성공해도 앱에 로그인을 맡긴 채라 앱이 성공을 안다', async () => {
    const answer = Promise.withResolvers<Response>()
    const bodies = respondToLogin(() => answer.promise)
    const { user } = openLogin()
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
    await user.click(screen.getByRole('link', { name: '가입' }))
    answer.resolve(success())
    expect(signIn).toHaveBeenCalledExactlyOnceWith({ email: 'name@example.com', password: 'pass1234' })
    await expect(signIn.mock.results[0].value).resolves.toBeUndefined()
  })

  it('로그인 뒤 저장소와 쿠키, 주소, 캐시에 토큰과 비밀번호가 남지 않는다', async () => {
    localStorage.clear()
    respondToLogin(success)
    const queryClient = createQueryClient()
    const { user, router } = openLogin({ queryClient })
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    // 로그인했음을 다른 화면이 아는, 뜻이 없는 임의 값 하나만 남는다
    expect({ ...localStorage }).toEqual({ 'akkimpyo-login': expect.stringMatching(/^[0-9a-f]{32}$/) })
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(JSON.stringify(router.state.location)).not.toMatch(/token-1|pass1234/)
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })
})

it('성공한 뒤 다음 화면이 열릴 때까지 다시 누를 수 없다', async () => {
  const bodies = respondToLogin(success)
  const slowHome = { path: '/home', loader: () => new Promise(() => {}), element: null, hydrateFallbackElement: null }
  renderRoutes([{ path: '/login', element: <Login /> }, slowHome], '/login')
  const user = setupUser()
  await fillAndSubmit(user)
  await vi.waitFor(() => expect(bodies).toHaveLength(1))
  await new Promise((resolve) => setTimeout(resolve, 30))
  await user.click(loginButton())
  expect(loginButton().getAttribute('aria-busy')).toBe('true')
  expect(bodies).toHaveLength(1)
})

describe('로그인 풀림 알림', () => {
  const ended = '로그인이 풀렸어요. 다시 로그인해 주세요.'

  it('로그인이 풀려 넘어왔으면 제목 위에 알림 띠를 보인다', () => {
    openLogin({ sessionEnded: true })
    const notice = screen.getByRole('status')
    expect(notice.textContent).toBe(ended)
    const heading = screen.getByRole('heading', { level: 1, name: '로그인' })
    expect(notice.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.queryByText(/쓰던 내용/)).toBeNull()
  })

  it('알림 띠와 제목 사이는 24px이고, 초점은 그대로 이메일 칸에 둔다', () => {
    openLogin({ sessionEnded: true })
    const heading = screen.getByRole('heading', { level: 1, name: '로그인' })
    expect(getComputedStyle(heading.previousElementSibling!).marginBottom).toBe('var(--space-24)')
    expect(document.activeElement).toBe(email())
  })

  it('로그인에 실패해도 화면을 떠날 때까지 남는다', async () => {
    respondToLogin(() => problem(401, 'INVALID_CREDENTIALS'))
    const { user } = openLogin({ sessionEnded: true })
    await fillAndSubmit(user)
    await screen.findByText(refused)
    expect(screen.getByText(ended)).toBeTruthy()
  })

  it('로그인이 풀린 것이 아니면 없다', () => {
    openLogin()
    expect(screen.queryByText(ended)).toBeNull()
  })
})

describe('가입 링크', () => {
  it('"계정이 없나요?" 뒤에 있고 /signup으로 간다', () => {
    openLogin()
    const link = screen.getByRole('link', { name: '가입' })
    expect(link.closest('p')!.textContent).toBe('계정이 없나요? 가입')
    expect(link.getAttribute('href')).toBe('/signup')
  })

  it('입력한 이메일을 주소에 담지 않고 넘긴다', async () => {
    const { user, router } = openLogin()
    await fill(user, 'name@example.com', 'pass1234')
    await user.click(screen.getByRole('link', { name: '가입' }))
    expect(router.state.location.pathname).toBe('/signup')
    expect(router.state.location.search).toBe('')
    expect(router.state.location.hash).toBe('')
    expect(router.state.location.state).toEqual({ email: 'name@example.com' })
  })
})
