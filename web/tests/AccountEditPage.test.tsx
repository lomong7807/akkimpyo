import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountOf, accountsBody, startAccounts, type Accounts } from './support/accounts'
import { delayed, ledgerIdOf, meOf, startBackend, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { seedLedgerCopy, seedLogin, seedMeCopy } from './support/device'
import { untilOpened, untilUnshielded } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'
import { problem } from './support/problem'
import { toastRegion } from './support/toast'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'
import { createFakeLocks, installLocks, removeLocks } from './support/webLocks'

/*
 * G-02 계좌 수정(#243, F-503). 1B 동안은 계좌 목록(G-01)의 계좌 줄이 이 화면을 열고 저장하면 목록으로 돌아간다(planner #102).
 * 칸, 검사, 문구는 계좌 추가(#83)와 같고 지금 값을 채워 연다. 카드는 저장된 음수를 양수로 채우고 양수로 받아 음수로 저장한다.
 * 계좌는 수정 충돌 검사가 없다(P-217, R6).
 */

const nameRequired = '이름을 입력해 주세요'
const nameTooLong = '50자까지 쓸 수 있어요'
const nameUnusable = '쓸 수 없는 글자가 있어요. 모두 지우고 다시 써 주세요.'
const nameDuplicate = '같은 이름의 계좌가 있어요. 다른 이름을 써 주세요.'
const amountRequired = '금액을 입력해 주세요. 없으면 0을 적어요.'
const amountTooLarge = '9,999,999,999원까지 입력할 수 있어요'
const typeNotice = '종류를 바꾸면 금액의 뜻이 바뀌어요. 금액을 다시 확인해 주세요.'
const recalculation = '시작 잔액이나 기준일을 바꾸면 잔액을 다시 계산해요'
const failed = '문제가 생겨 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const lost = '연결이 끊겨 저장하지 못했어요. 연결되면 다시 시도해 주세요.'
const offlineReason = '연결되면 저장할 수 있어요'
const question = '쓰던 내용을 버릴까요?'
const notFound = '찾을 수 없어요.'
const loadFailed = '불러오지 못했어요.'
const waitForConnection = '연결되면 자동으로 불러올게요.'

const id = {
  salary: '11111111-1111-4111-8111-111111111111',
  minus: '22222222-2222-4222-8222-222222222222',
  card: '33333333-3333-4333-8333-333333333333',
  wallet: '44444444-4444-4444-8444-444444444444',
  gone: '99999999-9999-4999-8999-999999999999',
}

/** 잔액은 시작 잔액에 기준일 이후 거래를 더한 값이다. 거래의 몫을 두어 시작 잔액과 다르게 한다 */
const salary = { ...accountOf('급여통장', 'BANK', 1250000), id: id.salary, openingBalance: 1000000 }
const minus = { ...accountOf('마이너스통장', 'BANK', -80000), id: id.minus, openingBalance: -50000 }
const card = {
  ...accountOf('신한카드', 'CARD', -482300),
  id: id.card,
  openingBalance: -300000,
  openingDate: '2026-10-15',
}
const wallet = { ...accountOf('지갑', 'CASH', 30000), id: id.wallet }

const server = startMockServer()
let backend: Backend
let accounts: Accounts

beforeEach(() => {
  setDeviceClock('2026-11-26T12:00:00+09:00')
  vi.stubGlobal('scrollTo', vi.fn())
  installMatchMedia(390)
  installLocks(createFakeLocks())
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
  accounts = startAccounts(server, backend)
  accounts.items = [salary, card, minus, wallet]
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(async () => {
  cleanup()
  await untilUnshielded()
  resetViewport()
  removeLocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type Opened = Awaited<ReturnType<typeof openApp>>
type User = Opened['user']

const editPath = (accountId: string) => `/accounts/${accountId}/edit`
const name = () => screen.getByLabelText<HTMLInputElement>('이름')
const type = (label: string) => screen.getByRole('radio', { name: label })
const typeGroup = () => screen.getByRole('radiogroup', { name: '종류' })
const balance = () => screen.getByLabelText<HTMLInputElement>('시작 잔액')
const owed = () => screen.getByLabelText<HTMLInputElement>('지금 갚을 금액')
const amount = () => screen.getByRole<HTMLInputElement>('textbox', { name: / 원$/ })
const sign = () => screen.getByRole('button', { name: '마이너스' })
const date = () => screen.getByRole<HTMLButtonElement>('button', { name: /^기준일/ })
const saveButton = () => screen.getByRole('button', { name: '저장' })
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const closeButton = () => screen.getByRole('button', { name: '닫기' })
const dialog = () => screen.queryByRole('dialog', { name: question })
const settle = (ms = 50) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
const path = ({ router }: Opened) => router.state.location.pathname
const sentBodies = () => accounts.updated.map(({ body }) => body)

/** 칸 아래에 이어진 오류 문구. 없으면 없다. */
function errorOf(control: HTMLElement): string | undefined {
  const ids = control.getAttribute('aria-describedby')?.split(' ') ?? []
  const message = ids.map((each) => document.getElementById(each)!).find((element) => element.querySelector('svg'))
  return message?.textContent
}

const controls = () => [name(), typeGroup(), amount(), date()]
const errors = () => controls().map(errorOf)

/** 계좌 수정의 칸이 지금 값으로 채워질 때까지 기다린다. 화면 코드를 받는 동안의 틀(#251)에도 같은 제목이 있다. */
async function untilForm() {
  await screen.findByRole('heading', { level: 1, name: '계좌 수정' })
  await screen.findByLabelText('이름')
}

/** 주소로 바로 연다 */
async function open(accountId = id.salary) {
  const opened = await openApp(editPath(accountId))
  await untilForm()
  return opened
}

/** 계좌 목록에서 그 계좌 줄을 눌러 연다 */
async function openFromList(linkName = '급여통장 1,250,000원, 수정') {
  const opened = await openApp('/accounts')
  await opened.user.click(await screen.findByRole('link', { name: linkName }))
  await untilForm()
  return opened
}

async function pickDate(user: User, label: string) {
  await user.click(date())
  await untilOpened()
  await user.click(screen.getByRole('gridcell', { name: new RegExp(`^${label} .요일$`) }))
}

async function rename(user: User, typed = '월급통장') {
  await user.clear(name())
  await user.type(name(), typed)
}

const refuse =
  (...fieldErrors: [field: string, code: string][]) =>
  () =>
    problem(400, 'VALIDATION_FAILED', {
      fieldErrors: fieldErrors.map(([field, code]) => ({ field, code, message: '개발자가 읽는 글' })),
    })

describe('여는 길(1B: 계좌 목록의 줄, planner #102)', () => {
  it('계좌 줄 전체가 수정으로 가는 링크이고 이름은 "{이름} {잔액}, 수정"이다. 묶음 머리와 자산 합계는 누르지 않는다', async () => {
    await openApp('/accounts')
    await screen.findByText('자산 합계')
    const links = within(screen.getByRole('main')).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      '급여통장 1,250,000원, 수정',
      '마이너스통장 -80,000원, 수정',
      '신한카드 -482,300원, 수정',
      '지갑 30,000원, 수정',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      editPath(id.salary),
      editPath(id.minus),
      editPath(id.card),
      editPath(id.wallet),
    ])
    // 링크는 계좌 줄 안의 것뿐이다. 줄에 보이는 글자는 그대로다
    expect(links.map((link) => link.closest('li')!.textContent)).toEqual([
      '급여통장1,250,000원',
      '마이너스통장-80,000원',
      '신한카드-482,300원',
      '지갑30,000원',
    ])
    expect(screen.getByText('자산 합계').closest('a')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: '은행' }).closest('a')).toBeNull()
  })

  it('줄을 누르면 하단 탭 없는 "계좌 수정"이 열리고 넓은 화면의 사이드바는 계좌를 가리킨다', async () => {
    const opened = await openFromList()
    expect(path(opened)).toBe(editPath(id.salary))
    expect(screen.queryByRole('navigation', { name: '주 메뉴' })).toBeNull()
    setViewportWidth(1280)
    expect(screen.getByRole('link', { name: '계좌' }).getAttribute('aria-current')).toBe('page')
  })

  it('목록에서 열면 받아 둔 목록으로 바로 채운다', async () => {
    await openFromList()
    expect(name().value).toBe('급여통장')
    expect(accounts.requests).toHaveLength(1)
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 돌아와 채운다(R5)', async () => {
    backend.cookieUser = undefined
    const opened = await openApp(editPath(id.salary))
    await opened.user.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await untilForm()
    expect(name().value).toBe('급여통장')
    expect(path(opened)).toBe(editPath(id.salary))
  })
})

describe('지금 값 채우기', () => {
  it('은행: 이름, 종류, 시작 잔액(저장된 시작 잔액), 기준일이 채워지고 기준일 아래에 다시 계산 안내가 늘 있다', async () => {
    await open()
    expect(name().value).toBe('급여통장')
    expect(name().placeholder).toBe('예: 국민은행 급여통장')
    expect(screen.getByText('1~50자')).toBeTruthy()
    expect(type('은행').getAttribute('aria-checked')).toBe('true')
    expect(balance().value).toBe('1,000,000')
    expect(sign().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('마이너스 통장이면 -로 바꿔 적어요')).toBeTruthy()
    expect(date().textContent).toBe('11월 1일 (일)')
    expect(screen.getByText('이날부터의 거래가 잔액에 들어가요')).toBeTruthy()
    // (5)는 (4) 아래, 저장 위에 놓인다
    const all = [...document.querySelectorAll('*')]
    const positions = [name(), typeGroup(), balance(), date(), screen.getByText(recalculation), saveButton()].map((each) =>
      all.indexOf(each),
    )
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
  })

  it('마이너스 통장은 부호가 -이고 크기를 채운다', async () => {
    await open(id.minus)
    expect(balance().value).toBe('-50,000')
    expect(sign().getAttribute('aria-pressed')).toBe('true')
  })

  it('카드는 저장된 음수를 양수로 바꿔 "지금 갚을 금액"에 채우고 부호 버튼이 없다', async () => {
    await open(id.card)
    expect(type('카드').getAttribute('aria-checked')).toBe('true')
    expect(owed().value).toBe('300,000')
    expect(screen.queryByRole('button', { name: '마이너스' })).toBeNull()
    expect(screen.getByText('카드는 지금 갚을 금액을 적어요')).toBeTruthy()
    expect(date().textContent).toBe('10월 15일 (목)')
  })

  it('여는 때 초점을 두지 않고 오류, 알림, 종류 안내가 없다', async () => {
    await open()
    expect(document.activeElement).toBe(document.body)
    expect(errors()).toEqual([undefined, undefined, undefined, undefined])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(typeNotice)).toBeNull()
  })

})

