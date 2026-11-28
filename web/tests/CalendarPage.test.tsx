import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { seedPending } from './support/device'
import { readCssRule } from './support/cssRule'
import { readWebFile } from './support/webFile'
import { installIntersectionObserver, type Intersection } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { untilShown } from './support/shownScreen'
import { passTime } from './support/testClock'
import { toastRegion } from './support/toast'
import {
  expenseOf,
  incomeOf,
  startDailyTotals,
  startTransactionList,
  transferOf,
  type DailyTotals,
  type TransactionList,
} from './support/transactionList'
import { id, LEDGER, openApp, resetGlobals, saveAmount, settle, startServer, type Opened } from './support/transactionScreen'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'

const CSS = 'src/features/transactions/CalendarPage.module.css'
const loading = '불러오고 있어요.'
const failed = '불러오지 못했어요.'
const emptyDay = '이날 거래가 없어요'

const server = startMockServer()
let backend: Backend
let started: ReturnType<typeof startServer>
let list: TransactionList
let daily: DailyTotals
let intersection: Intersection

// 2026년 11월 26일 목요일
const NOW = '2026-11-26T12:30:00+09:00'

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  started = startServer(server)
  backend = started.backend
  list = startTransactionList(server, backend)
  daily = startDailyTotals(server, backend, list)
  intersection = installIntersectionObserver()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

/** 11월: 18일 지출 둘, 25일 수입·지출과 이체·취소, 26일 지출, 10일 이체만, 12일 취소만 */
function november() {
  const items = {
    lunch: expenseOf({ occurredOn: '2026-11-26', occurredTime: '12:30', accountId: id.card, categoryId: id.dining, amount: 9000, payee: '올래국수' }),
    dinner: expenseOf({ occurredOn: '2026-11-18', occurredTime: '19:00', accountId: id.card, categoryId: id.dining, amount: 12000, payee: '저녁' }),
    cafe: expenseOf({ occurredOn: '2026-11-18', occurredTime: '09:10', accountId: id.card, categoryId: id.food, amount: 4500, payee: '카페' }),
    salary: incomeOf({ occurredOn: '2026-11-25', occurredTime: '18:00', accountId: id.salary, categoryId: id.pay, amount: 3209999 }),
    canceled: expenseOf({ occurredOn: '2026-11-25', occurredTime: '13:05', accountId: id.wallet, categoryId: id.food, amount: 25000, payee: '김밥천국' }, { status: 'CANCELED' }),
    payment: transferOf({ occurredOn: '2026-11-25', fromAccountId: id.salary, toAccountId: id.card, amount: 450000 }),
    bus: expenseOf({ occurredOn: '2026-11-25', accountId: id.card, categoryId: id.traffic, amount: 20000 }),
    moving: transferOf({ occurredOn: '2026-11-10', fromAccountId: id.salary, toAccountId: id.saving, amount: 100000 }),
    refused: expenseOf({ occurredOn: '2026-11-12', accountId: id.card, categoryId: id.food, amount: 7000 }, { status: 'CANCELED' }),
  }
  list.months.set('2026-11', Object.values(items))
  return items
}

const main = () => screen.getByRole('main')
const grid = () => screen.getByRole('grid')
const monthHeading = () => screen.getByRole('heading', { level: 2 })
const monthButton = (name: '이전 달' | '다음 달') => within(main()).queryByRole('button', { name })
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
/** 날짜 칸. 이름은 "11월 18일, 지출 …"으로 시작한다 */
const cell = (monthAndDay: string) =>
  within(grid()).getByRole('gridcell', { name: new RegExp(`^${monthAndDay},`) })
const cellTexts = (monthAndDay: string) =>
  [...cell(monthAndDay).querySelectorAll('[class*="_figure_"]')].map((figure) => figure.textContent)
const selectedCell = () => within(grid()).getAllByRole('gridcell').find((each) => each.getAttribute('aria-selected') === 'true')
const dayHeading = () => screen.getByRole('heading', { level: 3 })
const dayTotals = () => dayHeading().nextElementSibling?.textContent ?? ''
const rows = () => within(main()).queryAllByRole('listitem').flatMap((item) => within(item).queryAllByRole('link'))
const dailyMonths = () => daily.requests.map(({ month }) => month)

/** 넓은 화면(1280px): CSS의 폭 조건과 화면 코드의 matchMedia를 함께 맞춘다 */
function wideWindow() {
  installMatchMedia(1280)
  setViewportWidth(1280)
}

