import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountOf, accountsBody, startAccounts, type Accounts } from './support/accounts'
import { delayed, ledgerIdOf, startBackend, type Backend } from './support/backend'
import { untilOpened, untilUnshielded } from './support/dialog'
import { startGuardClock, stopGuardClock } from './support/guardClock'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { createFakeLocks, installLocks, removeLocks } from './support/webLocks'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

const nameRequired = '이름을 입력해 주세요'
const nameTooLong = '50자까지 쓸 수 있어요'
const nameUnusable = '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'
const nameDuplicate = '같은 이름의 계좌가 있어요. 다른 이름을 써 주세요.'
const amountRequired = '금액을 입력해 주세요. 없으면 0을 적어요.'
const amountTooLarge = '9,999,999,999원까지 입력할 수 있어요'
const dateRequired = '기준일을 골라 주세요'
const dateOutOfRange = '2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요'
const typeNotice = '종류를 바꾸면 금액의 뜻이 바뀌어요. 금액을 다시 확인해 주세요.'
const failed = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const question = '쓰던 내용을 버릴까요?'

const server = startMockServer()
let backend: Backend
let accounts: Accounts

beforeEach(() => {
  startGuardClock(new Date(2026, 10, 26, 12))
  vi.stubGlobal('scrollTo', vi.fn())
  installMatchMedia(390)
  installLocks(createFakeLocks())
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
  accounts = startAccounts(server, backend)
  accounts.items = [accountOf('비상금', 'BANK', 1000000)]
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  stopGuardClock()
  resetViewport()
  removeLocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type Opened = Awaited<ReturnType<typeof openApp>>
type User = Opened['user']

const name = () => screen.getByLabelText<HTMLInputElement>('이름')
const type = (label: string) => screen.getByRole('radio', { name: label })
const typeGroup = () => screen.getByRole('radiogroup', { name: '종류' })
const balance = () => screen.getByLabelText<HTMLInputElement>('시작 잔액')
const owed = () => screen.getByLabelText<HTMLInputElement>('지금 갚을 금액')
const sign = () => screen.getByRole('button', { name: '마이너스' })
const date = () => screen.getByRole<HTMLButtonElement>('button', { name: /^기준일/ })
const saveButton = () => screen.getByRole('button', { name: '저장' })
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const closeButton = () => screen.getByRole('button', { name: '닫기' })
/** 넓은 화면의 사이드바에 있다 */
const logoutButton = () => screen.getByRole('button', { name: '로그아웃', hidden: true })
const dialog = () => screen.queryByRole('dialog', { name: question })
const settle = (ms = 50) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const path = ({ router }: Opened) => router.state.location.pathname

/** 칸 아래에 이어진 오류 문구. 없으면 없다. */
function errorOf(control: HTMLElement): string | undefined {
  const ids = control.getAttribute('aria-describedby')?.split(' ') ?? []
  const message = ids.map((id) => document.getElementById(id)!).find((element) => element.querySelector('svg'))
  return message?.textContent
}

const controls = () => [name(), typeGroup(), screen.getByRole('textbox', { name: / 원$/ }), date()]
const errors = () => controls().map(errorOf)

async function open(path = '/accounts/new') {
  const opened = await openApp(path)
  await screen.findByRole('heading', { level: 1, name: '계좌 추가' })
  return opened
}

/** 계좌 목록에서 "추가"를 눌러 연다. */
async function openFromList() {
  const opened = await openApp('/accounts')
  await screen.findByText('자산 합계')
  await opened.user.click(screen.getByRole('link', { name: '추가' }))
  await screen.findByRole('heading', { level: 1, name: '계좌 추가' })
  return opened
}

async function fill(user: User, { name: typed = '급여통장', amount = '350000' } = {}) {
  await user.click(name())
  await user.paste(typed)
  await user.click(balance())
  await user.keyboard(amount)
}

async function fillAndSave(user: User, values?: Parameters<typeof fill>[1]) {
  await fill(user, values)
  await user.click(saveButton())
}

const refuse =
  (...fieldErrors: [field: string, code: string][]) =>
  () =>
    problem(400, 'VALIDATION_FAILED', {
      fieldErrors: fieldErrors.map(([field, code]) => ({ field, code, message: '개발자가 읽는 글' })),
    })

const savedBody = () => accounts.added[0]?.body

describe('여는 길', () => {
  it('계좌 목록 상단 바의 "추가"로 연다', async () => {
    const opened = await openFromList()
    expect(path(opened)).toBe('/accounts/new')
  })

  it('계좌가 없으면 "계좌 추가"로도 연다', async () => {
    accounts.items = []
    const opened = await openApp('/accounts')
    await opened.user.click(await screen.findByRole('link', { name: '계좌 추가' }))
    expect(await screen.findByRole('heading', { level: 1, name: '계좌 추가' })).toBeTruthy()
  })

  it('하단 탭이 없고 사이드바는 그대로다', async () => {
    await open()
    setViewportWidth(390)
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
    setViewportWidth(1280)
    expect(screen.getByRole('link', { name: '계좌' }).getAttribute('aria-current')).toBe('page')
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 돌아온다', async () => {
    backend.cookieUser = undefined
    const opened = await openApp('/accounts/new')
    await opened.user.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { level: 1, name: '계좌 추가' })).toBeTruthy()
  })
})