describe('카드 부호 변환(종류를 바꿀 때 포함)', () => {
  it('카드의 갚을 금액을 그대로 두고 이름만 고치면 저장된 음수 그대로 보낸다', async () => {
    const { user } = await open(id.card)
    await rename(user, '신한카드 생활')
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0]).toEqual({ name: '신한카드 생활', type: 'CARD', openingBalance: -300000, openingDate: '2026-10-15' })
  })

  it('카드의 갚을 금액을 바꾸면 양수로 받아 음수로 보낸다', async () => {
    const { user } = await open(id.card)
    await user.clear(owed())
    await user.type(owed(), '350000')
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0].openingBalance).toBe(-350000)
  })

  it('카드를 은행으로 바꾸면 금액은 그대로 +인 시작 잔액이 되고 안내가 보이며 양수로 보낸다', async () => {
    const { user } = await open(id.card)
    await user.click(type('은행'))
    expect(balance().value).toBe('300,000')
    expect(sign().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(typeNotice)).toBeTruthy()
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0]).toMatchObject({ type: 'BANK', openingBalance: 300000 })
  })

  it('마이너스 통장을 카드로 바꾸면 부호가 빠진 갚을 금액이 되어 음수로 보내고, 은행으로 돌아오면 +다', async () => {
    const { user } = await open(id.minus)
    await user.click(type('카드'))
    expect(owed().value).toBe('50,000')
    expect(screen.getByText(typeNotice)).toBeTruthy()
    await user.click(type('은행'))
    expect(balance().value).toBe('50,000')
    expect(sign().getAttribute('aria-pressed')).toBe('false')
    await user.click(type('카드'))
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0]).toMatchObject({ type: 'CARD', openingBalance: -50000 })
  })

  it('은행과 현금 사이에서는 부호를 그대로 두고 안내가 없다', async () => {
    const { user } = await open(id.minus)
    await user.click(type('현금'))
    expect(balance().value).toBe('-50,000')
    expect(screen.queryByText(typeNotice)).toBeNull()
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0]).toMatchObject({ type: 'CASH', openingBalance: -50000 })
  })

  it('저장된 시작 잔액이 양수인 카드(API로만 생김)는 크기로 채우고, 금액과 종류를 그대로 두면 저장된 값 그대로 보낸다(planner P2)', async () => {
    accounts.items = [{ ...card, openingBalance: 5000, balance: -177300 }]
    const { user } = await open(id.card)
    expect(owed().value).toBe('5,000')
    await rename(user, '선결제 카드')
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0].openingBalance).toBe(5000)
  })
})