/** 달력을 열고 날짜별 합계와 고른 날 목록이 다 올 때까지 기다린다. */
async function openCalendar(path = '/transactions/calendar?month=2026-11') {
  const opened = await openApp(path)
  await screen.findByRole('grid')
  await waitFor(() =>
    expect(screen.queryAllByRole('heading', { level: 3 }).length + screen.queryAllByText(failed).length).toBeGreaterThan(0),
  )
  await settle()
  return opened
}

/** 내역에서 "달력"을 눌러 연다. */
async function openFromHistory(month = '2026-11') {
  const opened = await openApp(`/transactions?month=${month}`)
  const link = await screen.findByRole('link', { name: '달력' })
  await opened.user.click(link)
  await screen.findByRole('grid')
  await settle()
  return opened
}

describe('들어오는 길과 틀', () => {
  it('내역(D-01)의 월 이동 오른쪽 "달력" 아이콘 버튼이 지금 고른 달의 달력을 연다(방문 기록을 쌓는다)', async () => {
    november()
    const opened = await openApp('/transactions?month=2026-10')
    const link = await screen.findByRole('link', { name: '달력' })
    // 월 이동(다음 달 버튼)보다 뒤에 있다
    const next = within(main()).getByRole('button', { name: '다음 달' })
    expect(next.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await opened.user.click(link)
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-10'))
    expect(opened.router.state.historyAction).toBe('PUSH')
    expect(await screen.findByRole('heading', { level: 2, name: '10월' })).toBeTruthy()
  })

  it('하위 화면이다: 상단 바에 "뒤로"와 화면 이름 "달력"(h1), 하단 탭이 있고 강조 탭은 내역이다', async () => {
    november()
    await openCalendar()
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByRole('button', { name: '뒤로' })).toBeTruthy()
    expect(bar.getByRole('heading', { level: 1, name: '달력' })).toBeTruthy()
    const tabs = within(screen.getByRole('navigation', { name: '주 메뉴' }))
    expect(tabs.getByRole('link', { name: '내역' }).getAttribute('aria-current')).toBe('page')
  })

  it('/transactions/calendar는 거래 상세로 열리지 않는다', async () => {
    november()
    await openCalendar('/transactions/calendar?month=2026-11')
    expect(screen.queryByRole('heading', { level: 1, name: '거래 상세' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: '달력' })).toBeTruthy()
  })

  it('달 합계는 그 달 하나만, 고른 날 목록은 그날과 50건으로 요청한다', async () => {
    november()
    await openCalendar()
    expect(daily.requests).toEqual([{ ledgerId: LEDGER, user: 'user-1', month: '2026-11', names: ['month'] }])
    expect(list.dayRequests).toEqual([
      { ledgerId: LEDGER, user: 'user-1', date: '2026-11-26', limit: '50', cursor: null, names: ['date', 'limit'] },
    ])
    // 달 목록은 받지 않는다
    expect(list.requests.filter(({ month }) => month !== null)).toEqual([])
  })
})