describe('요소와 처음 값', () => {
  it('이름, 종류, 시작 잔액, 기준일, 저장이 위에서부터 놓인다', async () => {
    await open()
    const all = [...document.querySelectorAll('*')]
    const positions = [name(), typeGroup(), sign(), balance(), date(), saveButton()].map((each) => all.indexOf(each))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
  })

  it('이름은 비어 있고 흐린 예시와 도움말이 있으며, 사람 이름으로 자동 완성하지 않는다', async () => {
    await open()
    expect(name().value).toBe('')
    expect(name().placeholder).toBe('예: 국민은행 급여통장')
    expect(screen.getByText('1~50자')).toBeTruthy()
    expect(name().autocomplete).toBe('off')
  })

  it('종류는 은행, 카드, 현금이고 은행이 골라져 있다', async () => {
    await open()
    expect(within(typeGroup()).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['은행', '카드', '현금'])
    expect(type('은행').getAttribute('aria-checked')).toBe('true')
  })

  it('시작 잔액은 0이고 부호는 +다', async () => {
    await open()
    expect(balance().value).toBe('0')
    expect(sign().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('마이너스 통장이면 -로 바꿔 적어요')).toBeTruthy()
  })

  it('기준일은 기기의 오늘이다', async () => {
    await open()
    expect(date().textContent).toBe('11월 26일 (목)')
    expect(screen.getByText('이날부터의 거래가 잔액에 들어가요')).toBeTruthy()
  })

  it('여는 때 초점을 두지 않고 오류와 알림이 없다', async () => {
    await open()
    expect(document.activeElement).toBe(document.body)
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(typeNotice)).toBeNull()
  })
})

describe('이름', () => {
  const count = () => screen.queryByText(/^\d+\/50$/)?.textContent

  it.each([
    ['비었음', '', nameRequired],
    ['공백류뿐', ' \u{A0}\u{3000}', nameRequired],
    ['51자', '가'.repeat(51), nameTooLong],
    ['보이지 않는 글자', '급여\u{200B}통장', nameUnusable],
  ])('%s이면 칸을 벗어날 때 알린다', async (_, value, message) => {
    const { user } = await open()
    await user.click(name())
    if (value) await user.paste(value)
    expect(errorOf(name())).toBeUndefined()
    await user.tab()
    expect(errorOf(name())).toBe(message)
    expect(name().value).toBe(value)
  })

  it('40자까지는 글자 수가 보이지 않고 41자부터 보인다. 앞뒤 공백을 빼고 조합형으로 센다', async () => {
    const { user } = await open()
    await user.click(name())
    await user.paste(`  ${'가'.normalize('NFD').repeat(40)}\u{A0}`)
    expect(count()).toBeUndefined()
    await user.clear(name())
    await user.paste(`  ${'가'.normalize('NFD').repeat(41)}\u{A0}`)
    expect(count()).toBe('41/50')
  })

  it('50자를 넘어도 입력을 막지 않는다', async () => {
    const { user } = await open()
    await user.click(name())
    await user.paste('가'.repeat(60))
    expect(name().value).toBe('가'.repeat(60))
    expect(count()).toBe('60/50')
  })
})

