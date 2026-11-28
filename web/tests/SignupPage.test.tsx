import { onlineManager } from '@tanstack/react-query'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useNavigate, type RouteObject } from 'react-router'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { watchConnection } from '../src/api/connection'
import { signup } from '../src/api/session'
import { createQueryClient } from '../src/app/queryClient'
import SignupPage from '../src/features/auth/SignupPage'
import { delayed } from './support/backend'
import { readCssRule } from './support/cssRule'
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
  vi.restoreAllMocks()
  signUp.mockClear()
})

const emailRequired = '이메일을 입력해 주세요'
const emailFormat = '이메일 주소 형식을 확인해 주세요'
const passwordRequired = '비밀번호를 입력해 주세요'
const passwordRule = '8자 이상, 영문과 숫자를 함께 써 주세요'
const passwordTooLong = '72자까지 쓸 수 있어요'
const confirmRequired = '비밀번호 확인을 입력해 주세요'
const confirmDifferent = '비밀번호가 서로 달라요'
const nameRequired = '표시 이름을 입력해 주세요'
const nameTooLong = '1자부터 20자까지 쓸 수 있어요'
const nameUnusable = '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'
const duplicate = '이미 가입된 이메일이에요. 로그인해 주세요.'
const notAllowed = '지금은 허용된 이메일만 가입할 수 있어요'
const failed = '문제가 생겨 가입하지 못했어요. 잠시 후 다시 시도해 주세요.'
const lost = '연결이 끊겨 가입하지 못했어요. 연결되면 다시 시도해 주세요.'
const offlineReason = '연결되면 가입할 수 있어요'

const email = () => screen.getByLabelText<HTMLInputElement>('이메일')
const password = () => screen.getByLabelText<HTMLInputElement>('비밀번호')
const confirm = () => screen.getByLabelText<HTMLInputElement>('비밀번호 확인')
const displayName = () => screen.getByLabelText<HTMLInputElement>('표시 이름')
const fields = () => [email(), password(), confirm(), displayName()]
const signupButton = () => screen.getByRole('button', { name: '가입' })
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const loginLink = () => screen.getByRole('link', { name: '로그인' })

/** 칸 바로 아래에 이어진 오류 문구. 없으면 없다. */
function errorOf(input: HTMLInputElement): string | undefined {
  if (!input.hasAttribute('aria-invalid')) return undefined
  const ids = input.getAttribute('aria-describedby')!.split(' ')
  return document.getElementById(ids.at(-1)!)!.textContent
}

const errors = () => fields().map(errorOf)

/** 화면 읽기에 드러난 버튼의 접근성 이름. role로 찾을 때 testing-library가 계산한 이름을 그대로 모은다. */
function buttonNames(): string[] {
  const names = new Map<Element, string>()
  const buttons = screen.getAllByRole('button', {
    name: (name, element) => {
      names.set(element, name)
      return true
    },
  })
  return buttons.map((button) => names.get(button)!)
}

const signUp = vi.fn(signup)

/** 가입한 뒤 어디로 갈지는 앱이 정한다(SignupRoute). 여기서는 /welcome으로 보낸다. */
function Signup({ initialEmail }: { initialEmail: string }) {
  const navigate = useNavigate()
  return (
    <SignupPage
      signUp={signUp}
      onSignedUp={() => navigate('/welcome', { replace: true })}
      initialEmail={initialEmail}
    />
  )
}

function routesWith(initialEmail: string): RouteObject[] {
  return [
    { path: '/signup', element: <Signup initialEmail={initialEmail} /> },
    { path: '/welcome', element: <h1>환영</h1> },
    { path: '/login', element: <h1>로그인</h1> },
  ]
}

function openSignup({ queryClient = createQueryClient(), initialEmail = '' } = {}) {
  const router = renderRoutes(routesWith(initialEmail), '/signup', queryClient)
  return { user: setupUser(), router }
}

/** 가입 API의 응답을 정하고, 받은 본문을 모아 돌려준다. */
function respondToSignup(respond: () => Response | Promise<Response>) {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/auth/signup', async ({ request }) => {
      bodies.push(await request.json())
      return respond()
    }),
  )
  return bodies
}

const success = () => HttpResponse.json({ accessToken: 'token-1' }, { status: 201 })

const refuse =
  (...fieldErrors: [field: string, code: string][]) =>
  () =>
    problem(400, 'VALIDATION_FAILED', {
      fieldErrors: fieldErrors.map(([field, code]) => ({ field, code, message: '개발자가 읽는 글' })),
    })

type User = ReturnType<typeof setupUser>

const valid = { email: 'name@example.com', password: 'pass1234', confirm: 'pass1234', displayName: '이서연' }

async function fill(user: User, values: Partial<typeof valid> = {}) {
  const inputs = { email: email(), password: password(), confirm: confirm(), displayName: displayName() }
  for (const [field, value] of Object.entries({ ...valid, ...values })) {
    await user.click(inputs[field as keyof typeof inputs])
    if (value) await user.paste(value)
  }
}

async function fillAndSubmit(user: User, values: Partial<typeof valid> = {}) {
  await fill(user, values)
  await user.click(signupButton())
}