describe('월 이동', () => {
  it('주소의 달을 2단계 제목으로 보이고, 옮기면 주소의 달을 바꾸고(방문 기록을 쌓지 않는다) 그 달을 받는다', async () => {
    november()
    const opened = await openCalendar()
    expect(monthHeading().textContent).toBe('11월')
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-10'))
    expect(opened.router.state.historyAction).toBe('REPLACE')
    // 같은 화면이라 새 화면에만 있는 요소가 없다. 주소는 화면보다 먼저 바뀌므로 바뀐 주소가 그려진 뒤에 제목을 본다(#291)
    await untilShown(opened.router)
    expect(monthHeading().textContent).toBe('10월')
    await waitFor(() => expect(dailyMonths()).toEqual(['2026-11', '2026-10']))
  })

  it('다른 해의 달은 연도를 붙인다', async () => {
    await openCalendar('/transactions/calendar?month=2025-12')
    expect(monthHeading().textContent).toBe('2025년 12월')
  })

  it('2000년 1월에서는 "이전 달", 오늘이 속한 달의 12달 뒤에서는 "다음 달"을 자리는 남긴 채 숨긴다', async () => {
    await openCalendar('/transactions/calendar?month=2000-01')
    expect(monthButton('이전 달')).toBeNull()
    expect(monthButton('다음 달')).not.toBeNull()
    cleanup()
    await openCalendar('/transactions/calendar?month=2027-11')
    expect(monthButton('다음 달')).toBeNull()
    expect(monthButton('이전 달')).not.toBeNull()
  })

  it.each(['2026-13', 'abc', '1999-12', '2027-12'])(
    '주소의 달이 없거나 고를 수 없는 달(%s)이면 내역과 같게 기억한 달이나 이번 달로 연다',
    async (month) => {
      const opened = await openApp(`/transactions/calendar?month=${month}`)
      await waitFor(() => expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-11'))
      expect(opened.router.state.historyAction).toBe('REPLACE')
    },
  )

  it('주소에 달이 없으면 내역에서 기억한 달로 연다', async () => {
    const opened = await openApp('/transactions?month=2026-08')
    await screen.findByRole('link', { name: '달력' })
    await act(() => opened.router.navigate('/transactions/calendar'))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-08'))
  })

  it('옮긴 달은 내역에도 적용된다: 상단 바의 "뒤로"로 돌아가면 내역도 그 달이다', async () => {
    november()
    const opened = await openFromHistory('2026-11')
    await opened.user.click(monthButton('이전 달')!)
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('9월'))
    await opened.user.click(within(screen.getByRole('banner')).getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-09'))
    expect(await screen.findByRole('heading', { level: 1, name: '9월' })).toBeTruthy()
  })

  it('브라우저의 뒤로 가기로 돌아가도 내역이 그 달이다', async () => {
    november()
    const opened = await openFromHistory('2026-11')
    await opened.user.click(monthButton('다음 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('12월'))
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-12'))
    expect(await screen.findByRole('heading', { level: 1, name: '12월' })).toBeTruthy()
  })

  it('달을 옮기지 않고 돌아가면 내역은 들어올 때의 달이다', async () => {
    november()
    const opened = await openFromHistory('2026-11')
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
  })

  it('달력에서 옮긴 달은 그 달력을 연 내역에만 넘긴다: 다른 화면을 거쳐 달이 적힌 내역 주소를 열면 그 주소의 달이다', async () => {
    november()
    const opened = await openFromHistory('2026-11')
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('10월'))
    await act(() => opened.router.navigate('/more'))
    await act(() => opened.router.navigate('/transactions?month=2026-08'))
    await settle()
    expect(addressOf(opened)).toBe('/transactions?month=2026-08')
  })

  it('옮긴 달을 기억해, 다른 화면에서 하단 탭의 내역을 누르면 그 달이다', async () => {
    november()
    const opened = await openFromHistory('2026-11')
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('10월'))
    await act(() => opened.router.navigate('/more'))
    await opened.user.click(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('link', { name: '내역' }))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-10'))
  })

  it('주소로 바로 열어 앞 화면이 없으면 "뒤로"는 달력의 달의 내역으로 간다', async () => {
    november()
    const opened = await openCalendar('/transactions/calendar?month=2026-07')
    await opened.user.click(within(screen.getByRole('banner')).getByRole('button', { name: '뒤로' }))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-07'))
  })
})

describe('한 달 달력', () => {
  it('일요일부터 토요일까지 요일 머리가 있다', async () => {
    await openCalendar()
    const headers = within(grid()).getAllByRole('columnheader')
    expect(headers.map((header) => header.textContent)).toEqual(['일', '월', '화', '수', '목', '금', '토'])
    expect(grid().getAttribute('aria-labelledby')).toBe(monthHeading().id)
  })

  it.each([
    ['2026-02', 4],
    ['2026-11', 5],
    ['2026-08', 6],
  ])('%s는 그 달의 주 수(%i줄)만큼 줄이 있고 다른 달의 날짜 칸은 비운다', async (month, weeks) => {
    await openCalendar(`/transactions/calendar?month=${month}`)
    const bodyRows = within(grid()).getAllByRole('row').slice(1)
    expect(bodyRows).toHaveLength(weeks)
    expect(bodyRows.every((row) => row.children.length === 7)).toBe(true)
    const blanks = grid().querySelectorAll('tbody td:not([role="gridcell"])')
    expect([...blanks].every((blank) => blank.textContent === '')).toBe(true)
  })

  it('오늘 날짜는 aria-current="date"이고, 처음 고른 날은 이번 달이면 오늘이다', async () => {
    november()
    await openCalendar()
    expect(cell('11월 26일').getAttribute('aria-current')).toBe('date')
    expect(selectedCell()).toBe(cell('11월 26일'))
    expect(dayHeading().textContent).toBe('11월 26일 (목)')
  })

  it('다른 달이면 처음 고른 날은 1일이고 오늘 표시가 없다', async () => {
    await openCalendar('/transactions/calendar?month=2026-10')
    expect(selectedCell()).toBe(cell('10월 1일'))
    expect(grid().querySelector('[aria-current]')).toBeNull()
    expect(dayHeading().textContent).toBe('10월 1일 (목)')
  })

  it('날짜 칸을 누르면 그날이 고른 날이 되고 그날 목록을 받는다(주소는 그대로, 방문 기록을 쌓지 않는다)', async () => {
    const items = november()
    const opened = await openCalendar()
    await opened.user.click(cell('11월 18일'))
    await waitFor(() => expect(dayHeading().textContent).toBe('11월 18일 (수)'))
    expect(selectedCell()).toBe(cell('11월 18일'))
    expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-11')
    expect(opened.router.state.historyAction).toBe('REPLACE')
    await waitFor(() => expect(rows().map((row) => row.getAttribute('href'))).toEqual([
      `/transactions/${items.dinner.id}`,
      `/transactions/${items.cafe.id}`,
    ]))
    expect(list.dayRequests.map(({ date }) => date)).toEqual(['2026-11-26', '2026-11-18'])
  })

  it('달을 옮기면 고른 날은 그 달의 처음 규칙으로 돌아간다', async () => {
    november()
    const opened = await openCalendar()
    await opened.user.click(cell('11월 18일'))
    await waitFor(() => expect(dayHeading().textContent).toBe('11월 18일 (수)'))
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(dayHeading().textContent).toBe('10월 1일 (목)'))
    await opened.user.click(monthButton('다음 달')!)
    await waitFor(() => expect(dayHeading().textContent).toBe('11월 26일 (목)'))
  })

  it('날짜 칸은 누름 영역이 44px 이상이다', () => {
    expect(readCssRule(CSS, '.day')).toContain('height: var(--size-touch)')
  })

  it('고른 날 칸은 면 색, 오늘의 날짜 숫자는 1px 강조색 테두리 원이다', () => {
    expect(readCssRule(CSS, ".day[aria-selected='true']")).toContain('background-color: var(--color-surface)')
    const today = readCssRule(CSS, ".day[aria-current='date'] .number")
    expect(today).toContain('border: 1px solid var(--color-accent)')
    expect(today).toContain('border-radius: var(--radius-full)')
  })
})

