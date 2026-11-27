import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { seedLedgerCopy, seedLogin, seedMeCopy, seedPending } from './support/device'
import { untilUnshielded } from './support/dialog'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import type { TransactionDetailServer } from './support/transactionDetail'
import { deviceNow, startEditServer } from './support/transactionEdit'
import { expenseOf, incomeOf, nextId, type TransactionList } from './support/transactionList'
import { categoryItems, id, LEDGER, openApp, resetGlobals, settle, type Opened } from './support/transactionScreen'
import type { Accounts } from './support/accounts'

/*
 * 연결이 없을 때 기기 데이터로 보이는 읽기 화면(F-908, P-902, 00-common 4.3·4.5, N-03 (5), #238 PR1).
 * 홈(C-01), 내역(D-01), 계좌 목록(G-01), 카테고리(H-01), 기기에 있는 거래의 상세(D-06)를 기기에 남긴 마지막 데이터로 읽기
 * 전용으로 보이고, 잔액과 합계 머리에 "{시각} 기준"을 붙인다. 연결이 있어도 받는 동안에는 기기의 데이터를 먼저 보인다.
 */

const server = startMockServer()
let backend: Backend
let accounts: Accounts
let list: TransactionList
let detail: TransactionDetailServer

const DAY = 24 * 60 * 60 * 1000
/** 기기의 지금(deviceNow): 서울 2026-11-26(목) 12:30 */
const now = Date.parse('2026-11-26T12:30:00+09:00')
/** 사본을 받은 때. 어제라 날짜를 붙인다 */
const received = Date.parse('2026-11-25T22:10:00+09:00')
const receivedBasis = '11월 25일 (수) 22:10 기준'

const failed = '불러오지 못했어요.'
const waitForConnection = '연결되면 자동으로 불러올게요.'
const outOfRange = '연결되면 볼 수 있어요'

/** 사본은 서버의 값과 다르게 해 어느 쪽이 보이는지 안다 */
const copiedAccounts = [
  { id: id.salary, name: '사본의 통장', type: 'BANK', balance: 7000 },
  { id: id.card, name: '사본의 카드', type: 'CARD', balance: -2000 },
]
const copiedNoodle = expenseOf({
  occurredOn: '2026-11-25',
  occurredTime: '12:00',
  accountId: id.salary,
  categoryId: id.dining,
  amount: 9000,
  payee: '사본의 국수',
  memo: '사본의 메모',
})
const copiedOctober = expenseOf({ occurredOn: '2026-10-28', accountId: id.card, categoryId: id.food, amount: 3000, payee: '사본의 10월' })
const copiedSalary = incomeOf({ occurredOn: '2026-11-02', accountId: id.salary, categoryId: id.pay, amount: 100000 })

/** 2026-11-26에 받은 최근 한 달(10-27 ~ 11-26) */
function lastMonthCopy() {
  return {
    from: '2026-10-27',
    to: '2026-11-26',
    items: [copiedNoodle, copiedSalary, copiedOctober],
    days: [
      { date: '2026-11-25', income: 0, expense: 9000 },
      { date: '2026-11-02', income: 100000, expense: 0 },
      { date: '2026-10-28', income: 0, expense: 3000 },
    ],
    months: [
      { month: '2026-10', totals: { income: 0, expense: 50000 } },
      { month: '2026-11', totals: { income: 100000, expense: 200000 } },
    ],
    truncated: false,
  }
}

beforeEach(() => {
  deviceNow()
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, accounts, list, detail } = startEditServer(server))
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(async () => {
  cleanup()
  await untilUnshielded()
  resetGlobals()
})

/** 기록, 표시, 내 정보 사본과(`copies`면) 장부의 사본(계좌, 카테고리, 최근 한 달)이 있는 기기 */
async function seedDevice({ copies = true } = {}) {
  await seedLogin({ confirmedAt: now - DAY, loggedInAt: now - 10 * DAY })
  await seedMeCopy('user-1', meOf('user-1'), now - DAY)
  if (!copies) return
  await seedLedgerCopy('user-1', LEDGER, 'accounts', copiedAccounts, received)
  await seedLedgerCopy('user-1', LEDGER, 'categories', categoryItems, received)
  await seedLedgerCopy('user-1', LEDGER, 'transactions', lastMonthCopy(), received)
}