describe('검사와 문구', () => {
  it.each([
    ['비었음', '', nameRequired],
    ['51자', '가'.repeat(51), nameTooLong],
    ['보이지 않는 글자', '급여\u{200B}통장', nameUnusable],
    ['보이지 않는 글자와 51자(쓸 수 없는 글자가 먼저)', `${'가'.repeat(51)}\u{200B}`, nameUnusable],
  ])('이름이 %s이면 저장할 때 알리고 초점이 이름으로 가며 보내지 않는다', async (_, value, message) => {
    const { user } = await open()
    await user.clear(name())
    if (value) await user.paste(value)
    await user.click(saveButton())
    expect(errorOf(name())).toBe(message)
    expect(document.activeElement).toBe(name())
    expect(accounts.updated).toEqual([])
  })

  it('금액을 비우면 알리고, 11번째 숫자는 들어가지 않고 알린다', async () => {
    const { user } = await open()
    await user.clear(balance())
    await user.click(saveButton())
    expect(errorOf(balance())).toBe(amountRequired)
    expect(document.activeElement).toBe(balance())
    await user.type(balance(), '99999999999')
    expect(balance().value).toBe('9,999,999,999')
    expect(errorOf(balance())).toBe(amountTooLarge)
    expect(accounts.updated).toEqual([])
  })

  it('모든 칸을 검사하고 위에서부터 첫 오류 칸으로 초점이 간다', async () => {
    const { user } = await open()
    await user.clear(balance())
    await user.clear(name())
    await user.click(saveButton())
    expect(errors()).toEqual([nameRequired, undefined, amountRequired, undefined])
    expect(document.activeElement).toBe(name())
  })

  it.each([
    ['name', 'DUPLICATE', 0, nameDuplicate],
    ['name', 'INVALID_FORMAT', 0, nameUnusable],
    ['type', 'INVALID_FORMAT', 1, '종류를 골라 주세요'],
    ['openingBalance', 'OUT_OF_RANGE', 2, amountTooLarge],
    ['openingDate', 'OUT_OF_RANGE', 3, '2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요'],
  ] as const)('서버가 %s %s로 거부하면 그 칸 아래에 보이고 초점이 가며 입력값이 남는다', async (field, code, index, message) => {
    accounts.updateResponse = refuse([field, code])
    const { user } = await open()
    await rename(user)
    await user.click(saveButton())
    await waitFor(() => expect(errors()[index]).toBe(message))
    expect(errors().filter(Boolean)).toEqual([message])
    expect(document.activeElement).toBe(index === 1 ? type('은행') : controls()[index])
    expect(name().value).toBe('월급통장')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toContain('개발자가 읽는')
  })

  it('같은 이름으로 거부되면 계좌 목록을 다시 받되 쓰던 칸은 덮지 않고, 이름을 고쳐 다시 저장할 수 있다(planner P1)', async () => {
    accounts.updateResponse = refuse(['name', 'DUPLICATE'])
    const opened = await openFromList()
    await rename(opened.user, '지갑')
    // 다른 기기가 그사이 시작 잔액을 바꿨어도 다시 받은 목록으로 칸을 덮지 않는다(나중 저장이 남는다, P-217)
    accounts.items = accounts.items.map((item) => (item === salary ? { ...salary, openingBalance: 1, balance: 250001 } : item))
    await opened.user.click(saveButton())
    await screen.findByText(nameDuplicate)
    await waitFor(() => expect(accounts.requests).toHaveLength(2))
    await settle()
    expect([name().value, balance().value]).toEqual(['지갑', '1,000,000'])
    accounts.updateResponse = undefined
    await rename(opened.user, '월급통장')
    await opened.user.click(saveButton())
    expect(await screen.findByRole('link', { name: '월급통장 1,250,000원, 수정' })).toBeTruthy()
  })
})