describe('날짜 칸의 구성', () => {
  it('지출은 "원" 없이 본문 글자색, 수입은 강조색과 "+", 100만 이상은 만 단위 내림이다', async () => {
    november()
    await openCalendar()
    expect(cellTexts('11월 18일')).toEqual(['16,500'])
    expect(cellTexts('11월 25일')).toEqual(['20,000', '+320만'])
    const [expense, income] = cell('11월 25일').querySelectorAll('[class*="_figure_"]')
    expect(expense.className).toMatch(/_expense_/)
    expect(income.className).toMatch(/_income_/)
  })

  it('0원인 값은 보이지 않는다. 이체나 취소만 있는 날(서버가 주지 않는 날)은 금액이 없다', async () => {
    november()
    await openCalendar()
    expect(cellTexts('11월 26일')).toEqual(['9,000'])
    expect(cellTexts('11월 10일')).toEqual([])
    expect(cellTexts('11월 12일')).toEqual([])
    expect(cellTexts('11월 1일')).toEqual([])
  })

  it('환불이 더 큰 날(#390)의 음수 합계는 "-"와 본문 글자색이고(수입도 강조색 없이), 휴대폰 배치는 절댓값으로 줄인다', async () => {
    november()
    list.days.set('2026-11-18', { income: 0, expense: -12000 })
    list.days.set('2026-11-25', { income: -3209999, expense: -20000 })
    await openCalendar()
    expect(cellTexts('11월 18일')).toEqual(['-12,000'])
    expect(cellTexts('11월 25일')).toEqual(['-20,000', '-320만'])
    const figures = [...cell('11월 25일').querySelectorAll('[class*="_figure_"]')]
    expect(figures.map((figure) => [/_expense_/.test(figure.className), /_income_/.test(figure.className)])).toEqual([
      [true, false],
      [true, false],
    ])
    expect(cell('11월 18일').getAttribute('aria-label')).toBe('11월 18일, 지출 -12,000원, 수입 0원')
    expect(cell('11월 25일').getAttribute('aria-label')).toBe('11월 25일, 지출 -20,000원, 수입 -3,209,999원')
  })

  it('금액은 서버의 날짜별 합계다(줄의 금액으로 다시 세지 않는다)', async () => {
    november()
    list.days.set('2026-11-18', { income: 0, expense: 1009999 })
    await openCalendar()
    expect(cellTexts('11월 18일')).toEqual(['100만'])
  })

  it('접근 이름은 날짜와 지출, 수입을 원까지 읽는다', async () => {
    november()
    await openCalendar()
    expect(cell('11월 18일').getAttribute('aria-label')).toBe('11월 18일, 지출 16,500원, 수입 0원')
    expect(cell('11월 25일').getAttribute('aria-label')).toBe('11월 25일, 지출 20,000원, 수입 3,209,999원')
    expect(cell('11월 3일').getAttribute('aria-label')).toBe('11월 3일, 지출 0원, 수입 0원')
  })

  it('넓은 화면(1024px 이상)은 칸이 넓어 만 단위로 줄이지 않는다', async () => {
    wideWindow()
    november()
    await openCalendar()
    expect(cellTexts('11월 25일')).toEqual(['20,000', '+3,209,999'])
  })

  it('글자를 키워 금액이 칸에 다 들어가지 않으면 금액 대신 점 하나를 보인다(F-903)', async () => {
    november()
    const observers: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    await openCalendar()
    const target = cell('11월 25일')
    expect(target.querySelector('[class*="_dot_"]')).toBeNull()
    // 칸 안의 금액 자리보다 금액 글자가 넓어졌다
    const figures = target.querySelector<HTMLElement>('[class*="_figures_"]')!
    vi.spyOn(figures, 'clientWidth', 'get').mockReturnValue(40)
    for (const figure of figures.querySelectorAll<HTMLElement>('[class*="_figure_"]')) {
      vi.spyOn(figure, 'scrollWidth', 'get').mockReturnValue(56)
    }
    act(() => observers.forEach((callback) => callback([], {} as ResizeObserver)))
    expect(target.querySelector('[class*="_dot_"]')).not.toBeNull()
    expect(target.getAttribute('aria-label')).toBe('11월 25일, 지출 20,000원, 수입 3,209,999원')
    // 다른 칸은 그대로다
    expect(cell('11월 18일').querySelector('[class*="_dot_"]')).toBeNull()
  })

  it('점은 지름 8px의 보조 글자색 원이다(designer #300 Q7)', () => {
    const dot = readCssRule(CSS, '.dot')
    expect(dot).toContain('width: var(--space-8)')
    expect(dot).toContain('height: var(--space-8)')
    expect(dot).toContain('border-radius: var(--radius-full)')
    expect(dot).toContain('background-color: var(--color-text-secondary)')
  })
})