/** 이 기기에서 연결 없이 쌓은 오늘의 지출 5,000원 */
async function seedPendingLunch() {
  const body = {
    id: nextId(),
    type: 'EXPENSE' as const,
    occurredOn: '2026-11-26',
    occurredTime: '12:10',
    accountId: id.salary,
    categoryId: id.dining,
    amount: 5000,
    payee: '보낼 국수',
    memo: null,
  }
  await seedPending({ userId: 'user-1', ledgerId: LEDGER, body, queuedAt: now - 60_000 })
}

/** 연결 없음과 같은 실패로 연다(확인하지 못한 로그인). 화면의 요청도 연결 문제로 실패한다 */
async function openOffline(path: string) {
  backend.refreshResponse = () => HttpResponse.error()
  return openApp(path)
}

/** 로그인한 채 연다 */
async function openOnline(path: string) {
  backend.cookieUser = 'user-1'
  return openApp(path)
}

function reconnect() {
  backend.refreshResponse = undefined
  backend.cookieUser = 'user-1'
  act(() => goOnline())
}

const region = (name: string | RegExp) => screen.getByRole('region', { name })
const totalsRegion = () => region(/월 합계$/)
const accountsRegion = () => region('계좌 잔액')
const recentRegion = () => region('최근 거래')
const main = () => screen.getByRole('main')
const queryBasis = (scope: HTMLElement) => within(scope).queryByText(/ 기준$/)

/** 화면 읽기에 보이는 글. aria-hidden인 것(작은 글자로 내린 큰 숫자의 짝)은 뺀다. */
function shownText(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove())
  return copy.textContent ?? ''
}

async function openHome(open: (path: string) => Promise<Opened>) {
  const opened = await open('/home')
  await screen.findByRole('heading', { level: 1, name: '홈' })
  return opened
}