describe('종류', () => {
  it('카드로 바꾸면 갚을 금액을 묻고 부호 버튼이 없다. 쓴 금액은 그대로다', async () => {
    const { user } = await open()
    await user.click(balance())
    await user.keyboard('350000')
    await user.click(type('카드'))
    expect(screen.queryByLabelText('시작 잔액')).toBeNull()
    expect(owed().value).toBe('350,000')
    expect(screen.getByText('카드는 지금 갚을 금액을 적어요')).toBeTruthy()
    expect(screen.queryByText('마이너스 통장이면 -로 바꿔 적어요')).toBeNull()
    expect(screen.queryByRole('button', { name: '마이너스' })).toBeNull()
  })

  it('카드와 은행·현금 사이를 바꾼 뒤에만 금액을 확인하라고 알린다', async () => {
    const { user } = await open()
    const notice = () => screen.queryByText(typeNotice)
    await user.click(type('현금'))
    expect(notice()).toBeNull()
    await user.click(type('카드'))
    expect(notice()).toBeTruthy()
    await user.click(type('은행'))
    expect(notice()).toBeTruthy()
  })

  it('알림은 종류 바로 아래의 늘 있는 알림 영역에 나온다', async () => {
    const { user } = await open()
    const region = within(screen.getByRole('main')).getByRole('status')
    expect(region.textContent).toBe('')
    expect(region.previousElementSibling).toBe(typeGroup())
    await user.click(type('카드'))
    expect(region.textContent).toBe(typeNotice)
    expect(getComputedStyle(region).font).toBe('var(--text-caption)')
    expect(getComputedStyle(region).color).toBe('var(--color-text-secondary)')
  })

  it('카드로 바꾸면 부호가 +가 되고 돌아와도 +다', async () => {
    const { user } = await open()
    await user.click(sign())
    expect(balance().value).toBe('-0')
    await user.click(type('카드'))
    expect(owed().value).toBe('0')
    await user.click(type('은행'))
    expect(balance().value).toBe('0')
    expect(sign().getAttribute('aria-pressed')).toBe('false')
  })

  it('은행과 현금 사이에서는 부호를 그대로 둔다', async () => {
    const { user } = await open()
    await user.click(sign())
    await user.click(type('현금'))
    expect(balance().value).toBe('-0')
  })

  it('화살표로도 바꾼다', async () => {
    const { user } = await open()
    type('은행').focus()
    await user.keyboard('{ArrowRight}')
    expect(type('카드').getAttribute('aria-checked')).toBe('true')
    expect(owed()).toBeTruthy()
  })
})

describe('시작 잔액', () => {
  it('비우고 벗어나면 알리고, 0을 쓰면 사라진다', async () => {
    const { user } = await open()
    await user.click(balance())
    await user.keyboard('{Backspace}')
    await user.tab()
    expect(errorOf(balance())).toBe(amountRequired)
    await user.click(balance())
    await user.keyboard('0')
    expect(errorOf(balance())).toBeUndefined()
  })

  it('11번째 숫자는 들어가지 않고 알린다', async () => {
    const { user } = await open()
    await user.click(balance())
    await user.keyboard('99999999999')
    expect(balance().value).toBe('9,999,999,999')
    expect(errorOf(balance())).toBe(amountTooLarge)
  })
})

describe('기준일', () => {
  it('고른 날짜를 보인다', async () => {
    const { user } = await open()
    await user.click(date())
    await untilOpened()
    await user.click(screen.getByRole('gridcell', { name: '2026년 11월 3일 화요일' }))
    expect(date().textContent).toBe('11월 3일 (화)')
  })
})