describe('고른 날의 머리와 거래 목록', () => {
  it.each([
    ['11월 18일', '11월 18일 (수)', '지출16,500원'],
    ['11월 25일', '11월 25일 (수)', '수입+3,209,999원지출20,000원'],
    ['11월 10일', '11월 10일 (화)', ''],
  ])('%s의 머리: 날짜와 그날 합계(0원이면 비운다)', async (name, heading, totals) => {
    november()
    const opened = await openCalendar()
    await opened.user.click(cell(name))
    await waitFor(() => expect(dayHeading().textContent).toBe(heading))
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(dayTotals()).toBe(totals)
  })

  it('머리의 합계는 그날 목록 응답의 합계다', async () => {
    november()
    list.days.set('2026-11-26', { income: 0, expense: 777 })
    await openCalendar()
    expect(dayTotals()).toBe('지출777원')
  })

  it('목록은 서버 순서(내역과 같다)이고 줄을 누르면 거래 상세다. 상세에서 뒤로 돌아오면 고른 달과 고른 날이 그대로다', async () => {
    const items = november()
    const opened = await openCalendar()
    await opened.user.click(cell('11월 25일'))
    await waitFor(() => expect(rows()).toHaveLength(4))
    // 시각 있는 거래가 시각 역순으로 먼저, 시각 없는 거래는 입력한 순서의 역순(나중에 만든 이체가 위)
    expect(rows().map((row) => row.getAttribute('href'))).toEqual([
      `/transactions/${items.salary.id}`,
      `/transactions/${items.canceled.id}`,
      `/transactions/${items.bus.id}`,
      `/transactions/${items.payment.id}`,
    ])
    await opened.user.click(rows()[0])
    await screen.findByRole('heading', { level: 1, name: '거래 상세' })
    expect(opened.router.state.location.pathname).toBe(`/transactions/${items.salary.id}`)
    await act(() => opened.router.navigate(-1))
    await screen.findByRole('grid')
    await waitFor(() => expect(dayHeading().textContent).toBe('11월 25일 (수)'))
    expect(selectedCell()).toBe(cell('11월 25일'))
    expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-11')
  })

  it('목록을 내릴 때 머리가 위에 붙는다(내역의 날짜 묶음 머리와 같다)', async () => {
    november()
    await openCalendar()
    expect(dayHeading().parentElement!.className).toMatch(/_dayHead_/)
  })

  it('그날 거래가 50건을 넘으면 목록 끝에서 다음 cursor로 이어 받는다', async () => {
    const many = Array.from({ length: 51 }, (_, index) =>
      expenseOf({ occurredOn: '2026-11-26', occurredTime: null, accountId: id.card, categoryId: id.food, amount: 1000 + index }),
    )
    list.months.set('2026-11', many)
    await openCalendar()
    expect(rows()).toHaveLength(50)
    await intersection.show()
    await waitFor(() => expect(rows()).toHaveLength(51))
    expect(list.dayRequests.map(({ cursor }) => cursor)).toEqual([null, '2026-11-26|50'])
  })

  it('이 기기에 쌓인 보내지 않은 입력도 칸, 머리, 목록에 더한다(planner #300 Q3)', async () => {
    november()
    // 저절로 보내기(#235)가 쌓인 입력을 지우지 않게 서버가 받지 않는다
    started.transactions.response = () => problem(503, 'INTERNAL_ERROR')
    await seedPending({
      userId: 'user-1',
      ledgerId: LEDGER,
      queuedAt: Date.parse(NOW),
      body: {
        id: '01900000-0000-7000-8000-00000000ffff',
        type: 'EXPENSE',
        occurredOn: '2026-11-26',
        occurredTime: '08:00',
        accountId: id.card,
        categoryId: null,
        amount: 1000,
        payee: '대기한 아침',
        memo: null,
      },
    })
    await openCalendar()
    await waitFor(() => expect(cellTexts('11월 26일')).toEqual(['10,000']))
    expect(dayTotals()).toBe('지출10,000원')
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(within(main()).getByText('보내지 않음')).toBeTruthy()
    expect(rows()[1].getAttribute('href')).toBe('/pending')
  })
})