describe('홈(C-01)', () => {
  it('연결이 없으면 이번 달 합계와 계좌 잔액을 기기의 값으로 보이고 머리 줄 오른쪽에 기준 시각을 붙인다', async () => {
    await seedDevice()
    await openHome(openOffline)
    await waitFor(() => expect(shownText(totalsRegion())).toContain('200,000원'))
    expect(within(totalsRegion()).getByText(receivedBasis)).toBeTruthy()
    expect(shownText(totalsRegion())).toContain('+100,000원')
    const balances = within(accountsRegion()).getByRole('link')
    expect(balances.getAttribute('aria-label')).toBe(`계좌 잔액, 자산 합계 5,000원, ${receivedBasis}`)
    expect(within(accountsRegion()).getByText(receivedBasis)).toBeTruthy()
    // 최근 거래에는 기준 시각을 붙이지 않는다(잔액과 합계에만, N-03 (5))
    expect(await within(recentRegion()).findByText('사본의 국수')).toBeTruthy()
    expect(queryBasis(recentRegion())).toBeNull()
  })

  it('(2)와 (5)에는 보내지 않은 입력을 넣지 않고, 최근 거래와 그날 합계에는 섞는다(작성자 판단 43, planner #102)', async () => {
    await seedDevice()
    await seedPendingLunch()
    await openHome(openOffline)
    await within(recentRegion()).findByText('보낼 국수')
    expect(shownText(totalsRegion())).toContain('200,000원')
    expect(within(totalsRegion()).getByText('보내지 않은 입력 1건은 아직 합계에 없어요')).toBeTruthy()
    expect(within(accountsRegion()).getByRole('link').getAttribute('aria-label')).toContain('자산 합계 5,000원')
    const titles = within(recentRegion())
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent)
    expect(titles).toEqual(['11월 26일 (목)', '11월 25일 (수)', '11월 2일 (월)', '10월 28일 (수)'])
    // 보내지 않은 입력이 있는 날의 머리 합계에는 그것을 더한다
    expect(within(recentRegion()).getByRole('heading', { level: 3, name: /^11월 26일/ }).parentElement!.textContent).toContain('5,000원')
    expect(recentRegion().textContent).toContain('사본의 10월')
  })

  it('기기에 남은 것이 없으면 구역마다 "불러오지 못했어요."와 "연결되면 자동으로 불러올게요."만 보이고 버튼이 없다', async () => {
    await seedDevice({ copies: false })
    await openHome(openOffline)
    for (const each of [totalsRegion, accountsRegion, recentRegion]) {
      expect(await within(each()).findByText(waitForConnection)).toBeTruthy()
      expect(within(each()).getByText(failed)).toBeTruthy()
      expect(within(each()).queryByRole('button')).toBeNull()
    }
  })

  it('연결이 있으면 받는 동안 뼈대 대신 기기의 값을 먼저 보이고(4.5) 기준 시각은 없으며, 받으면 바꾼다', async () => {
    await seedDevice()
    list.totals.set('2026-11', { income: 0, expense: 777000 })
    const totals = delayed()
    list.response = (sent) => (sent.month === '2026-11' ? totals.respond() : undefined)
    await openHome(openOnline)
    await waitFor(() => expect(shownText(totalsRegion())).toContain('200,000원'))
    expect(queryBasis(totalsRegion())).toBeNull()
    expect(document.querySelector('[class*="skeleton"]')).toBeNull()
    list.response = undefined
    totals.answer(HttpResponse.json({ items: [], nextCursor: null, totals: { income: 0, expense: 777000 }, days: [] }))
    await waitFor(() => expect(shownText(totalsRegion())).toContain('777,000원'))
    expect(queryBasis(totalsRegion())).toBeNull()
  })

  it('연결된 채 서버 오류로 새로 받지 못하면 기기의 값을 기준 시각과 함께 보인다(N-03)', async () => {
    await seedDevice()
    list.response = (sent) => (sent.month !== null ? problem(500, 'INTERNAL_ERROR') : undefined)
    await openHome(openOnline)
    await waitFor(() => expect(within(totalsRegion()).queryByText(receivedBasis)).not.toBeNull())
    expect(shownText(totalsRegion())).toContain('200,000원')
    expect(within(totalsRegion()).queryByText(failed)).toBeNull()
  })

  it('보던 중에 연결이 끊기면 보이던 값을 그대로 두고 그 값을 받은 시각을 붙이며, 연결이 돌아오면 지운다', async () => {
    list.totals.set('2026-11', { income: 0, expense: 321000 })
    await openHome(openOnline)
    await waitFor(() => expect(shownText(totalsRegion())).toContain('321,000원'))
    expect(queryBasis(totalsRegion())).toBeNull()
    act(() => goOffline())
    expect(within(totalsRegion()).getByText('12:30 기준')).toBeTruthy()
    expect(within(accountsRegion()).getByText('12:30 기준')).toBeTruthy()
    expect(shownText(totalsRegion())).toContain('321,000원')
    act(() => goOnline())
    await waitFor(() => expect(queryBasis(totalsRegion())).toBeNull())
    expect(queryBasis(accountsRegion())).toBeNull()
  })
})