describe('저장', () => {
  it('목록에서 열어 입력하고 저장하면 목록으로 돌아가 새 계좌와 토스트가 보인다', async () => {
    const opened = await openFromList()
    const { user } = opened
    await fill(user)
    await user.click(date())
    await untilOpened()
    await user.click(screen.getByRole('gridcell', { name: '2026년 11월 3일 화요일' }))
    await user.click(saveButton())

    const list = await screen.findByRole('list', { name: '은행' })
    expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      '비상금1,000,000원',
      '급여통장350,000원',
    ])
    expect(screen.getByText('자산 합계').parentElement!.textContent).toBe('자산 합계1,350,000원')
    expect(screen.getByRole('status').textContent).toBe("'급여통장' 계좌를 추가했어요")
    expect(path(opened)).toBe('/accounts')
    expect(accounts.added).toEqual([
      {
        ledgerId: ledgerIdOf('user-1'),
        body: { name: '급여통장', type: 'BANK', openingBalance: 350000, openingDate: '2026-11-03' },
      },
    ])
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  })

  it('목록에서 열었으면 그 목록으로 돌아가 방문 기록에 같은 목록을 쌓지 않는다', async () => {
    const opened = await openFromList()
    await fillAndSave(opened.user)
    await screen.findByText('급여통장')
    expect(opened.router.state.historyAction).toBe('POP')
  })

  it('주소를 바로 열었으면 목록으로 replace로 간다', async () => {
    const opened = await open()
    await fillAndSave(opened.user)
    expect(await screen.findByText('급여통장')).toBeTruthy()
    expect(path(opened)).toBe('/accounts')
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it('돌아오자마자 새 계좌가 보이고, 목록을 다시 받아 서버의 것으로 바꾼다', async () => {
    const { user } = await openFromList()
    const answer = delayed()
    accounts.response = answer.respond
    await fillAndSave(user)
    expect(await screen.findByText('급여통장')).toBeTruthy()
    await answer.arrived
    answer.answer(accountsBody(accountOf('급여통장', 'BANK', 360000)))
    expect((await screen.findAllByText('360,000원')).length).toBeGreaterThan(0)
    expect(screen.queryByText('비상금')).toBeNull()
  })

  it('목록을 다시 받지 못해도 새 계좌가 보인다', async () => {
    const { user } = await openFromList()
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    await fillAndSave(user)
    expect(await screen.findByText('급여통장')).toBeTruthy()
    await settle()
    expect(screen.getByText('급여통장')).toBeTruthy()
  })

  it('저장하기 전에 보낸 목록 요청이 뒤늦게 답해도 새 계좌가 빠지지 않는다', async () => {
    const before = delayed()
    accounts.response = before.respond
    const { user } = await openApp('/accounts')
    await before.arrived
    await user.click(screen.getByRole('link', { name: '추가' }))
    await screen.findByRole('heading', { level: 1, name: '계좌 추가' })
    accounts.response = undefined
    await fillAndSave(user)
    expect(await screen.findByText('급여통장')).toBeTruthy()
    before.answer(accountsBody(accountOf('비상금', 'BANK', 1000000)))
    await settle()
    expect(screen.getByText('급여통장')).toBeTruthy()
    expect(accounts.requests).toHaveLength(2)
  })

  it('첫 계좌를 추가하면 빈 상태 대신 목록이 보인다', async () => {
    accounts.items = []
    const opened = await openApp('/accounts')
    await opened.user.click(await screen.findByRole('link', { name: '계좌 추가' }))
    await fillAndSave(opened.user)
    expect(await screen.findByRole('list', { name: '은행' })).toBeTruthy()
    expect(screen.queryByText(/계좌가 없어요/)).toBeNull()
  })

  it('토스트의 이름은 서버가 돌려준 값이다', async () => {
    accounts.addResponse = () => HttpResponse.json(accountOf('맞춘 이름', 'BANK', 1), { status: 201 })
    const { user } = await openFromList()
    await fillAndSave(user)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe("'맞춘 이름' 계좌를 추가했어요"))
  })

  it.each([
    ['은행의 음수', async (user: User) => user.click(sign()), 'BANK', -350000],
    ['카드의 갚을 금액', async (user: User) => user.click(type('카드')), 'CARD', -350000],
    ['현금', async (user: User) => user.click(type('현금')), 'CASH', 350000],
  ])('%s을 보낸다', async (_, change, sentType, openingBalance) => {
    const { user } = await open()
    await fill(user)
    await change(user)
    await user.click(saveButton())
    await waitFor(() => expect(savedBody()).toMatchObject({ type: sentType, openingBalance }))
  })

  it('"-0"은 0으로 보낸다', async () => {
    const { user } = await open()
    await user.type(name(), '마이너스통장')
    await user.click(sign())
    expect(balance().value).toBe('-0')
    await user.click(saveButton())
    await waitFor(() => expect(savedBody()).toMatchObject({ openingBalance: 0 }))
  })

  it('이름은 앞뒤 공백을 지우고 조합형으로 맞춰 보낸다', async () => {
    const { user } = await open()
    await fillAndSave(user, { name: `\u{3000}${'급여통장'.normalize('NFD')} ` })
    await waitFor(() => expect(savedBody()?.name).toBe('급여통장'))
  })

  it('입력값을 주소에 싣지 않는다', async () => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const opened = await open()
    await fillAndSave(opened.user)
    await screen.findByRole('alert')
    expect(opened.router.state.location.search).toBe('')
    for (const input of document.querySelectorAll('input')) expect(input.hasAttribute('name')).toBe(false)
  })

  it('토스트가 보이는 동안 다시 "추가"를 열면 토스트가 저장 버튼을 덮지 않게 걷는다', async () => {
    const { user } = await openFromList()
    await fillAndSave(user)
    await waitFor(() => expect(screen.getByText("'급여통장' 계좌를 추가했어요")).toBeTruthy())
    await untilUnshielded()
    await user.click(screen.getByRole('link', { name: '추가' }))
    await screen.findByRole('heading', { level: 1, name: '계좌 추가' })
    expect(screen.queryByText("'급여통장' 계좌를 추가했어요")).toBeNull()
  })

  it('두 번 누르거나 엔터를 눌러도 한 번만 보낸다', async () => {
    accounts.addResponse = delayed().respond
    const { user } = await open()
    await fill(user)
    await user.dblClick(saveButton())
    await user.type(name(), '{Enter}')
    await user.click(saveButton())
    await settle()
    expect(accounts.added).toHaveLength(1)
  })

  it('토큰이 만료됐으면 갱신하고 한 번 더 보낸 것이 저장된다', async () => {
    const { user } = await openFromList()
    await fill(user)
    backend.expireTokens()
    await user.click(saveButton())
    expect(await screen.findByText('급여통장')).toBeTruthy()
    expect(accounts.items).toHaveLength(2)
  })
})