describe('불러오는 중', () => {
  it('300ms 전에는 뼈대가 없고, 그 뒤 날짜 숫자는 그대로 둔 채 금액 자리와 거래 줄 3개 자리만 뼈대다', async () => {
    const slowDaily = delayed()
    const slowDay = delayed()
    daily.response = () => slowDaily.respond()
    list.dayResponse = () => slowDay.respond()
    await openApp('/transactions/calendar?month=2026-11')
    await screen.findByRole('grid')
    // 날짜 숫자는 바로 보인다
    expect(cell('11월 18일').textContent).toContain('18')
    expect(screen.queryByText(loading)).toBeNull()
    expect(grid().querySelector('[class*="_bar_"]')).toBeNull()
    await passTime(350)
    expect(screen.getAllByText(loading).length).toBeGreaterThan(0)
    expect(cell('11월 18일').querySelector('[class*="_bar_"]')).not.toBeNull()
    const skeletonRows = main().querySelectorAll('[aria-hidden="true"] [class*="_row_"]')
    expect(skeletonRows).toHaveLength(3)
    expect(dayHeading().textContent).toBe('11월 26일 (목)')
    slowDaily.answer(HttpResponse.json({ month: '2026-11', days: [] }))
    slowDay.answer(HttpResponse.json({ items: [], nextCursor: null, totals: { income: 0, expense: 0 }, days: [] }))
    await screen.findByText(emptyDay)
    expect(screen.queryByText(loading)).toBeNull()
  })

  it('날짜 칸은 금액이 없을 때도 두 줄 자리를 남겨 두어 내용으로 바뀔 때 밀리지 않는다', () => {
    expect(readCssRule(CSS, '.figures')).toContain('min-height: 2lh')
  })
})

describe('데이터 없음(4.2)', () => {
  it('달 전체에 거래가 없으면 칸은 날짜만, 목록 자리에 "이날 거래가 없어요"와 주 버튼 "거래 입력"', async () => {
    await openCalendar('/transactions/calendar?month=2026-10')
    expect(grid().querySelectorAll('[class*="_figure_"]')).toHaveLength(0)
    expect(screen.getByText(emptyDay)).toBeTruthy()
    expect(within(main()).getByRole('link', { name: '거래 입력' })).toBeTruthy()
  })

  it('거래가 있는 달이라도 고른 날이 비면 같은 문장과 버튼이다', async () => {
    november()
    const opened = await openCalendar()
    await opened.user.click(cell('11월 3일'))
    expect(await screen.findByText(emptyDay)).toBeTruthy()
    expect(within(main()).getByRole('link', { name: '거래 입력' })).toBeTruthy()
  })

  it('보기 전용 구성원에게는 문장만 보인다', async () => {
    backend.meResponse = () => {
      const me = meOf('user-1')
      return HttpResponse.json({ ...me, ledgers: [{ ...me.ledgers[0], role: 'VIEWER' }] })
    }
    await openCalendar('/transactions/calendar?month=2026-10')
    expect(screen.getByText(emptyDay)).toBeTruthy()
    expect(within(main()).queryByRole('link', { name: '거래 입력' })).toBeNull()
  })

  it('"거래 입력"은 날짜를 고른 날로 채운 거래 입력을 열고, 저장하면 달력으로 돌아와 토스트와 그날 칸·목록에 저장한 거래가 보인다', async () => {
    november()
    const opened = await openCalendar()
    await opened.user.click(cell('11월 3일'))
    fireEvent.click(await within(main()).findByRole('link', { name: '거래 입력' }))
    await waitFor(() => expect(opened.router.state.location.pathname).toBe('/transactions/new'))
    const date = await screen.findByRole('button', { name: /^날짜/ })
    await waitFor(() => expect(date.textContent).toContain('11월 3일 (화)'))
    const before = { day: list.dayRequests.length, daily: daily.requests.length }
    // 저장하면 목록 서버에도 있다. 달력은 저장 뒤 장부 무효화로 다시 받는다(가짜 목록 서버는 만들기와 따로라 미리 넣는다)
    list.months.get('2026-11')!.push(
      expenseOf({ occurredOn: '2026-11-03', accountId: id.salary, categoryId: id.expenseNone, amount: 7000 }),
    )
    await saveAmount(opened.user, '7000')
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-11'))
    expect(within(toastRegion()).getByText('저장했어요')).toBeTruthy()
    await waitFor(() => expect(dayHeading().textContent).toBe('11월 3일 (화)'))
    await waitFor(() => expect(list.dayRequests.length).toBeGreaterThan(before.day))
    expect(daily.requests.length).toBeGreaterThan(before.daily)
    await waitFor(() => expect(cellTexts('11월 3일')).toEqual(['7,000']))
    await waitFor(() => expect(rows()).toHaveLength(1))
  })
})