describe('내역(D-01)', () => {
  const openMonth = async (month: string, open = openOffline) => {
    const opened = await open(`/transactions?month=${month}`)
    await screen.findByRole('heading', { level: 1 })
    return opened
  }
  /** 합계(목록 위의 첫 dl). 날짜 묶음 머리에도 "수입"이 있다 */
  const totalsText = () => main().querySelector('dl')!.textContent

  it('연결이 없으면 기기의 최근 한 달로 그 달을 보이고, 합계는 받아 둔 그 달 합계에 보내지 않은 입력을 더한다', async () => {
    await seedDevice()
    await seedPendingLunch()
    await openMonth('2026-11')
    expect(await screen.findByText('사본의 국수')).toBeTruthy()
    expect(screen.getByText('보낼 국수')).toBeTruthy()
    expect(totalsText()).toBe('수입+100,000원지출205,000원')
    expect(screen.getByText(receivedBasis)).toBeTruthy()
    // 11월 1일이 저장 범위(10-27부터) 안이라 끝에 안내가 없다
    expect(screen.queryByText(outOfRange)).toBeNull()
    expect(screen.queryByText(failed)).toBeNull()
  })

  it('그 달의 앞쪽 일부가 저장 범위 밖이면(지난달) 남은 거래를 보이고 목록 끝에 "연결되면 볼 수 있어요"를 둔다', async () => {
    await seedDevice()
    await openMonth('2026-10')
    expect(await screen.findByText('사본의 10월')).toBeTruthy()
    expect(totalsText()).toBe('수입0원지출50,000원')
    const end = screen.getByText(outOfRange)
    expect(end.compareDocumentPosition(screen.getByText('사본의 10월')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('저장 범위 밖의 달로 옮기면 목록 자리에 "연결되면 볼 수 있어요"만 보이고 합계가 없다', async () => {
    await seedDevice()
    await openMonth('2026-09')
    expect(await screen.findByText(outOfRange)).toBeTruthy()
    expect(screen.queryByText('수입')).toBeNull()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  })

  it.each([
    ['2026-12', 'in-place'],
    ['2026-11', 'none'],
    ['2026-10', 'end'],
  ])('날이 바뀐 뒤 연결 없이 열어도 저장 범위는 사본의 것(10-27 ~ 11-26)이다: %s', async (month, shown) => {
    setDeviceClock('2026-12-02T09:00:00+09:00')
    await seedDevice()
    await openMonth(month)
    if (shown === 'in-place') {
      expect(await screen.findByText(outOfRange)).toBeTruthy()
      expect(screen.queryByText('수입')).toBeNull()
      return
    }
    await waitFor(() => expect(main().querySelector('dl')).not.toBeNull())
    expect(screen.queryByText(outOfRange) !== null).toBe(shown === 'end')
  })

  it('기기에 남은 최근 한 달이 없으면 "불러오지 못했어요."와 "연결되면 자동으로 불러올게요."이고 버튼이 없다', async () => {
    await seedDevice()
    await seedLedgerCopy('user-1', LEDGER, 'transactions', null, received)
    await openMonth('2026-11')
    expect(await screen.findByText(waitForConnection)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
  })

  it('보던 중에 연결이 끊기면 받은 목록을 그대로 두고 합계 머리에 받은 시각을 붙인다', async () => {
    list.months.set('2026-11', [expenseOf({ occurredOn: '2026-11-20', accountId: id.salary, categoryId: id.food, amount: 4000, payee: '서버의 가게' })])
    await openMonth('2026-11', openOnline)
    await screen.findByText('서버의 가게')
    expect(screen.queryByText(/ 기준$/)).toBeNull()
    act(() => goOffline())
    expect(screen.getByText('12:30 기준')).toBeTruthy()
    expect(screen.getByText('서버의 가게')).toBeTruthy()
    act(() => goOnline())
    await waitFor(() => expect(screen.queryByText(/ 기준$/)).toBeNull())
  })
})

describe('계좌 목록(G-01)과 카테고리(H-01)', () => {
  const totalRow = () => screen.getByText('자산 합계').parentElement!

  it('연결이 없으면 기기에 남긴 계좌 목록을 보이고 자산 합계 옆에 기준 시각을 붙인다', async () => {
    await seedDevice()
    await openOffline('/accounts')
    expect(await screen.findByText('사본의 통장')).toBeTruthy()
    // 기준 시각은 자산 합계 줄 바로 위 한 줄이고 합계 줄은 연결이 있을 때와 같다(designer #238)
    expect(totalRow().textContent).toBe('자산 합계5,000원')
    expect(totalRow().previousElementSibling!.textContent).toBe(receivedBasis)
  })

  it('연결이 있으면 받는 동안 기기의 계좌 목록을 먼저 보이고(4.5) 받으면 바꾼다', async () => {
    await seedDevice()
    const answer = delayed()
    accounts.response = answer.respond
    await openOnline('/accounts')
    expect(await screen.findByText('사본의 통장')).toBeTruthy()
    expect(totalRow().textContent).toBe('자산 합계5,000원')
    accounts.response = undefined
    answer.answer(HttpResponse.json({ items: [{ id: id.salary, name: '서버의 통장', type: 'BANK', balance: 1000 }] }))
    expect(await screen.findByText('서버의 통장')).toBeTruthy()
  })

  it('서버 오류로 불러오지 못한 채(기기에 남은 것 없음) 연결이 끊기면 둘째 줄이 바뀌고 "다시 시도"가 사라진다(N-03)', async () => {
    await seedDevice({ copies: false })
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    await openOnline('/accounts')
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeTruthy()
    act(() => goOffline())
    expect(screen.getByText(waitForConnection)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    accounts.response = undefined
    act(() => goOnline())
    expect(await screen.findByText('급여통장')).toBeTruthy()
  })

  it('카테고리도 연결이 없으면 기기에 남긴 목록으로 보이고, 합계가 없어 기준 시각은 없다', async () => {
    await seedDevice()
    await seedLedgerCopy(
      'user-1',
      LEDGER,
      'categories',
      categoryItems.map((category) => ({ ...category, name: `사본의 ${category.name}` })),
      received,
    )
    await openOffline('/categories')
    expect(await screen.findByText('사본의 식비')).toBeTruthy()
    expect(screen.queryByText(/ 기준$/)).toBeNull()
  })
})

describe('거래 상세(D-06)', () => {
  const editControl = () => within(screen.getByRole('banner')).getByText('수정').closest('a, button')!
  const deleteButton = () => screen.getByRole('button', { name: '삭제' })

  it('연결이 없으면 기기의 최근 한 달에 있는 거래를 읽기 전용으로 보이고, 수정과 삭제는 문구 없이 비활성이다', async () => {
    await seedDevice()
    const opened = await openOffline(`/transactions/${copiedNoodle.id}`)
    expect(await screen.findByText('사본의 메모')).toBeTruthy()
    expect(screen.getByText('사본의 국수')).toBeTruthy()
    expect(editControl().tagName).toBe('BUTTON')
    expect(editControl().getAttribute('aria-disabled')).toBe('true')
    expect(deleteButton().getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByText(/연결되면/)).toBeNull()
    await opened.user.click(deleteButton())
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('기기에 없는 거래는 "불러오지 못했어요."와 "연결되면 자동으로 불러올게요."이고, 연결이 돌아오면 저절로 불러온다', async () => {
    await seedDevice()
    const other = expenseOf({ occurredOn: '2026-09-01', accountId: id.salary, categoryId: id.food, amount: 1000, payee: '서버에만 있는 거래' })
    detail.put(other)
    await openOffline(`/transactions/${other.id}`)
    expect(await screen.findByText(waitForConnection)).toBeTruthy()
    expect(within(main()).queryByRole('button')).toBeNull()
    reconnect()
    expect(await screen.findByText('서버에만 있는 거래')).toBeTruthy()
  })

  it('받아 둔 거래를 보던 중에 연결이 끊기면 수정과 삭제가 비활성이 되고, 돌아오면 다시 누를 수 있다', async () => {
    const item = expenseOf({ occurredOn: '2026-11-20', accountId: id.salary, categoryId: id.food, amount: 1000, payee: '서버의 가게' })
    detail.put(item)
    await openOnline(`/transactions/${item.id}`)
    await screen.findByText('서버의 가게')
    await waitFor(() => expect(editControl().tagName).toBe('A'))
    act(() => goOffline())
    expect(editControl().getAttribute('aria-disabled')).toBe('true')
    expect(deleteButton().getAttribute('aria-disabled')).toBe('true')
    act(() => goOnline())
    expect(editControl().tagName).toBe('A')
    expect(deleteButton().getAttribute('aria-disabled')).toBeNull()
  })
})