describe('저장할 때의 검사', () => {
  it('빈 채로 누르면 이름의 오류를 보이고 초점이 가며 보내지 않는다', async () => {
    const { user } = await open()
    await user.click(saveButton())
    expect(errors()).toEqual([nameRequired, undefined, undefined, undefined])
    expect(document.activeElement).toBe(name())
    expect(accounts.added).toEqual([])
  })

  it('모든 칸을 검사하고 위에서부터 첫 오류 칸으로 초점이 간다', async () => {
    const { user } = await open()
    await user.click(balance())
    await user.keyboard('{Backspace}')
    await user.click(saveButton())
    expect(errors()).toEqual([nameRequired, undefined, amountRequired, undefined])
    expect(document.activeElement).toBe(name())
    await user.type(name(), '급여통장')
    await user.click(saveButton())
    expect(errors()).toEqual([undefined, undefined, amountRequired, undefined])
    expect(document.activeElement).toBe(balance())
    expect(accounts.added).toEqual([])
  })

  it('오류가 있어도 버튼은 누를 수 있다', async () => {
    const { user } = await open()
    await user.click(saveButton())
    expect(saveButton().hasAttribute('aria-disabled')).toBe(false)
  })

  it.each([
    ['저장', saveButton],
    ['닫기', closeButton],
    ['카드', () => type('카드')],
    ['마이너스', sign],
    ['기준일', date],
  ])('"%s"를 누르는 사이에 오류 문구가 나와 밀리지 않는다', async (_, target) => {
    const { user } = await open()
    await user.click(name())
    await user.pointer({ keys: '[MouseLeft>]', target: target() })
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('처리 중', () => {
  async function startSaving() {
    const answer = delayed()
    accounts.addResponse = answer.respond
    const opened = await openFromList()
    await fill(opened.user)
    const looks = () =>
      [name(), typeGroup(), sign(), balance(), date()].map((element) => {
        const { backgroundColor, color, font, borderRadius } = getComputedStyle(element)
        return { className: element.className, backgroundColor, color, font, borderRadius }
      })
    act(() => (document.activeElement as HTMLElement).blur())
    const before = looks()
    await opened.user.click(saveButton())
    await answer.arrived
    return { ...opened, answer, before, looks }
  }

  it('저장 버튼만 처리 중이고 칸은 모양 그대로 바꿀 수 없다', async () => {
    const { user, answer, before, looks } = await startSaving()
    expect(saveButton().getAttribute('aria-busy')).toBe('true')
    expect(saveButton().querySelector('.status-motion')).toBeTruthy()
    expect(looks()).toEqual(before)
    expect([name().readOnly, balance().readOnly]).toEqual([true, true])
    expect(typeGroup().getAttribute('aria-readonly')).toBe('true')

    await user.click(type('카드'))
    expect(type('은행').getAttribute('aria-checked')).toBe('true')
    await user.click(sign())
    expect(balance().value).toBe('350,000')
    await user.click(date())
    expect(document.querySelector('dialog')).toBeNull()
    expect(screen.getByRole('main').parentElement!.getAttribute('aria-busy')).toBe('true')

    answer.answer(problem(500, 'INTERNAL_ERROR'))
    await screen.findByRole('alert')
    expect(saveButton().hasAttribute('aria-busy')).toBe(false)
    expect([name().readOnly, balance().readOnly]).toEqual([false, false])
    expect(screen.getByRole('main').parentElement!.hasAttribute('aria-busy')).toBe(false)
  })

  it('저장에 성공해 목록으로 갈 때까지 저장 버튼이 풀리지 않는다', async () => {
    const { answer } = await startSaving()
    const changes: MutationRecord[] = []
    const observer = new MutationObserver((records) => void changes.push(...records))
    observer.observe(saveButton(), { attributeFilter: ['aria-busy'] })
    answer.answer(HttpResponse.json(accountOf('급여통장', 'BANK', 350000), { status: 201 }))
    await screen.findByText('급여통장')
    expect([...changes, ...observer.takeRecords()]).toEqual([])
    observer.disconnect()
  })

  it('닫기, 뒤로, Esc로 닫히지 않고 묻지 않으며, 끝나면 목록으로 간다', async () => {
    const opened = await startSaving()
    await opened.user.click(closeButton())
    await opened.user.keyboard('{Escape}')
    await act(() => opened.router.navigate(-1))
    await settle()
    expect(path(opened)).toBe('/accounts/new')
    expect(dialog()).toBeNull()
    opened.answer.answer(HttpResponse.json(accountOf('급여통장', 'BANK', 350000), { status: 201 }))
    expect(await screen.findByText('급여통장')).toBeTruthy()
    expect(path(opened)).toBe('/accounts')
  })
})

describe('서버가 거부함', () => {
  it.each([
    ['name', 'REQUIRED', 0, nameRequired],
    ['name', 'TOO_LONG', 0, nameTooLong],
    ['name', 'INVALID_FORMAT', 0, nameUnusable],
    ['name', 'DUPLICATE', 0, nameDuplicate],
    ['type', 'REQUIRED', 1, '종류를 골라 주세요'],
    ['type', 'INVALID_FORMAT', 1, '종류를 골라 주세요'],
    ['openingBalance', 'REQUIRED', 2, amountRequired],
    ['openingBalance', 'INVALID_FORMAT', 2, amountRequired],
    ['openingBalance', 'OUT_OF_RANGE', 2, amountTooLarge],
    ['openingDate', 'REQUIRED', 3, dateRequired],
    ['openingDate', 'INVALID_FORMAT', 3, dateRequired],
    ['openingDate', 'OUT_OF_RANGE', 3, dateOutOfRange],
  ] as const)('%s %s는 그 칸 아래에 보이고 초점이 그 칸으로 간다', async (field, code, index, message) => {
    accounts.addResponse = refuse([field, code])
    const { user } = await open()
    await fillAndSave(user)
    await waitFor(() => expect(errors()[index]).toBe(message))
    expect(errors().filter(Boolean)).toEqual([message])
    const control = controls()[index]
    expect(document.activeElement).toBe(index === 1 ? type('은행') : control)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })

  it('여러 칸이 함께 오면 모두 보이고 위에서부터 첫 칸으로 초점이 간다', async () => {
    accounts.addResponse = refuse(['openingDate', 'OUT_OF_RANGE'], ['memo', 'NEW'], ['name', 'DUPLICATE'])
    const { user } = await open()
    await fillAndSave(user)
    await waitFor(() => expect(errors()).toEqual([nameDuplicate, undefined, undefined, dateOutOfRange]))
    expect(document.activeElement).toBe(name())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('입력값이 남고, 그 칸을 고치면 문구가 사라지며 다른 칸을 고치면 남는다', async () => {
    accounts.addResponse = refuse(['name', 'DUPLICATE'])
    const { user } = await open()
    await fillAndSave(user)
    await screen.findByText(nameDuplicate)
    expect([name().value, balance().value]).toEqual(['급여통장', '350,000'])
    await user.click(sign())
    expect(errorOf(name())).toBe(nameDuplicate)
    await user.type(name(), '2')
    expect(errorOf(name())).toBeUndefined()
  })

  it('고쳐서 다시 저장할 수 있다', async () => {
    accounts.addResponse = refuse(['name', 'DUPLICATE'])
    const { user } = await openFromList()
    await fillAndSave(user)
    await screen.findByText(nameDuplicate)
    accounts.addResponse = undefined
    await waitFor(() => expect(saveButton().hasAttribute('aria-busy')).toBe(false))
    await user.type(name(), '2')
    await user.click(saveButton())
    expect(await screen.findByText('급여통장2')).toBeTruthy()
  })

  it('응답을 못 받고 다시 보내 같은 이름으로 거부돼도 같은 문구다', async () => {
    const answers = [() => HttpResponse.error(), refuse(['name', 'DUPLICATE'])]
    accounts.addResponse = () => answers.shift()!()
    const { user } = await open()
    await fillAndSave(user)
    await screen.findByRole('alert')
    await user.click(retryButton())
    await waitFor(() => expect(errorOf(name())).toBe(nameDuplicate))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('서버 오류와 지연', () => {
  it.each([
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['연결 오류', () => HttpResponse.error()],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['404', () => problem(404, 'NOT_FOUND')],
    ['413', () => problem(413, 'PAYLOAD_TOO_LARGE')],
    ['모르는 칸만 온 400', refuse(['memo', 'TOO_LONG'])],
    ['모르는 code만 온 400', refuse(['name', 'SOMETHING_NEW'])],
    ['칸 이름이 빈 400', refuse(['', 'REQUIRED'])],
    ['칸이 없는 400', refuse()],
    ['약속과 다른 201', () => HttpResponse.json({}, { status: 201 })],
  ])('%s이면 저장 바로 위에 문구와 "다시 시도"를 보이고 입력값이 남는다', async (_, respond) => {
    accounts.addResponse = respond
    const opened = await open()
    await fillAndSave(opened.user)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(failed)
    const notice = saveButton().previousElementSibling as HTMLElement
    expect(notice.contains(alert)).toBe(true)
    expect(notice.contains(retryButton())).toBe(true)
    expect([name().value, balance().value]).toEqual(['급여통장', '350,000'])
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
    expect(path(opened)).toBe('/accounts/new')
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })

  it.each([
    ['저장을 눌렀으면 쓰던 칸에', async (user: User) => user.click(saveButton()), balance],
    ['칸에서 엔터를 쳤으면 그 칸에', async (user: User) => user.keyboard('{Enter}'), balance],
    [
      '키보드로 저장을 눌렀으면 저장에',
      async (user: User) => {
        saveButton().focus()
        await user.keyboard('{Enter}')
      },
      saveButton,
    ],
  ] as const)('실패해도 초점을 옮기지 않고 읽어 주기만 한다: %s 남는다', async (_, save, stays) => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    await fill(user)
    await save(user)
    expect((await screen.findByRole('alert')).textContent).toBe(failed)
    await settle()
    expect(document.activeElement).toBe(stays())
  })

  it('다시 시도한 것이 또 실패하면 초점이 저장에 남는다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), () => problem(503, 'INTERNAL_ERROR')]
    accounts.addResponse = () => answers.shift()!()
    const { user } = await open()
    await fillAndSave(user)
    await screen.findByRole('alert')
    await user.click(retryButton())
    await waitFor(() => expect(accounts.added).toHaveLength(2))
    await screen.findByRole('alert')
    expect(document.activeElement).toBe(saveButton())
  })

  it('"다시 시도"는 지금 화면의 값으로 다시 보내고 초점을 잃지 않는다', async () => {
    const answers = [() => problem(500, 'INTERNAL_ERROR'), delayed().respond]
    accounts.addResponse = () => answers.shift()!()
    const { user } = await open()
    await fillAndSave(user)
    await screen.findByRole('alert')
    await user.type(name(), '2')
    await user.click(retryButton())
    await waitFor(() => expect(accounts.added).toHaveLength(2))
    expect(accounts.added[1].body.name).toBe('급여통장2')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(saveButton())
  })

  it('다시 시도할 때 칸이 틀렸으면 보내지 않고 문구를 지운 뒤 칸의 오류를 보인다', async () => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    await fillAndSave(user)
    await screen.findByRole('alert')
    await user.clear(name())
    await user.click(retryButton())
    expect(errorOf(name())).toBe(nameRequired)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(accounts.added).toHaveLength(1)
  })

  it('15초 동안 응답이 없으면 같은 문구를 보인다', async () => {
    accounts.addResponse = delayed().respond
    const { user } = await open()
    await fill(user)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(saveButton())
    await act(() => vi.advanceTimersByTimeAsync(14_900))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(screen.getByRole('alert').textContent).toBe(failed)
  })

  it('저절로 다시 보내지 않는다', async () => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    await fillAndSave(user)
    await screen.findByRole('alert')
    await settle()
    expect(accounts.added).toHaveLength(1)
  })

  it('실패한 뒤에도 닫으면 버릴지 묻는다', async () => {
    accounts.addResponse = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    await fillAndSave(user)
    await screen.findByRole('alert')
    await user.click(closeButton())
    expect(dialog()).toBeTruthy()
  })
})

describe('닫기', () => {
  const ways: [string, (opened: Opened) => Promise<unknown>][] = [
    ['닫기(X)', ({ user }) => user.click(closeButton())],
    ['뒤로', ({ router }) => act(() => router.navigate(-1))],
    ['Esc', ({ user }) => user.keyboard('{Escape}')],
  ]
  const edits: [string, (user: User) => Promise<unknown>][] = [
    ['이름', (user) => user.type(name(), '가')],
    ['종류', (user) => user.click(type('현금'))],
    ['부호', (user) => user.click(sign())],
    ['금액', (user) => user.type(balance(), '5')],
    [
      '기준일',
      async (user) => {
        await user.click(date())
        await untilOpened()
        await user.click(screen.getByRole('gridcell', { name: '2026년 11월 3일 화요일' }))
      },
    ],
  ]

  it.each(ways)('바꾼 값이 없으면 %s로 바로 목록으로 간다', async (_, close) => {
    const opened = await openFromList()
    await close(opened)
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(dialog()).toBeNull()
  })

  it.each(edits)('바꾼 값이 있으면 묻는다: %s', async (_, edit) => {
    const opened = await openFromList()
    await edit(opened.user)
    await untilUnshielded()
    await opened.user.click(closeButton())
    expect(dialog()).toBeTruthy()
  })

  it('되돌린 값은 바꾸지 않은 것이다', async () => {
    const opened = await openFromList()
    const { user } = opened
    await user.type(name(), '가{Backspace}')
    await user.click(type('카드'))
    await user.click(type('은행'))
    await user.click(sign())
    await user.click(sign())
    await user.click(balance())
    await user.keyboard('5{Backspace}0')
    await user.click(closeButton())
    expect(await screen.findByText('자산 합계')).toBeTruthy()
  })

  it('"버리기"면 저장하지 않고 목록으로 가고 토스트가 없다', async () => {
    const opened = await openFromList()
    await fill(opened.user)
    await opened.user.click(closeButton())
    await untilOpened()
    await opened.user.click(screen.getByRole('button', { name: '버리기' }))
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(accounts.added).toEqual([])
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('날짜를 고르는 시트의 Esc는 시트만 닫는다', async () => {
    const opened = await openFromList()
    await opened.user.click(date())
    await opened.user.keyboard('{Escape}')
    await settle()
    expect(path(opened)).toBe('/accounts/new')
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(date())
  })
})

describe('막지 않는 경우', () => {
  const loginHeading = () => screen.findByRole('heading', { level: 1, name: '로그인' })

  async function logOutElsewhere() {
    vi.resetModules()
    const other = await import('../src/api/sessionMarks')
    other.settleLogout(other.recordLogout())
    backend.cookieUser = undefined
    act(() => void window.dispatchEvent(new StorageEvent('storage', { key: 'akkimpyo-logout' })))
  }

  it('저장에 성공하면 묻지 않고 나간다', async () => {
    const opened = await openFromList()
    const dom = recordDom()
    await fillAndSave(opened.user)
    await screen.findByText('급여통장')
    expect(dom.sawElement('dialog')).toBe(false)
  })

  it('쓰던 중에 로그아웃하면 묻지 않고 로그인 화면으로 간다', async () => {
    const opened = await openFromList()
    await fill(opened.user)
    const dom = recordDom()
    await opened.user.click(logoutButton())
    await loginHeading()
    await settle()
    expect(path(opened)).toBe('/login')
    expect(dom.sawElement('dialog')).toBe(false)
  })

  it('쓰던 중에 다른 탭에서 로그아웃하면 묻지 않고 로그인 화면으로 간다', async () => {
    const opened = await openFromList()
    await fill(opened.user)
    const dom = recordDom()
    await logOutElsewhere()
    await loginHeading()
    await settle()
    expect(path(opened)).toBe('/login')
    expect(dom.sawElement('dialog')).toBe(false)
  })

  it('확인 창이 열려 있는 중에 로그아웃돼도 로그인 화면으로 간다', async () => {
    const opened = await openFromList()
    await fill(opened.user)
    await act(() => opened.router.navigate(-1))
    expect(dialog()).toBeTruthy()
    await logOutElsewhere()
    await loginHeading()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('저장하다 로그인이 풀린 것을 알면 묻지 않고 로그인 화면으로 가고, 돌아올 주소를 기억한다', async () => {
    const opened = await openFromList()
    await fill(opened.user)
    backend.expireTokens()
    backend.cookieUser = undefined
    const dom = recordDom()
    await opened.user.click(saveButton())
    await loginHeading()
    expect(screen.getByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeTruthy()
    expect(dom.sawElement('dialog')).toBe(false)
    backend.loginUser = 'user-1'
    await opened.user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { level: 1, name: '계좌 추가' })).toBeTruthy()
    expect(path(opened)).toBe('/accounts/new')
  })

  it.each([
    ['이 탭', async (opened: Opened) => opened.user.click(logoutButton())],
    ['다른 탭', async () => logOutElsewhere()],
  ])('응답이 늦은 사이 %s에서 로그아웃하면 뒤늦은 응답이 화면과 토스트에 나오지 않는다', async (_, logOut) => {
    const answer = delayed()
    accounts.addResponse = answer.respond
    const opened = await openFromList()
    await fillAndSave(opened.user)
    await answer.arrived
    const dom = recordDom()
    await logOut(opened)
    await loginHeading()
    answer.answer(HttpResponse.json(accountOf('급여통장', 'BANK', 350000), { status: 201 }))
    await settle(100)
    expect(path(opened)).toBe('/login')
    expect(dom.sawText('급여통장')).toBe(false)
    expect(dom.sawText('추가했어요')).toBe(false)

    // 다음 사용자의 목록에도 나오지 않는다
    backend.loginUser = 'user-2'
    accounts.items = []
    await opened.user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await waitFor(() => expect(path(opened)).not.toBe('/login'))
    await settle(100)
    expect(dom.sawText('급여통장')).toBe(false)
    expect(dom.sawText('추가했어요')).toBe(false)
  })

  it('토스트가 보이는 동안 로그아웃하면 이름이 남지 않는다', async () => {
    const opened = await openFromList()
    await fillAndSave(opened.user)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('급여통장'))
    await logOutElsewhere()
    await loginHeading()
    expect(document.body.textContent).not.toContain('급여통장')
  })
})