describe('기준일 범위와 자정 경계(P-202, 오늘로부터 1년 뒤)', () => {
  async function lastMonthCells(user: User) {
    await user.click(date())
    await untilOpened()
    for (let month = 0; month < 12; month += 1) await user.click(screen.getByRole('button', { name: '다음 달' }))
    expect(screen.queryByRole('button', { name: '다음 달' })).toBeNull()
    return (day: number) => screen.getByRole('gridcell', { name: new RegExp(`^2027년 11월 ${day}일 .요일$`) })
  }

  it.each([
    ['서울 자정 전', '2026-11-26T23:59:59+09:00', 'Asia/Seoul', 26],
    ['서울 자정', '2026-11-27T00:00:00+09:00', 'Asia/Seoul', 27],
    ['로스앤젤레스 자정 전(서울은 이미 27일)', '2026-11-27T07:59:59Z', 'America/Los_Angeles', 26],
    ['로스앤젤레스 자정', '2026-11-27T08:00:00Z', 'America/Los_Angeles', 27],
  ])('%s에 열면 기기의 오늘로부터 1년 뒤인 11월 %i일까지 고르고 그 뒤는 누를 수 없다', async (_, at, timeZone, last) => {
    setDeviceClock(at, timeZone)
    const { user } = await open()
    const day = await lastMonthCells(user)
    expect(day(last).hasAttribute('aria-disabled')).toBe(false)
    expect(day(last + 1).getAttribute('aria-disabled')).toBe('true')
    await user.click(day(last))
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0].openingDate).toBe(`2027-11-${last}`)
  })

  it.each([
    ['2026-11-26T23:59:59+09:00', '2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요'],
    ['2026-11-27T00:00:00+09:00', '2000년 1월 1일부터 2027년 11월 27일까지 고를 수 있어요'],
  ])('%s에 서버가 범위 밖으로 거부하면 끝 날짜는 그날로부터 1년 뒤다', async (at, message) => {
    setDeviceClock(at)
    accounts.updateResponse = refuse(['openingDate', 'OUT_OF_RANGE'])
    const { user } = await open()
    await pickDate(user, '2026년 11월 3일')
    await user.click(saveButton())
    await waitFor(() => expect(errorOf(date())).toBe(message))
  })
})