describe('가입(A-03)의 요소', () => {
  it.each([390, 768, 1280])('폭 %dpx에서 공통 틀 없이 제목과 네 칸, 버튼을 위에서부터 그린다', (width) => {
    openSignup()
    setViewportWidth(width)
    expect(screen.getByRole('heading', { level: 1, name: '가입' })).toBeTruthy()
    expect(signupButton().getAttribute('type')).toBe('submit')
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const all = [...document.querySelectorAll('*')]
    const positions = [...fields(), signupButton(), loginLink()].map((element) => all.indexOf(element))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
  })

  it('이메일 칸은 이메일 키보드, 자동 완성 email이고 자동 대문자와 맞춤법 검사, 자동 고침을 끈다', () => {
    openSignup()
    expect(email().type).toBe('text')
    expect(email().getAttribute('inputmode')).toBe('email')
    expect(email().autocomplete).toBe('email')
    expect(email().getAttribute('autocapitalize')).toBe('none')
    expect(email().getAttribute('autocorrect')).toBe('off')
    expect(email().getAttribute('spellcheck')).toBe('false')
    expect(email().placeholder).toBe('name@example.com')
  })

  it('비밀번호와 비밀번호 확인은 가려져 있고 자동 완성이 new-password이며, 따로 볼 수 있다', async () => {
    const { user } = openSignup()
    for (const input of [password(), confirm()]) {
      expect(input.type).toBe('password')
      expect(input.autocomplete).toBe('new-password')
    }
    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(password().type).toBe('text')
    expect(confirm().type).toBe('password')

    await user.click(screen.getByRole('button', { name: '비밀번호 확인 보기' }))
    expect(confirm().type).toBe('text')

    await user.click(screen.getByRole('button', { name: '비밀번호 숨기기' }))
    expect(password().type).toBe('password')
    expect(confirm().type).toBe('text')
  })

  it('두 칸의 보기 버튼은 칸 이름이 붙어 이름이 서로 다르고, 화면에 같은 이름의 버튼이 둘 없다', async () => {
    const { user } = openSignup()
    expect(buttonNames()).toEqual(expect.arrayContaining(['비밀번호 보기', '비밀번호 확인 보기']))
    expect(buttonNames()).toEqual([...new Set(buttonNames())])

    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    await user.click(screen.getByRole('button', { name: '비밀번호 확인 보기' }))
    expect(buttonNames()).toEqual(expect.arrayContaining(['비밀번호 숨기기', '비밀번호 확인 숨기기']))
    expect(buttonNames()).toEqual([...new Set(buttonNames())])
  })

  it('표시 이름은 자동 고침과 맞춤법 검사만 끄고 자동 완성을 정하지 않는다', () => {
    openSignup()
    expect(displayName().type).toBe('text')
    expect(displayName().getAttribute('autocorrect')).toBe('off')
    expect(displayName().getAttribute('spellcheck')).toBe('false')
    expect(displayName().hasAttribute('autocapitalize')).toBe(false)
    expect(displayName().hasAttribute('autocomplete')).toBe(false)
  })

  it('비밀번호와 표시 이름에만 도움말이 있다', () => {
    openSignup()
    const helps = fields().map((input) => {
      const id = input.getAttribute('aria-describedby')
      return id && document.getElementById(id)!.textContent
    })
    expect(helps).toEqual([null, passwordRule, null, '장부를 함께 쓰는 사람에게 보여요'])
  })

  it('1단계에 없는 요소를 두지 않는다', () => {
    openSignup()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('여는 때', () => {
  it('넘어온 이메일이 없으면 이메일 칸에 초점을 둔다', () => {
    openSignup()
    expect(email().value).toBe('')
    expect(document.activeElement).toBe(email())
  })

  it('넘어온 이메일이 있으면 채우고 비밀번호 칸에 초점을 둔다', () => {
    openSignup({ initialEmail: ' Name@example.com' })
    expect(email().value).toBe(' Name@example.com')
    expect(document.activeElement).toBe(password())
  })
})

describe('이메일 검사', () => {
  it.each([
    ['', emailRequired],
    ['   ', emailRequired],
    ['\t \f', emailRequired],
    ['name', emailFormat],
    ['a@b@c', emailFormat],
    ['na me@example.com', emailFormat],
    ['이름@example.com', emailFormat],
    ['%A0name@example.com', emailFormat],
    [`${'a'.repeat(243)}@example.com`, emailFormat],
  ])('"%s"이면 "%s"를 보인다', async (value, message) => {
    const { user } = openSignup()
    if (value) await user.paste(value.replace('%A0', String.fromCharCode(0xa0)))
    await user.tab()
    expect(errorOf(email())).toBe(message)
  })

  it.each([
    'name@example.com',
    '  Name@Example.COM  ',
    'a@b',
    // 앞뒤 공백을 뺀 254자
    `  ${'a'.repeat(242)}@example.com  `,
  ])('"%s"는 맞는 형식이고 화면의 값을 바꾸지 않는다', async (value) => {
    const { user } = openSignup()
    await user.paste(value)
    await user.tab()
    expect(errorOf(email())).toBeUndefined()
    expect(email().value).toBe(value)
  })
})

describe('비밀번호 검사', () => {
  /** NFKC로 맞추면 한 글자가 되는 분해형(a와 움라우트). 두 글자로 세면 72자를 넘는다. */
  const decomposed = 'a' + String.fromCharCode(0x308)

  it.each([
    ['비었음', '', passwordRequired],
    ['7자', 'abc1234', passwordRule],
    ['숫자 없음', 'abcdefgh', passwordRule],
    ['영문 없음', '12345678', passwordRule],
    ['영문이 아닌 글자와 숫자', '가나다라1234', passwordRule],
    ['영문이 아닌 글자와 영문', 'abcd가나다라', passwordRule],
    ['공백뿐', ' '.repeat(8), passwordRule],
    ['73자', 'a1'.repeat(36) + 'b', passwordTooLong],
    ['73자인데 숫자가 없음', 'a'.repeat(73), passwordTooLong],
    ['이모지도 글자 하나로 센 73자', 'a1' + '\u{1F600}'.repeat(71), passwordTooLong],
    ['맞추면 7자가 되는 분해형', decomposed.repeat(4) + 'b12', passwordRule],
  ])('%s이면 거부한다', async (_, value, message) => {
    const { user } = openSignup()
    await user.click(password())
    if (value) await user.paste(value)
    await user.tab()
    expect(errorOf(password())).toBe(message)
  })

  it.each([
    ['8자', 'abcd1234'],
    ['72자', 'a1'.repeat(36)],
    ['기호와 공백, 한글이 섞임', 'a1 !가나다라'],
    ['전각 영문과 숫자', '\u{FF41}\u{FF42}\u{FF43}\u{FF44}\u{FF11}\u{FF12}\u{FF13}\u{FF14}'],
    ['이모지도 글자 하나로 센 72자', 'a1' + '\u{1F600}'.repeat(70)],
    ['맞추면 72자가 되는 분해형', decomposed.repeat(70) + 'b1'],
  ])('%s이면 받는다', async (_, value) => {
    const { user } = openSignup()
    await user.click(password())
    await user.paste(value)
    await user.tab()
    expect(errorOf(password())).toBeUndefined()
    expect(password().value).toBe(value)
  })
})

describe('비밀번호 확인 검사', () => {
  it('비었으면 "비밀번호 확인을 입력해 주세요"다', async () => {
    const { user } = openSignup()
    await user.click(confirm())
    await user.tab()
    expect(errorOf(confirm())).toBe(confirmRequired)
  })

  it('다르면 "비밀번호가 서로 달라요"다', async () => {
    const { user } = openSignup()
    await fill(user, { confirm: 'pass12345' })
    expect(errorOf(confirm())).toBe(confirmDifferent)
  })

  it('NFKC로 맞춘 값이 같으면 같은 것이다', async () => {
    const { user } = openSignup()
    await fill(user, { password: 'pass1234', confirm: 'pass\u{FF11}\u{FF12}\u{FF13}\u{FF14}' })
    expect(errorOf(confirm())).toBeUndefined()
  })

  it('확인을 쓴 뒤에 비밀번호를 고치고 벗어나면 다시 검사한다', async () => {
    const { user } = openSignup()
    await fill(user)
    expect(errorOf(confirm())).toBeUndefined()
    await user.type(password(), '5')
    expect(errorOf(confirm())).toBeUndefined()
    await user.tab()
    expect(errorOf(confirm())).toBe(confirmDifferent)
  })

  it('비밀번호를 확인과 같게 고치면 확인의 오류를 바로 지운다', async () => {
    const { user } = openSignup()
    await fill(user, { confirm: 'pass12345' })
    expect(errorOf(confirm())).toBe(confirmDifferent)
    await user.type(password(), '5')
    expect(errorOf(confirm())).toBeUndefined()
  })

  it('아직 쓰지 않은 확인 칸은 비밀번호를 벗어나도 검사하지 않는다', async () => {
    const { user } = openSignup()
    await user.click(password())
    await user.paste('pass1234')
    await user.tab()
    expect(errorOf(confirm())).toBeUndefined()
  })
})

describe('표시 이름 검사', () => {
  /** 맥에서 복사한 것 같은 분해형 한글. 조합형이면 20자, 쓴 그대로면 40자다. */
  const decomposedName = '가'.normalize('NFD').repeat(20)

  it.each([
    ['비었음', '', nameRequired],
    ['공백뿐', '   ', nameRequired],
    ['눈에 보이지 않는 공백류뿐', '\u{A0}\u{3000}\u{2003}', nameRequired],
    ['보이지 않는 글자뿐', '\u{3164}', nameUnusable],
    ['가운데의 보이지 않는 글자', '이\u{200B}서연', nameUnusable],
    ['가운데의 탭', '이\t서연', nameUnusable],
    // 서버는 앞뒤의 공백류(Zs)만 지우고 탭과 U+0085는 거부한다(#220)
    ['앞뒤의 탭', '\t이서연\t', nameUnusable],
    ['끝의 U+0085', '이서연\u{85}', nameUnusable],
    ['홀로 선 U+FE0F', '이서연\u{FE0F}', nameUnusable],
    ['21자', '가'.repeat(21), nameTooLong],
    ['21자가 넘는 분해형', '가'.normalize('NFD').repeat(21), nameTooLong],
    // 눈에는 세 글자지만 코드포인트로는 21개
    ['코드포인트로 센 21자', '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}'.repeat(3), nameTooLong],
    ['쓸 수 없는 글자가 있는 21자', '\u{200B}' + '가'.repeat(20), nameUnusable],
  ])('%s이면 거부한다', async (_, value, message) => {
    const { user } = openSignup()
    await user.click(displayName())
    if (value) await user.paste(value)
    await user.tab()
    expect(errorOf(displayName())).toBe(message)
  })

  it.each([
    ['1자', '이'],
    ['20자', '가'.repeat(20)],
    ['앞뒤 공백을 뺀 20자', `  ${'가'.repeat(20)}  `],
    ['앞뒤의 보이지 않는 공백류', '\u{A0}이서연\u{3000}'],
    ['분해형 20자', decomposedName],
    ['이모지', '이서연\u{2764}\u{FE0F}'],
    // 글자마다 코드포인트 하나인 이모지 20개
    ['이모지 20자', '\u{1F600}'.repeat(20)],
  ])('%s이면 받고 화면의 값을 바꾸지 않는다', async (_, value) => {
    const { user } = openSignup()
    await user.click(displayName())
    await user.paste(value)
    await user.tab()
    expect(errorOf(displayName())).toBeUndefined()
    expect(displayName().value).toBe(value)
  })
})

describe('표시 이름의 글자 수', () => {
  const count = () => screen.queryByText(/^\d+\/\d+$/)?.textContent

  async function paste(value: string) {
    const { user } = openSignup()
    await user.click(displayName())
    await user.paste(value)
    return user
  }

  it('16자까지는 보이지 않고 17자부터 보인다', async () => {
    const user = await paste('가'.repeat(16))
    expect(count()).toBeUndefined()
    await user.keyboard('나')
    expect(count()).toBe('17/20')
  })

  it('20자를 넘어도 입력을 막지 않고 넘은 값을 그대로 보인다. 오류는 칸을 벗어날 때 보인다', async () => {
    const user = await paste('가'.repeat(21))
    expect(displayName().value).toBe('가'.repeat(21))
    expect(count()).toBe('21/20')
    expect(errorOf(displayName())).toBeUndefined()
    await user.tab()
    expect(errorOf(displayName())).toBe(nameTooLong)
    expect(count()).toBe('21/20')
  })

  it.each([
    ['앞뒤의 공백류를 빼고 센다', `  ${'가'.repeat(17)}\u{A0}\u{3000}`, '17/20'],
    ['분해형 한글은 맞춘 글자로 센다', '가'.normalize('NFD').repeat(17), '17/20'],
    ['이모지는 코드포인트로 센다', '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}'.repeat(3), '21/20'],
    ['공백류만 있으면 보이지 않는다', ' '.repeat(30), undefined],
  ])('%s', async (_, value, expected) => {
    await paste(value)
    expect(count()).toBe(expected)
  })

  it('표시 이름의 설명에 들어간다', async () => {
    await paste('가'.repeat(17))
    const described = displayName()
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)!.textContent)
    expect(described).toEqual(['장부를 함께 쓰는 사람에게 보여요', '17/20'])
  })

  it('이메일과 비밀번호에는 없다', async () => {
    const { user } = openSignup()
    await fill(user, {
      email: `${'a'.repeat(242)}@example.com`,
      password: 'a1'.repeat(36),
      confirm: 'a1'.repeat(36),
      displayName: '이서연',
    })
    expect(count()).toBeUndefined()
  })
})

describe('검사하는 때', () => {
  it('입력하는 동안에는 새 오류를 띄우지 않고, 보이는 오류는 맞게 고치면 바로 지운다', async () => {
    const { user } = openSignup()
    await user.click(password())
    await user.type(password(), 'abc')
    expect(errorOf(password())).toBeUndefined()
    await user.tab()
    expect(errorOf(password())).toBe(passwordRule)
    await user.type(password(), '12345')
    expect(errorOf(password())).toBeUndefined()
  })

  it.each([
    ['가입', signupButton],
    ['로그인', loginLink],
    ['뒤로', () => screen.getByRole('button', { name: '뒤로' })],
    ['비밀번호 보기', () => screen.getByRole('button', { name: '비밀번호 보기' })],
    ['비밀번호 확인 보기', () => screen.getByRole('button', { name: '비밀번호 확인 보기' })],
  ])('"%s"를 누르는 사이에 오류 문구가 나와 버튼이 밀리지 않는다', async (_, target) => {
    const { user } = openSignup()
    await user.pointer({ keys: '[MouseLeft>]', target: target() })
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
    expect(document.activeElement).toBe(email())
  })
})

describe('제출할 때의 검사', () => {
  it('빈 채로 누르면 네 칸의 오류를 보이고 첫 칸으로 초점이 가며 보내지 않는다', async () => {
    const bodies = respondToSignup(success)
    const { user } = openSignup()
    await user.click(signupButton())
    expect(errors()).toEqual([emailRequired, passwordRequired, confirmRequired, nameRequired])
    expect(document.activeElement).toBe(email())
    expect(bodies).toEqual([])
  })

  it.each([
    ['비밀번호', { password: 'abc', confirm: 'x', displayName: '' }, password],
    ['비밀번호 확인', { confirm: 'x', displayName: '' }, confirm],
    ['표시 이름', { displayName: '' }, displayName],
  ])('위에서부터 첫 오류 칸인 %s로 초점이 간다', async (_, values, input) => {
    const bodies = respondToSignup(success)
    const { user } = openSignup()
    await fillAndSubmit(user, values)
    expect(document.activeElement).toBe(input())
    expect(bodies).toEqual([])
  })

  it('첫 오류 칸에 이미 초점이 있어도 그 칸이 보이게 스크롤한다', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { user } = openSignup()
    expect(document.activeElement).toBe(email())
    await user.click(signupButton())
    expect(scroll.mock.contexts).toEqual([email()])
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('제출할 때 맞던 칸은 틀리게 고쳐도 칸을 벗어나기 전에는 오류를 띄우지 않는다', async () => {
    const { user } = openSignup()
    await fillAndSubmit(user, { email: 'a@b', displayName: '' })
    await user.type(email(), '{Backspace}')
    expect(email().value).toBe('a@')
    expect(errorOf(email())).toBeUndefined()
    await user.tab()
    expect(errorOf(email())).toBe(emailFormat)
  })

  it('오류가 있어도 버튼은 누를 수 있다', async () => {
    const { user } = openSignup()
    await user.click(signupButton())
    expect(signupButton().hasAttribute('aria-disabled')).toBe(false)
    expect(signupButton().hasAttribute('disabled')).toBe(false)
  })

  it.each([
    ['이메일', email],
    ['비밀번호', password],
    ['비밀번호 확인', confirm],
    ['표시 이름', displayName],
  ])('%s 칸에서 엔터를 누르면 가입 버튼을 누른 것과 같다', async (_, input) => {
    const bodies = respondToSignup(delayed().respond)
    const { user } = openSignup()
    await fill(user)
    await user.type(input(), '{Enter}')
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
  })

  it('브라우저가 양식을 직접 보내 페이지를 새로 열지 않는다', () => {
    openSignup()
    expect(fireEvent.submit(signupButton().closest('form')!)).toBe(false)
  })
})

describe('보내기', () => {
  it('이메일과 비밀번호를 쓴 그대로 보내고, 비밀번호 확인은 보내지 않으며, 화면의 값도 그대로다', async () => {
    const bodies = respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
    const { user } = openSignup()
    const typed = {
      email: ' Name@Example.COM ',
      password: ' \u{FF41}bc 1234 ',
      confirm: ' abc 1234 ',
      displayName: ' 이서연\u{3000}',
    }
    await fillAndSubmit(user, typed)
    await screen.findByText(failed)
    expect(bodies).toEqual([
      { email: ' Name@Example.COM ', password: ' \u{FF41}bc 1234 ', displayName: ' 이서연\u{3000}' },
    ])
    expect(fields().map((input) => input.value)).toEqual(Object.values(typed))
  })

  it('분해형 한글 20자인 표시 이름은 조합형으로 맞춰 보내고, 화면의 값은 그대로다', async () => {
    const bodies = respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
    const { user } = openSignup()
    const decomposed = '가'.normalize('NFD').repeat(20)
    expect(decomposed).toHaveLength(40)
    await fillAndSubmit(user, { displayName: ` ${decomposed} ` })
    await screen.findByText(failed)
    expect(bodies).toEqual([{ email: valid.email, password: valid.password, displayName: ` ${'가'.repeat(20)} ` }])
    expect(displayName().value).toBe(` ${decomposed} `)
  })

  it('입력값을 주소에 싣지 않는다', async () => {
    respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
    const { user, router } = openSignup()
    await fillAndSubmit(user)
    await screen.findByText(failed)
    expect(router.state.location.search).toBe('')
    for (const input of fields()) expect(input.hasAttribute('name')).toBe(false)
  })
})

describe('처리 중', () => {
  it('버튼 안에 돌아가는 원이 보이고 네 칸은 읽기 전용이며 응답이 오면 되돌린다', async () => {
    const answer = Promise.withResolvers<Response>()
    respondToSignup(() => answer.promise)
    const { user } = openSignup()
    await fillAndSubmit(user)

    await vi.waitFor(() => expect(signupButton().getAttribute('aria-busy')).toBe('true'))
    expect(signupButton().querySelector('.status-motion')).toBeTruthy()
    expect(fields().map((input) => input.readOnly)).toEqual([true, true, true, true])

    answer.resolve(problem(500, 'INTERNAL_ERROR'))
    await screen.findByText(failed)
    expect(signupButton().hasAttribute('aria-busy')).toBe(false)
    expect(fields().map((input) => input.readOnly)).toEqual([false, false, false, false])
  })

  it('두 번 누르거나 엔터를 눌러도 한 번만 보낸다', async () => {
    const bodies = respondToSignup(delayed().respond)
    const { user } = openSignup()
    await fill(user)
    await user.dblClick(signupButton())
    await user.type(displayName(), '{Enter}')
    await user.click(signupButton())
    expect(bodies).toHaveLength(1)
  })

  it('처리 중에 "로그인"으로 떠나면 가입이 끝나도 화면을 옮기지 않고 비밀번호를 캐시에 남기지 않는다', async () => {
    const answer = Promise.withResolvers<Response>()
    const bodies = respondToSignup(() => answer.promise)
    const queryClient = createQueryClient()
    const { user, router } = openSignup({ queryClient })
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
    await user.click(loginLink())
    answer.resolve(success())
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
    expect(router.state.location.pathname).toBe('/login')
    await expect(signUp.mock.results[0].value).resolves.toBeUndefined()
  })
})

describe('서버가 거부함', () => {
  it.each([
    ['이미 가입된 이메일', ['email', 'DUPLICATE'], email, duplicate],
    ['허용 목록 밖 이메일', ['email', 'NOT_ALLOWED'], email, notAllowed],
    ['이메일의 형식', ['email', 'INVALID_FORMAT'], email, emailFormat],
    ['이메일의 모르는 code', ['email', 'SOMETHING_NEW'], email, emailFormat],
    ['비밀번호의 길이', ['password', 'TOO_LONG'], password, passwordTooLong],
    ['비밀번호의 구성', ['password', 'INVALID_FORMAT'], password, passwordRule],
    ['비밀번호의 모르는 code', ['password', 'constructor'], password, passwordRule],
    ['표시 이름의 길이', ['displayName', 'TOO_LONG'], displayName, nameTooLong],
    ['빈 표시 이름', ['displayName', 'REQUIRED'], displayName, nameRequired],
    ['표시 이름의 글자', ['displayName', 'INVALID_FORMAT'], displayName, nameUnusable],
  ] as const)('%s은 그 칸 아래에 보이고 초점이 그 칸으로 간다', async (_, [field, code], input, message) => {
    respondToSignup(refuse([field, code]))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(errorOf(input())).toBe(message))
    expect(fields().filter((other) => errorOf(other) !== undefined)).toEqual([input()])
    expect(document.activeElement).toBe(input())
    await vi.waitFor(() => expect(signupButton().hasAttribute('aria-busy')).toBe(false))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  })

  it('여러 칸이 함께 오면 모두 보이고 위에서부터 첫 칸으로 초점이 간다', async () => {
    respondToSignup(refuse(['displayName', 'TOO_LONG'], ['something', 'NEW'], ['password', 'TOO_LONG']))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(errors()).toEqual([undefined, passwordTooLong, undefined, nameTooLong]))
    expect(document.activeElement).toBe(password())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('입력값이 비밀번호까지 남고 서버가 쓴 문장은 보이지 않는다', async () => {
    respondToSignup(refuse(['email', 'DUPLICATE']))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByText(duplicate)
    expect(fields().map((input) => input.value)).toEqual(Object.values(valid))
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })

  it('문구 옆에 링크를 더 두지 않는다', async () => {
    respondToSignup(refuse(['email', 'DUPLICATE']))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByText(duplicate)
    expect(screen.getAllByRole('link')).toEqual([loginLink()])
  })

  it('그 칸의 값을 고치면 문구가 사라지고, 다른 칸을 고치면 남는다', async () => {
    respondToSignup(refuse(['email', 'NOT_ALLOWED']))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByText(notAllowed)
    await user.type(displayName(), '씨')
    expect(errorOf(email())).toBe(notAllowed)
    await user.type(email(), 'm')
    expect(errorOf(email())).toBeUndefined()
  })

  it('고치지 않은 값도 다시 보낼 수 있고, 보내는 동안 앞선 문구를 지운다', async () => {
    const answers = [refuse(['email', 'NOT_ALLOWED']), delayed().respond]
    const bodies = respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByText(notAllowed)
    await vi.waitFor(() => expect(signupButton().hasAttribute('aria-busy')).toBe(false))
    await user.click(signupButton())
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    expect(screen.queryByText(notAllowed)).toBeNull()
  })

  it('다른 칸을 비운 채 다시 누르면 앞선 거부 문구를 지우고 칸의 오류만 보인다', async () => {
    respondToSignup(refuse(['email', 'DUPLICATE']))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByText(duplicate)
    await vi.waitFor(() => expect(signupButton().hasAttribute('aria-busy')).toBe(false))
    await user.clear(displayName())
    await user.click(signupButton())
    expect(errors()).toEqual([undefined, undefined, undefined, nameRequired])
    expect(document.activeElement).toBe(displayName())
  })
})

describe('연결이 없을 때(00-common 4.3, 1B #238)', () => {
  /** 브라우저의 연결 신호를 앱이 받게 하고 테스트가 끝나면 멈춘다 */
  function watch() {
    onTestFinished(watchConnection())
  }

  it('가입 버튼은 비활성이고 바로 위에 "연결되면 가입할 수 있어요"를 보인다. 칸은 쓸 수 있고 엔터로도 보내지 않는다', async () => {
    watch()
    const bodies = respondToSignup(success)
    const { user } = openSignup()
    act(() => goOffline())
    expect(signupButton().getAttribute('aria-disabled')).toBe('true')
    expect(signupButton().previousElementSibling!.textContent).toBe(offlineReason)
    await fill(user)
    await user.click(signupButton())
    await user.type(displayName(), '{Enter}')
    expect(bodies).toEqual([])
    expect(fields().map((input) => input.value)).toEqual(Object.values(valid))
    act(() => goOnline())
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(signupButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('요청 중에 끊기면 그 줄 대신 "연결이 끊겨 가입하지 못했어요."와 "다시 시도"(연결이 없는 동안 비활성)를 보이고 초점을 옮긴다', async () => {
    watch()
    const answers = [() => HttpResponse.error(), success]
    const bodies = respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    expect((await screen.findByRole('alert')).textContent).toBe(lost)
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(document.activeElement).toBe(retryButton())
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    expect(fields().map((input) => input.value)).toEqual(Object.values(valid))
    act(() => goOnline())
    expect(retryButton().getAttribute('aria-disabled')).toBeNull()
    await user.click(retryButton())
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
  })
})

describe('서버 오류와 지연', () => {
  it.each([
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['403', () => problem(403, 'ORIGIN_NOT_ALLOWED')],
    ['400 MALFORMED_REQUEST', () => problem(400, 'MALFORMED_REQUEST')],
    ['모르는 입력란만 온 400', refuse(['something', 'NEW'])],
    ['입력란이 이름에서 온 값인 400', refuse(['constructor', 'DUPLICATE'])],
    ['입력란이 없는 400', refuse()],
    ['입력란을 담은 다른 code', () => problem(409, 'INVALID_STATE', { fieldErrors: [{ field: 'email', code: 'DUPLICATE' }] })],
    ['약속과 다른 201', () => HttpResponse.json({}, { status: 201 })],
  ])('%s이면 버튼 바로 위에 문구와 "다시 시도"를 보이고 입력값이 남는다', async (_, response) => {
    respondToSignup(response)
    const { user, router } = openSignup()
    await fillAndSubmit(user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(failed)
    const notice = signupButton().previousElementSibling as HTMLElement
    expect(notice.contains(alert)).toBe(true)
    expect(within(notice).getByRole('button', { name: '다시 시도' })).toBeTruthy()
    expect(fields().map((input) => input.value)).toEqual(Object.values(valid))
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
    expect(router.state.location.pathname).toBe('/signup')
  })

  it('초점이 "다시 시도"로 가서 화면 키보드가 내려간다', async () => {
    respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
    const { user } = openSignup()
    await fill(user)
    await user.type(displayName(), '{Enter}')
    await screen.findByRole('alert')
    expect(document.activeElement).toBe(retryButton())
  })

  it('다시 실패해도 초점이 "다시 시도"로 간다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), () => problem(503, 'INTERNAL_ERROR')]
    const bodies = respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(bodies).toHaveLength(2))
    await vi.waitFor(() => expect(document.activeElement).toBe(retryButton()))
  })

  it('15초 동안 응답이 없으면 같은 문구를 보인다', async () => {
    respondToSignup(delayed().respond)
    const { user } = openSignup()
    await fill(user)
    holdClock()
    fireEvent.click(signupButton())
    await passTime(14_900)
    expect(screen.queryByRole('alert')).toBeNull()
    await passTime(200)
    expect(screen.getByRole('alert').textContent).toBe(failed)
  })

  it('저절로 다시 보내지 않는다', async () => {
    const bodies = respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(bodies).toHaveLength(1)
  })

  it('TanStack이 연결 없음이라고 해도 멈춰 기다리지 않고 실패를 알린다', async () => {
    onlineManager.setOnline(false)
    try {
      respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
      const { user } = openSignup()
      await fillAndSubmit(user)
      expect((await screen.findByRole('alert')).textContent).toBe(failed)
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('"다시 시도"를 누르면 화면에 보이는 값으로 다시 보낸다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), success]
    const bodies = respondToSignup(() => answers.shift()!())
    const { user, router } = openSignup()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.type(displayName(), ' 둘')
    await user.click(retryButton())
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    expect(bodies).toEqual([
      { email: 'name@example.com', password: 'pass1234', displayName: '이서연' },
      { email: 'name@example.com', password: 'pass1234', displayName: '이서연 둘' },
    ])
  })

  it('틀리게 고친 채 "다시 시도"를 누르면 보내지 않고 칸의 오류를 보인다', async () => {
    const bodies = respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.clear(email())
    await user.click(retryButton())
    expect(errorOf(email())).toBe(emailRequired)
    expect(document.activeElement).toBe(email())
    expect(bodies).toHaveLength(1)
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  /* 다시 보내는 동안 문구를 남기고 누른 버튼만 도는 표시다(designer 규칙 #102, 계좌 추가·거래 입력과 같다) */
  it('"다시 시도"로 다시 보내는 동안 문구를 둔 채 "다시 시도"만 돌고 가입은 누를 수 없으며 초점이 남는다', async () => {
    const answer = delayed()
    const answers = [() => problem(500, 'INTERNAL_ERROR'), answer.respond]
    const bodies = respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.keyboard('{Enter}')
    await answer.arrived
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(retryButton().getAttribute('aria-busy')).toBe('true')
    expect(signupButton().hasAttribute('aria-busy')).toBe(false)
    expect(signupButton().getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(retryButton())
    await user.click(signupButton())
    expect(bodies).toHaveLength(2)
  })

  it('가입을 다시 누르면 문구를 둔 채 가입만 도는 표시이고 "다시 시도"는 누를 수 없다', async () => {
    const answer = delayed()
    const answers = [() => problem(500, 'INTERNAL_ERROR'), answer.respond]
    const bodies = respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByRole('alert')
    await user.click(signupButton())
    await answer.arrived
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(signupButton().getAttribute('aria-busy')).toBe('true')
    expect(retryButton().hasAttribute('aria-busy')).toBe(false)
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    await user.click(retryButton())
    expect(bodies).toHaveLength(2)
  })

  it('칸을 고치다 "다시 시도"를 눌러 또 실패하면 문구를 새로 그려 다시 읽히게 하고 초점이 "다시 시도"로 간다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), () => problem(503, 'INTERNAL_ERROR')]
    respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    const first = await screen.findByRole('alert')
    await user.type(displayName(), ' 둘')
    // 마우스로 누르면 쓰던 칸에 초점이 남는다
    await user.click(retryButton())
    await vi.waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(document.activeElement).toBe(retryButton())
  })

  it('칸에서 엔터로 다시 보낸 것이 또 실패해도 초점이 "다시 시도"로 간다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), () => problem(503, 'INTERNAL_ERROR')]
    const bodies = respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    const first = await screen.findByRole('alert')
    await user.type(displayName(), '{Enter}')
    await vi.waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(bodies).toHaveLength(2)
    expect(document.activeElement).toBe(retryButton())
  })

  it('거부된 뒤 다시 보낸 것이 서버 오류면 거부 문구를 지우고 실패를 알린다', async () => {
    const answers = [refuse(['email', 'DUPLICATE']), () => problem(500, 'INTERNAL_ERROR')]
    respondToSignup(() => answers.shift()!())
    const { user } = openSignup()
    await fillAndSubmit(user)
    await screen.findByText(duplicate)
    await vi.waitFor(() => expect(signupButton().hasAttribute('aria-busy')).toBe(false))
    await user.click(signupButton())
    await screen.findByRole('alert')
    expect(screen.queryByText(duplicate)).toBeNull()
  })
})

describe('성공', () => {
  it('/welcome으로 가고 토스트가 없다', async () => {
    respondToSignup(success)
    const { user, router } = openSignup()
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    // 주소는 화면보다 먼저 바뀐다. 환영에만 있는 제목이 그려지기를 기다린다(#275, #291)
    expect(await screen.findByRole('heading', { level: 1, name: '환영' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('저장소와 쿠키, 주소, 캐시에 토큰과 비밀번호가 남지 않는다', async () => {
    respondToSignup(success)
    const queryClient = createQueryClient()
    const { user, router } = openSignup({ queryClient })
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    // 로그인했음을 다른 화면이 아는, 뜻이 없는 임의 값 하나만 남는다
    expect({ ...localStorage }).toEqual({ 'akkimpyo-login': expect.stringMatching(/^[0-9a-f]{32}$/) })
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
    expect(JSON.stringify(router.state.location)).not.toMatch(/token-1|pass1234|name@example/)
    await vi.waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })

  it('다음 화면이 열릴 때까지 다시 누를 수 없다', async () => {
    const bodies = respondToSignup(success)
    const slowWelcome = { path: '/welcome', loader: () => new Promise(() => {}), element: null, hydrateFallbackElement: null }
    renderRoutes([{ path: '/signup', element: <Signup initialEmail="" /> }, slowWelcome], '/signup')
    const user = setupUser()
    await fillAndSubmit(user)
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    await user.click(signupButton())
    expect(signupButton().getAttribute('aria-busy')).toBe('true')
    expect(bodies).toHaveLength(1)
  })
})

describe('"뒤로"와 로그인 링크', () => {
  it('앞서 본 화면이 없으면 "뒤로"는 로그인으로 간다. 쓴 값이 있어도 묻지 않는다', async () => {
    const { user, router } = openSignup()
    await fill(user)
    await user.click(screen.getByRole('button', { name: '뒤로' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.historyAction).toBe('REPLACE')
    expect(router.state.location.state).toBeNull()
  })

  it('"이미 계정이 있나요?" 뒤에 로그인 링크가 있다', () => {
    openSignup()
    expect(loginLink().closest('p')!.textContent).toBe('이미 계정이 있나요? 로그인')
    expect(loginLink().getAttribute('href')).toBe('/login')
  })

  it('로그인 링크는 입력한 이메일만 주소에 담지 않고 넘긴다', async () => {
    const { user, router } = openSignup()
    await fill(user)
    await user.click(loginLink())
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.search).toBe('')
    expect(router.state.location.hash).toBe('')
    expect(router.state.location.state).toEqual({ email: 'name@example.com' })
  })
})

describe('배치', () => {
  const bottom = () => signupButton().parentElement!

  it('휴대폰 배치는 칸만 스크롤하고 가입 버튼과 로그인 링크를 화면 맨 아래에 함께 고정한다', () => {
    openSignup()
    setViewportWidth(390)
    expect(bottom().contains(loginLink())).toBe(true)
    const scroller = bottom().previousElementSibling!
    expect(fields().every((input) => scroller.contains(input))).toBe(true)
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
    const form = bottom().parentElement!
    expect(getComputedStyle(form).height).toBe('calc(100dvh - var(--size-topbar) - env(safe-area-inset-top))')
    expect(getComputedStyle(bottom()).backgroundColor).toBe('var(--color-surface)')
    expect(readCssRule('src/features/auth/SignupPage.module.css', '.bottom')).toContain(
      'border-top: 1px solid var(--color-border);',
    )
  })

  it('서버 오류 문구와 "다시 시도"는 고정한 영역 안에 있다', async () => {
    respondToSignup(() => problem(500, 'INTERNAL_ERROR'))
    const { user } = openSignup()
    await fillAndSubmit(user)
    expect(bottom().contains(await screen.findByRole('alert'))).toBe(true)
    expect(bottom().contains(retryButton())).toBe(true)
  })

  it('넓은 화면은 폭 400px로 가운데에 두고 버튼을 고정하지 않으며 면과 선이 없다', () => {
    openSignup()
    setViewportWidth(1280)
    const style = getComputedStyle(bottom())
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style.borderTopWidth).toBe('0px')
    expect(getComputedStyle(bottom().previousElementSibling!).overflowY).toBe('visible')
    expect(getComputedStyle(bottom().parentElement!).height).toBe('auto')
    const page = getComputedStyle(screen.getByRole('main').parentElement!)
    expect(page.maxWidth).toContain('var(--width-auth)')
    expect(page.getPropertyValue('margin-inline')).toBe('auto')
    expect(page.justifyContent).toBe('center')
  })

  it('휴대폰 배치는 폭을 줄이지 않는다', () => {
    openSignup()
    setViewportWidth(390)
    expect(getComputedStyle(screen.getByRole('main').parentElement!).maxWidth).not.toContain('var(--width-auth)')
  })
})