describe('불러오지 못함', () => {
  it('서버 오류면 달력 아래에 "불러오지 못했어요.", "잠시 후 다시 시도해 주세요."와 "다시 시도"를 보이고 칸은 날짜만이다', async () => {
    november()
    daily.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openCalendar()
    expect(screen.getByText(failed)).toBeTruthy()
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(grid()).toBeTruthy()
    expect(grid().querySelectorAll('[class*="_figure_"]')).toHaveLength(0)
    // 달력 아래에 있다
    expect(grid().compareDocumentPosition(screen.getByText(failed)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    daily.response = undefined
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(cellTexts('11월 18일')).toEqual(['16,500']))
    expect(screen.queryByText(failed)).toBeNull()
  })

  it('고른 날 목록을 받지 못해도 같고, "다시 시도"는 받지 못한 것만 다시 요청한다', async () => {
    november()
    list.dayResponse = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openCalendar()
    expect(screen.getByText(failed)).toBeTruthy()
    expect(cellTexts('11월 18일')).toEqual(['16,500'])
    list.dayResponse = undefined
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(daily.requests).toHaveLength(1)
  })

  it('"다시 시도"가 연달아 두 번 실패하면 오류 문구 아래에 "마지막으로 맞춘 시각 {시각}"을 보인다', async () => {
    november()
    daily.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openCalendar()
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(daily.requests).toHaveLength(2))
    await settle()
    expect(screen.queryByText(/^마지막으로 맞춘 시각/)).toBeNull()
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(daily.requests).toHaveLength(3))
    expect(await screen.findByText(/^마지막으로 맞춘 시각 \d{2}:\d{2}$/)).toBeTruthy()
  })

  it('응답이 약속과 다르면 같다', async () => {
    daily.response = () => HttpResponse.json({ month: '2026-10', days: [] })
    await openCalendar()
    expect(screen.getByText(failed)).toBeTruthy()
  })

  it('연결 없이 들어오면 달력 아래에 "연결되면 자동으로 불러올게요."(버튼 없음)를 보이고, 연결이 돌아오면 저절로 불러온다', async () => {
    november()
    // 달력이 보내는 요청이 모두 응답 없이 실패한다(연결 없음). 하나라도 우리 서버의 응답을 받으면 연결이 있는 것이다
    const lost = () => HttpResponse.error()
    daily.response = lost
    list.dayResponse = lost
    started.accounts.response = lost
    started.categories.response = lost
    await openCalendar()
    expect(screen.getByText(failed)).toBeTruthy()
    expect(screen.getByText('연결되면 자동으로 불러올게요.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    daily.response = undefined
    list.dayResponse = undefined
    started.accounts.response = undefined
    started.categories.response = undefined
    act(() => goOnline())
    await waitFor(() => expect(cellTexts('11월 26일')).toEqual(['9,000']))
    await waitFor(() => expect(rows()).toHaveLength(1))
  })

  it('보던 중에 연결이 끊기면 이미 불러온 달력과 목록은 지우지 않는다. 다른 달로 옮기면 그 달은 불러오지 못함이다', async () => {
    november()
    const opened = await openCalendar()
    daily.response = () => HttpResponse.error()
    list.dayResponse = () => HttpResponse.error()
    goOffline()
    await settle()
    expect(cellTexts('11월 26일')).toEqual(['9,000'])
    expect(rows()).toHaveLength(1)
    await opened.user.click(monthButton('이전 달')!)
    expect(await screen.findByText('연결되면 자동으로 불러올게요.')).toBeTruthy()
  })
})

describe('로그인하지 않았을 때', () => {
  it('로그인(A-02)으로 보내고, 로그인 뒤 같은 달의 달력으로 돌아온다', async () => {
    backend.cookieUser = undefined
    const opened = await openApp('/transactions/calendar?month=2026-09')
    await opened.user.type(await screen.findByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('grid')).toBeTruthy()
    expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-09')
  })
})

describe('고를 수 없는 날', () => {
  it('마지막 달에서 입력할 수 있는 날(오늘로부터 1년 뒤) 밖의 날짜 칸은 누를 수 없다(planner·designer #300 Q6)', async () => {
    const opened = await openCalendar('/transactions/calendar?month=2027-11')
    expect(cell('2027년 11월 26일').getAttribute('aria-disabled')).toBeNull()
    expect(cell('2027년 11월 27일').getAttribute('aria-disabled')).toBe('true')
    expect(cell('2027년 11월 27일').tabIndex).toBe(-1)
    await opened.user.click(cell('2027년 11월 27일'))
    await settle()
    expect(dayHeading().textContent).toBe('2027년 11월 1일')
  })
})

describe('키보드(designer #300 Q8, 00-common 5.8)', () => {
  it('고른 날 칸 하나만 Tab 순서에 든다', async () => {
    november()
    await openCalendar()
    const tabbable = within(grid()).getAllByRole('gridcell').filter((each) => each.tabIndex === 0)
    expect(tabbable).toEqual([cell('11월 26일')])
  })

  it('화살표는 초점만 하루·한 주 옮기고 Enter나 Space로 고른다', async () => {
    november()
    const opened = await openCalendar()
    act(() => cell('11월 26일').focus())
    await opened.user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(cell('11월 25일'))
    await opened.user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(cell('11월 18일'))
    expect(selectedCell()).toBe(cell('11월 26일'))
    expect(cell('11월 18일').tabIndex).toBe(0)
    await opened.user.keyboard('{Enter}')
    await waitFor(() => expect(dayHeading().textContent).toBe('11월 18일 (수)'))
    await opened.user.keyboard('{ArrowRight}')
    await opened.user.keyboard(' ')
    await waitFor(() => expect(dayHeading().textContent).toBe('11월 19일 (목)'))
  })

  it('다른 달로 넘어가는 화살표와 PageUp·PageDown은 달을 옮기고 그 날짜로 초점을 옮긴다', async () => {
    november()
    const opened = await openCalendar()
    act(() => cell('11월 26일').focus())
    await opened.user.keyboard('{PageDown}')
    await waitFor(() => expect(monthHeading().textContent).toBe('12월'))
    await waitFor(() => expect(document.activeElement).toBe(cell('12월 26일')))
    expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-12')
    await opened.user.keyboard('{ArrowDown}')
    await waitFor(() => expect(monthHeading().textContent).toBe('2027년 1월'))
    await waitFor(() => expect(document.activeElement).toBe(cell('2027년 1월 2일')))
    await opened.user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(cell('2027년 1월 9일'))
    // 고른 날은 옮긴 달의 처음 규칙(1일)이다
    expect(selectedCell()).toBe(cell('2027년 1월 1일'))
  })

  it('초점 테두리는 날짜 칸 안쪽에 그린다', () => {
    expect(readCssRule(CSS, '.day:focus-visible')).toContain('outline-offset: calc(-1 * var(--focus-ring-width))')
  })
})

describe('넓은 화면', () => {
  it('1024px 이상은 가운데 칸에 달 이동과 달력, 오른쪽 칸에 고른 날의 머리와 목록이다', async () => {
    wideWindow()
    november()
    await openCalendar()
    expect(readWebFile(CSS)).toMatch(/@media \(width >= 1024px\) \{\s*\.columns \{\s*display: grid;/)
    const monthColumn = grid().closest('[class*="_monthColumn_"]')!
    const dayColumn = dayHeading().closest('[class*="_dayColumn_"]')!
    expect(monthColumn.contains(monthHeading())).toBe(true)
    expect(monthColumn.nextElementSibling).toBe(dayColumn)
  })

  it('1B 임시: 오른쪽 칸의 거래 줄은 휴대폰과 같이 거래 상세로 간다(#244 뒤 #300 후속)', async () => {
    wideWindow()
    const items = november()
    const opened = await openCalendar()
    await opened.user.click(rows()[0])
    await waitFor(() => expect(opened.router.state.location.pathname).toBe(`/transactions/${items.lunch.id}`))
    expect(opened.router.state.historyAction).toBe('PUSH')
  })
})