describe('저장', () => {
  it('목록에서 열어 시작 잔액과 기준일을 바꿔 저장하면 목록으로 돌아가 토스트 "저장했어요"와 다시 계산된 잔액이 보인다', async () => {
    const opened = await openFromList()
    const { user } = opened
    await user.clear(balance())
    await user.type(balance(), '1100000')
    await pickDate(user, '2026년 11월 3일')
    await user.click(saveButton())

    expect(await screen.findByRole('link', { name: '급여통장 1,350,000원, 수정' })).toBeTruthy()
    expect(toastRegion().textContent).toBe('저장했어요')
    expect(path(opened)).toBe('/accounts')
    // 목록에서 열었으면 그 목록으로 돌아가 방문 기록에 같은 목록을 쌓지 않는다
    expect(opened.router.state.historyAction).toBe('POP')
    expect(accounts.updated).toEqual([
      {
        ledgerId: ledgerIdOf('user-1'),
        accountId: id.salary,
        body: { name: '급여통장', type: 'BANK', openingBalance: 1100000, openingDate: '2026-11-03' },
      },
    ])
    expect(screen.getByText('자산 합계').parentElement!.textContent).toBe('자산 합계817,700원')
  })

  it('저장하면 계좌 목록을 다시 받아 서버의 것으로 바꾸고, 홈의 계좌 잔액도 바뀐 값이다', async () => {
    const opened = await openFromList()
    await opened.user.clear(balance())
    await opened.user.type(balance(), '1100000')
    await opened.user.click(saveButton())
    await screen.findByRole('link', { name: '급여통장 1,350,000원, 수정' })
    await waitFor(() => expect(accounts.requests).toHaveLength(2))
    await act(() => opened.router.navigate('/home'))
    // 은행 묶음 합계: 1,350,000 + (-80,000)
    const region = await screen.findByRole('region', { name: '계좌 잔액' })
    await waitFor(() => expect(region.textContent).toContain('은행1,270,000원'))
  })

  it('목록을 다시 받지 못해도 저장한 값이 목록에 보인다', async () => {
    const opened = await openFromList()
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    await rename(opened.user)
    await opened.user.click(saveButton())
    expect(await screen.findByRole('link', { name: '월급통장 1,250,000원, 수정' })).toBeTruthy()
    await settle()
    expect(screen.getByText('월급통장')).toBeTruthy()
  })

  it('주소를 바로 열었으면 목록으로 replace로 간다', async () => {
    const opened = await open()
    await rename(opened.user)
    await opened.user.click(saveButton())
    expect(await screen.findByText('월급통장')).toBeTruthy()
    expect(path(opened)).toBe('/accounts')
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it('이름은 앞뒤 공백을 지우고 조합형으로 맞춰 보낸다', async () => {
    const { user } = await open()
    await user.clear(name())
    await user.paste(`  ${'월급'.normalize('NFD')}통장\u{A0}`)
    await user.click(saveButton())
    await waitFor(() => expect(sentBodies()).toHaveLength(1))
    expect(sentBodies()[0].name).toBe('월급통장')
  })

  it('두 번 누르거나 엔터를 눌러도 한 번만 보낸다', async () => {
    const answer = delayed()
    accounts.updateResponse = answer.respond
    const opened = await open()
    const { user } = opened
    await rename(user)
    await user.click(saveButton())
    await answer.arrived
    await user.click(saveButton())
    await user.keyboard('{Enter}')
    await settle()
    expect(accounts.updated).toHaveLength(1)
    answer.answer(HttpResponse.json({ ...salary, name: '월급통장' }))
    await waitFor(() => expect(path(opened)).toBe('/accounts'))
    expect(toastRegion().textContent).toBe('저장했어요')
  })
})

describe('바뀐 값이 없으면 요청 없이 닫는다', () => {
  it('저장을 누르면 보내지 않고 목록으로 돌아가며 토스트가 없다', async () => {
    const opened = await openFromList()
    await opened.user.click(saveButton())
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(accounts.updated).toEqual([])
    expect(toastRegion().textContent).toBe('')
    expect(opened.router.state.historyAction).toBe('POP')
  })

  it('되돌린 값, 앞뒤 공백만 더한 이름, 0원의 부호는 바꾼 것이 아니다', async () => {
    accounts.items = [{ ...wallet, openingBalance: 0, balance: 0 }]
    const opened = await openFromList('지갑 0원, 수정')
    const { user } = opened
    await user.click(type('카드'))
    await user.click(type('현금'))
    await user.click(sign())
    await user.type(name(), ' ')
    await user.click(saveButton())
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(accounts.updated).toEqual([])
    expect(toastRegion().textContent).toBe('')
  })

  it('주소를 바로 열었으면 목록으로 replace로 간다', async () => {
    const opened = await open()
    await opened.user.click(saveButton())
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })
})

describe('닫기(R3)', () => {
  it('바꾼 값이 없으면 닫기(X)로 묻지 않고 목록으로 간다', async () => {
    const opened = await openFromList()
    await opened.user.click(closeButton())
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(dialog()).toBeNull()
  })

  it('바꾼 값이 있으면 "쓰던 내용을 버릴까요?"이고 "계속 쓰기"는 값을 두며 "버리기"는 보내지 않고 목록으로 간다', async () => {
    const opened = await openFromList()
    const { user } = opened
    await rename(user)
    await untilUnshielded()
    await user.click(closeButton())
    await untilOpened()
    const asked = dialog()!
    const buttons = within(asked).getAllByRole('button').filter((button) => button.textContent !== '')
    expect(buttons.map((button) => button.textContent).slice(-2)).toEqual(['계속 쓰기', '버리기'])
    await user.click(within(asked).getByRole('button', { name: '계속 쓰기' }))
    await untilUnshielded()
    expect(name().value).toBe('월급통장')
    expect(path(opened)).toBe(editPath(id.salary))

    await user.click(closeButton())
    await untilOpened()
    await user.click(screen.getByRole('button', { name: '버리기' }))
    expect(await screen.findByText('자산 합계')).toBeTruthy()
    expect(accounts.updated).toEqual([])
    expect(screen.getByRole('link', { name: '급여통장 1,250,000원, 수정' })).toBeTruthy()
  })

  it('뒤로와 Esc도 바꾼 값이 있으면 묻는다', async () => {
    const opened = await openFromList()
    await rename(opened.user)
    await untilUnshielded()
    await act(() => opened.router.navigate(-1))
    await untilOpened()
    expect(dialog()).toBeTruthy()
    await opened.user.click(screen.getByRole('button', { name: '계속 쓰기' }))
    await untilUnshielded()
    await opened.user.keyboard('{Escape}')
    expect(dialog()).toBeTruthy()
  })
})

describe('불러오는 중과 처리 중', () => {
  it('주소로 바로 열면 목록을 받는 동안 입력칸 모양의 뼈대를 보이고 저장 자리를 숨긴다', async () => {
    const answer = delayed()
    accounts.response = answer.respond
    await openApp(editPath(id.salary))
    await screen.findByRole('heading', { level: 1, name: '계좌 수정' })
    await answer.arrived
    expect(await screen.findByText('불러오고 있어요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelectorAll('[aria-hidden="true"] [class*="fieldBox"]')).toHaveLength(4)
    answer.answer(accountsBody(salary))
    await untilForm()
    expect(name().value).toBe('급여통장')
    expect(saveButton()).toBeTruthy()
  })

  it('저장하는 동안 저장 버튼만 처리 중이고 칸은 그대로 바꿀 수 없으며, 닫기와 Esc로 닫히지 않는다', async () => {
    const answer = delayed()
    accounts.updateResponse = answer.respond
    const opened = await openFromList()
    const { user } = opened
    await rename(user)
    await user.click(saveButton())
    await answer.arrived
    expect(saveButton().getAttribute('aria-busy')).toBe('true')
    expect([name().readOnly, balance().readOnly]).toEqual([true, true])
    expect(typeGroup().getAttribute('aria-readonly')).toBe('true')
    await user.click(closeButton())
    await user.keyboard('{Escape}')
    await settle()
    expect(dialog()).toBeNull()
    expect(path(opened)).toBe(editPath(id.salary))
    answer.answer(HttpResponse.json({ ...salary, name: '월급통장' }))
    await waitFor(() => expect(path(opened)).toBe('/accounts'))
    expect(toastRegion().textContent).toBe('저장했어요')
  })
})

describe('그사이 지워짐(R6, N-01)', () => {
  it('받은 목록에 없는 계좌면 찾을 수 없음이다', async () => {
    await openApp(editPath(id.gone))
    expect(await screen.findByText(notFound)).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: '계좌 수정' })).toBeNull()
  })

  it('주소의 id가 UUID 모양이 아니면 요청하지 않고 찾을 수 없음이다', async () => {
    await openApp(editPath('id-급여통장'))
    expect(await screen.findByText(notFound)).toBeTruthy()
    await settle()
    expect(accounts.requests).toEqual([])
  })

  it('저장했는데 그사이 지워졌으면(404) 찾을 수 없음이고 계좌 목록을 다시 받는다', async () => {
    const opened = await openFromList()
    accounts.items = accounts.items.filter((item) => item !== salary)
    await rename(opened.user)
    await opened.user.click(saveButton())
    expect(await screen.findByText(notFound)).toBeTruthy()
    expect(dialog()).toBeNull()
    await waitFor(() => expect(accounts.requests).toHaveLength(2))
  })
})

describe('연결이 없을 때(R1, #238, P-902)', () => {
  it('화면은 열리고 값을 쓸 수 있지만 저장은 비활성이고 바로 위에 "연결되면 저장할 수 있어요"를 보인다. 돌아오면 지운다', async () => {
    const opened = await open()
    act(() => goOffline())
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect((saveButton().previousElementSibling as HTMLElement).textContent).toBe(offlineReason)
    await rename(opened.user)
    await opened.user.click(saveButton())
    await opened.user.keyboard('{Enter}')
    expect(accounts.updated).toEqual([])
    act(() => goOnline())
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(saveButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('저장 중에 끊기면 "연결이 끊겨 저장하지 못했어요."와 "다시 시도"(연결이 없는 동안 비활성)이고 값이 남는다', async () => {
    accounts.updateResponse = () => HttpResponse.error()
    const opened = await open()
    await rename(opened.user)
    await opened.user.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toBe(lost)
    expect(screen.queryByText(offlineReason)).toBeNull()
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    expect(name().value).toBe('월급통장')
    accounts.updateResponse = undefined
    act(() => goOnline())
    await opened.user.click(retryButton())
    expect(await screen.findByText('월급통장')).toBeTruthy()
    expect(sentBodies().map((body) => body.name)).toEqual(['월급통장', '월급통장'])
  })

  it.each([
    ['서버 오류', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 응답', () => HttpResponse.json({ id: id.salary })],
  ])('%s면 "문제가 생겨 저장하지 못했어요."와 "다시 시도"이고 값이 남는다', async (_, response) => {
    accounts.updateResponse = response
    const { user } = await open()
    await rename(user)
    await user.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toBe(failed)
    expect(name().value).toBe('월급통장')
    expect(retryButton()).toBeTruthy()
  })
})

describe('연결 없이 열기(기기 사본, P-902)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const now = Date.parse('2026-11-26T12:00:00+09:00')
  const LEDGER = ledgerIdOf('user-1')
  /** 사본은 서버의 값과 다르게 해 어느 쪽으로 채웠는지 안다 */
  const copied = { ...salary, name: '사본의 통장', openingBalance: 700000, openingDate: '2026-11-02' }

  async function seedDevice(copy: unknown[] | undefined) {
    await seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 10 * DAY })
    await seedMeCopy('user-1', meOf('user-1'), now - DAY)
    if (copy) await seedLedgerCopy('user-1', LEDGER, 'accounts', copy, now - DAY)
  }

  /** 연결 없음과 같은 실패로 연다(확인하지 못한 로그인). 화면의 요청도 연결 문제로 실패한다 */
  async function openOffline(path: string) {
    backend.cookieUser = undefined
    backend.refreshResponse = () => HttpResponse.error()
    accounts.response = () => HttpResponse.error()
    return openApp(path)
  }

  it('기기에 남긴 계좌 값으로 채우고 저장은 비활성이다', async () => {
    await seedDevice([copied])
    await openOffline(editPath(id.salary))
    await untilForm()
    expect([name().value, balance().value, date().textContent]).toEqual(['사본의 통장', '700,000', '11월 2일 (월)'])
    expect(saveButton().getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(offlineReason)).toBeTruthy()
  })

  it('사본에 그 계좌가 없으면 찾을 수 없음 대신 "불러오지 못했어요."와 "연결되면 자동으로 불러올게요."이고, 연결되면 받아 채운다(planner P3)', async () => {
    await seedDevice([{ ...copied, id: id.card }])
    await openOffline(editPath(id.salary))
    expect(await screen.findByText(waitForConnection)).toBeTruthy()
    expect(screen.getByText(loadFailed)).toBeTruthy()
    expect(screen.queryByText(notFound)).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    backend.refreshResponse = undefined
    backend.cookieUser = 'user-1'
    accounts.response = undefined
    act(() => goOnline())
    await untilForm()
    expect(name().value).toBe('급여통장')
  })

  it('사본이 시작 잔액을 담기 전의 것이면 채우지 않고 "불러오지 못했어요."다', async () => {
    await seedDevice([{ ...copied, openingBalance: undefined }])
    await openOffline(editPath(id.salary))
    expect(await screen.findByText(waitForConnection)).toBeTruthy()
    expect(screen.queryByLabelText('이름')).toBeNull()
  })
})

describe('불러오지 못함(연결은 있음)', () => {
  it('서버 오류로 받지 못하면 "불러오지 못했어요.", "잠시 후 다시 시도해 주세요."와 "다시 시도"이고, 다시 받으면 채운다', async () => {
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openApp(editPath(id.salary))
    expect(await screen.findByText(loadFailed)).toBeTruthy()
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    accounts.response = undefined
    await opened.user.click(retryButton())
    await untilForm()
    expect(name().value).toBe('급여통장')
  })
})

describe('로그인이 풀림(R5, #234 쓰던 값)', () => {
  it('저장할 때 로그인이 풀려 있으면 값을 남기고 로그인 화면으로 가며, 같은 계정으로 로그인하면 이 화면에 돌아와 값을 다시 채운다', async () => {
    const opened = await openFromList()
    const { user } = opened
    await rename(user)
    await user.clear(balance())
    await user.type(balance(), '1100000')
    backend.expireTokens()
    backend.cookieUser = undefined
    await user.click(saveButton())
    expect(await screen.findByText('쓰던 내용은 이 기기에 남아 있어요.')).toBeTruthy()
    expect(accounts.updated).toHaveLength(1)
    backend.loginUser = 'user-1'
    await user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    await untilForm()
    await waitFor(() => expect(name().value).toBe('월급통장'))
    expect(balance().value).toBe('1,100,000')
    expect(path(opened)).toBe(editPath(id.salary))
    // 채운 값은 바꾼 값이라 닫으면 묻는다. 저장은 사용자가 다시 누른다
    expect(accounts.updated).toHaveLength(1)
  })
})
