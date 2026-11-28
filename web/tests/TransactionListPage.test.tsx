import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { readCssRule } from './support/cssRule'
import { installIntersectionObserver, type Intersection } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { recordDom } from './support/recordDom'
import { untilShown } from './support/shownScreen'
import {
  accountField,
  id,
  LEDGER,
  openApp,
  resetGlobals,
  saveAmount,
  settle,
  startServer,
  type Opened,
} from './support/transactionScreen'
import {
  expenseOf,
  incomeOf,
  pageOf,
  startTransactionList,
  transferOf,
  type TransactionList,
} from './support/transactionList'
import { holdClock, passTime } from './support/testClock'
import { savedOf, type Transactions } from './support/transactions'
import { resetViewport, setViewportWidth } from './support/viewport'

const CSS = 'src/features/transactions/TransactionList.module.css'
const loading = '불러오고 있어요.'
const failed = '불러오지 못했어요.'
const moreFailed = '더 불러오지 못했어요'

const server = startMockServer()
let backend: Backend
let transactions: Transactions
let list: TransactionList
let intersection: Intersection

const NOW = '2026-11-26T12:30:00+09:00'

beforeEach(() => {
  // 기기의 지금(서울). 받아 둔 목록이 오래됐는지 세는 라이브러리의 시계(Date)는 공용 시계(testClock)다
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, transactions } = startServer(server))
  list = startTransactionList(server, backend)
  intersection = installIntersectionObserver()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

/** 디자인 시안과 같은 11월. 서버가 주는 순서다. */
function november() {
  return {
    lunch: expenseOf({
      occurredOn: '2026-11-26',
      occurredTime: '12:30',
      accountId: id.card,
      categoryId: id.dining,
      amount: 9000,
      payee: '올래국수',
    }),
    cafe: expenseOf({
      occurredOn: '2026-11-26',
      occurredTime: '08:10',
      accountId: id.salary,
      categoryId: id.food,
      amount: 19500,
      payee: '이름이 아주 길어서 한 줄에 다 들어가지 않는 가맹점 이름',
    }),
    salary: incomeOf({
      occurredOn: '2026-11-25',
      occurredTime: '18:00',
      accountId: id.salary,
      categoryId: id.pay,
      amount: 3200000,
    }),
    canceled: expenseOf(
      { occurredOn: '2026-11-25', occurredTime: '13:05', accountId: id.wallet, categoryId: id.food, amount: 25000, payee: '김밥천국' },
      { status: 'CANCELED' },
    ),
    payment: transferOf({ occurredOn: '2026-11-25', fromAccountId: id.salary, toAccountId: id.card, amount: 450000 }),
    bus: expenseOf({ occurredOn: '2026-11-25', accountId: id.card, categoryId: id.traffic, amount: 20000 }),
  }
}

function putNovember() {
  const items = november()
  list.months.set('2026-11', Object.values(items))
  return items
}

const main = () => screen.getByRole('main')
const monthHeading = () => screen.getByRole('heading', { level: 1 })
const monthButton = (name: '이전 달' | '다음 달') => within(main()).queryByRole('button', { name })
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const styleOf = (element: Element) => getComputedStyle(element)
const texts = (elements: Element[]) => elements.map((element) => element.textContent)
/** 목록 위의 그 달 합계 */
const totals = () => main().querySelector('dl')!
const totalOf = (name: '수입' | '지출') =>
  [...totals().querySelectorAll('dt')].find((term) => term.textContent === name)!.nextElementSibling!
const dayHeadings = () => texts(screen.queryAllByRole('heading', { level: 2 }))
const dayHeading = (date: string) => screen.getByRole('heading', { level: 2, name: date })
/** 날짜 묶음 머리의 그날 합계. 없으면 빈 글자 */
const dayTotalsOf = (date: string) => dayHeading(date).nextElementSibling?.textContent ?? ''
const rowsOf = (date: string) => within(screen.getByRole('list', { name: date })).getAllByRole('link')
const allRows = () => within(main()).queryAllByRole('listitem').flatMap((item) => within(item).queryAllByRole('link'))
const announcement = () => main().querySelector('[aria-live="polite"]:not(h1)')!
const pageRequests = () => list.requests.filter(({ month }) => month !== null)

/** 내역을 열고 첫 쪽을 다 그릴 때까지 기다린다. */
async function openList(path = '/transactions?month=2026-11') {
  const opened = await openApp(path)
  await screen.findByRole('heading', { level: 1 })
  await waitFor(() => expect(screen.queryAllByText('수입').length + screen.queryAllByText(failed).length).toBeGreaterThan(0))
  return opened
}

describe('주소와 고른 달', () => {
  it('/transactions?month=2026-11은 공통 틀 안의 주 화면이다. 상단 바에 장부 이름만 있고 "뒤로"가 없다', async () => {
    putNovember()
    await openList()
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByText('user-1의 장부')).toBeTruthy()
    expect(bar.queryByRole('button', { name: '뒤로' })).toBeNull()
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  })

  it('달이 없으면 기기의 오늘이 속한 달로 바꿔 간다(방문 기록을 쌓지 않는다)', async () => {
    const opened = await openApp('/transactions')
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
    expect(opened.router.state.historyAction).toBe('REPLACE')
    // 라우터의 주소가 바뀐 뒤 화면이 그려질 때까지 기다린다
    expect(await screen.findByRole('heading', { level: 1, name: '11월' })).toBeTruthy()
  })

  it.each(['2026-13', '2026-1', 'abc', '1999-12', '2027-12'])(
    '주소의 달이 달 모양이 아니거나 범위 밖(%s)이면 달이 없는 것과 같다',
    async (month) => {
      const opened = await openApp(`/transactions?month=${month}`)
      await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
      expect(pageRequests().map((request) => request.month)).not.toContain(month)
    },
  )

  it('주소의 달 하나만 보낸다: 장부의 거래 목록을 그 달과 50건으로 요청한다', async () => {
    putNovember()
    await openList('/transactions?month=2026-11')
    expect(pageRequests()).toEqual([
      { ledgerId: LEDGER, user: 'user-1', month: '2026-11', limit: '50', cursor: null, names: ['month', 'limit'] },
    ])
  })

  // 시간대마다 그 시간대의 시각을 오프셋으로 적는다(11월 말~1월이라 로스앤젤레스는 겨울 시간 −08:00)
  describe.each([
    ['Asia/Seoul', '+09:00'],
    ['UTC', 'Z'],
    ['America/Los_Angeles', '-08:00'],
    ['Pacific/Kiritimati', '+14:00'],
    ['Pacific/Pago_Pago', '-11:00'],
  ])('기기의 시간대가 %s일 때 기본 달은 기기의 오늘을 따른다', (timeZone, offset) => {
    it.each([
      ['2026-11-30T23:59:59', '2026-11'],
      ['2026-12-01T00:00:00', '2026-12'],
      ['2026-12-31T23:59:59', '2026-12'],
      ['2027-01-01T00:00:00', '2027-01'],
    ])('지금이 그 시간대로 %s이면 %s', async (now, month) => {
      setDeviceClock(`${now}${offset}`, timeZone)
      const opened = await openApp('/transactions')
      await waitFor(() => expect(addressOf(opened)).toBe(`/transactions?month=${month}`))
    })
  })

  it('고른 달을 기억해, 다른 화면에 다녀와 하단 탭으로 오면 그 달이다', async () => {
    const opened = await openList('/transactions?month=2026-08')
    await act(() => opened.router.navigate('/more'))
    await opened.user.click(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('link', { name: '내역' }))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-08'))
  })

  it('달을 옮기면 옮긴 달을 기억한다', async () => {
    const opened = await openList('/transactions?month=2026-11')
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('10월'))
    await act(() => opened.router.navigate('/more'))
    await act(() => opened.router.navigate('/transactions'))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-10'))
  })

  it('주소의 달이 기억한 달보다 앞선다', async () => {
    const opened = await openList('/transactions?month=2026-08')
    await act(() => opened.router.navigate('/transactions?month=2026-03'))
    await waitFor(() => expect(monthHeading().textContent).toBe('3월'))
    expect(addressOf(opened)).toBe('/transactions?month=2026-03')
  })

  it('기억한 달은 기기 저장소에 남기지 않는다', async () => {
    const opened = await openList('/transactions?month=2026-08')
    await act(() => opened.router.navigate('/more'))
    const stored = [localStorage, sessionStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => storage.getItem(key)),
    )
    expect(stored.join()).not.toContain('2026-08')
  })

  it('로그아웃하면 기억한 달이 사라진다', async () => {
    const opened = await openList('/transactions?month=2026-08')
    const { logout } = await import('../src/api/session')
    act(() => logout())
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    await opened.user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('navigation', { name: '주 메뉴' })
    await act(() => opened.router.navigate('/transactions'))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
  })
})

describe('달 이동(00-common 5.9)', () => {
  it('가운데에 달 이름이 화면 제목(h1)으로 있고, 바뀌면 화면 읽기에 알린다', async () => {
    await openList()
    expect(monthHeading().textContent).toBe('11월')
    expect(monthHeading().getAttribute('aria-live')).toBe('polite')
    expect(styleOf(monthHeading()).font).toBe('var(--text-body-strong)')
  })

  it('양옆에 "이전 달"과 "다음 달" 아이콘 버튼이 있다', async () => {
    await openList()
    for (const name of ['이전 달', '다음 달'] as const) {
      expect(monthButton(name)!.querySelector('svg')).not.toBeNull()
      expect(monthButton(name)!.textContent).toBe('')
    }
  })

  it('누르면 주소의 달을 바꾸고(방문 기록을 쌓지 않는다) 그 달을 불러온다', async () => {
    const opened = await openList()
    await opened.user.click(monthButton('다음 달')!)
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-12'))
    expect(opened.router.state.historyAction).toBe('REPLACE')
    await waitFor(() => expect(monthHeading().textContent).toBe('12월'))
    await waitFor(() => expect(pageRequests().at(-1)?.month).toBe('2026-12'))
  })

  it('올해가 아닌 달은 연도를 붙인다', async () => {
    await openList('/transactions?month=2025-12')
    expect(monthHeading().textContent).toBe('2025년 12월')
  })

  it('2000년 1월에서는 "이전 달"을 자리만 남기고 숨긴다', async () => {
    await openList('/transactions?month=2000-01')
    expect(monthButton('이전 달')).toBeNull()
    expect(monthButton('다음 달')).not.toBeNull()
    const bar = monthHeading().parentElement!
    expect(bar.children).toHaveLength(3)
    expect(styleOf(bar).gridTemplateColumns).toBe('var(--size-touch) 1fr var(--size-touch)')
  })

  it('오늘이 속한 달의 12달 뒤에서는 "다음 달"을 숨긴다', async () => {
    await openList('/transactions?month=2027-11')
    expect(monthButton('다음 달')).toBeNull()
    expect(monthButton('이전 달')).not.toBeNull()
  })

  it('끝에 닿아 누른 버튼이 사라지면 초점을 반대쪽 버튼으로 옮긴다', async () => {
    const opened = await openList('/transactions?month=2027-10')
    await opened.user.click(monthButton('다음 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('2027년 11월'))
    expect(document.activeElement).toBe(monthButton('이전 달'))
  })

  it('달을 옮기면 합계와 목록 자리만 뼈대로 바뀌고 달 이동은 그대로다', async () => {
    putNovember()
    const opened = await openList()
    const slow = delayed()
    list.response = (sent) => (sent.month === '2026-10' ? slow.respond() : undefined)
    const bar = monthHeading().parentElement
    await opened.user.click(monthButton('이전 달')!)
    await passTime(350)
    expect(screen.getByText(loading)).toBeTruthy()
    expect(monthHeading().parentElement).toBe(bar)
    expect(monthHeading().textContent).toBe('10월')
    expect(screen.queryAllByText('수입')).toEqual([])
    slow.answer(HttpResponse.json(pageOf('2026-10', [], 0, 50)))
    await screen.findByText('10월에 입력한 거래가 없어요')
  })

  it('상단 바 아래 8px에 놓인다', () => {
    expect(readCssRule(CSS, '.monthNavigation')).toContain('margin: var(--space-8) var(--space-4) 0')
  })
})

describe('그 달의 수입·지출 합계', () => {
  it('서버가 준 합계를 보인다. 수입은 강조색과 "+", 지출은 본문 글자색이다', async () => {
    putNovember()
    list.totals.set('2026-11', { income: 3200000, expense: 1245300 })
    await openList()
    expect(texts([...totals().querySelectorAll('dt')])).toEqual(['수입', '지출'])
    expect(totalOf('수입').textContent).toBe('+3,200,000원')
    expect(totalOf('지출').textContent).toBe('1,245,300원')
    expect(styleOf(totalOf('수입').firstElementChild!).color).toBe('var(--color-accent)')
    expect(styleOf(totalOf('지출').firstElementChild!).color).toBe('var(--color-text)')
  })

  it('거래가 없으면 둘 다 본문 글자색의 0원이다', async () => {
    await openList()
    expect(totalOf('수입').textContent).toBe('0원')
    expect(totalOf('지출').textContent).toBe('0원')
    expect(styleOf(totalOf('수입').firstElementChild!).color).toBe('var(--color-text)')
  })

  it('환불이 지출보다 큰 달(#390)의 음수 합계는 본문 글자색과 "-"다(00-common 2.2)', async () => {
    putNovember()
    list.totals.set('2026-11', { income: -3000, expense: -12000 })
    await openList()
    expect(totalOf('수입').textContent).toBe('-3,000원')
    expect(totalOf('지출').textContent).toBe('-12,000원')
    expect(styleOf(totalOf('수입').firstElementChild!).color).toBe('var(--color-text)')
    expect(styleOf(totalOf('지출').firstElementChild!).color).toBe('var(--color-text)')
  })

  it('이름은 보조 글자색 본문, 금액은 굵은 본문이다', async () => {
    putNovember()
    await openList()
    const name = totals().querySelector('dt')!
    expect([styleOf(name).color, styleOf(name).font]).toEqual(['var(--color-text-secondary)', 'var(--text-body)'])
    expect(styleOf(totalOf('수입')).font).toBe('var(--text-body-strong)')
  })

  it('휴대폰 배치는 두 줄(사이 8px)이고 금액이 오른쪽 끝에 붙는다', async () => {
    putNovember()
    await openList()
    setViewportWidth(390)
    expect(styleOf(totals()).flexDirection).toBe('column')
    expect(styleOf(totals()).rowGap).toBe('var(--space-8)')
    expect(styleOf(totalOf('수입')).marginInlineStart).toBe('auto')
  })

  it('넓은 화면은 한 줄이고 오른쪽에 붙으며 수입과 지출 사이가 24px이다', async () => {
    putNovember()
    await openList()
    setViewportWidth(1280)
    expect(styleOf(totals()).flexDirection).toBe('row')
    expect(styleOf(totals()).justifyContent).toBe('flex-end')
    expect(styleOf(totals()).columnGap).toBe('var(--space-24)')
  })

  it('달 이동과 8px, 아래 24px에 1px 선을 긋는다', () => {
    const rule = readCssRule(CSS, '.totals')
    expect(rule).toContain('margin: var(--space-8) 0 0')
    expect(rule).toContain('padding: 0 var(--space-16) var(--space-24)')
    expect(rule).toContain('border-bottom: 1px solid var(--color-border)')
  })

  it('선은 휴대폰 배치에서 화면 끝까지, 768px부터 내용 폭이다(계좌 목록과 같다)', async () => {
    putNovember()
    await openList()
    const history = main().firstElementChild!
    setViewportWidth(390)
    expect(styleOf(history).marginInline).toBe('calc(-1 * var(--bleed))')
    expect(styleOf(history).getPropertyValue('--bleed')).toBe('var(--space-16)')
    setViewportWidth(768)
    expect(styleOf(history).getPropertyValue('--bleed')).toBe('0px')
  })
})

describe('날짜 묶음 머리(0.5)', () => {
  it('날짜마다 묶고 머리에 날짜를 쓴다. 다른 해는 연도를 붙이고 요일을 뺀다', async () => {
    putNovember()
    await openList()
    expect(dayHeadings()).toEqual(['11월 26일 (목)', '11월 25일 (수)'])
  })

  it('다른 해의 날짜는 "2025년 11월 18일"이다', async () => {
    list.months.set('2025-11', [expenseOf({ occurredOn: '2025-11-18', accountId: id.card, categoryId: id.food, amount: 1 })])
    await openList('/transactions?month=2025-11')
    expect(dayHeadings()).toEqual(['2025년 11월 18일'])
  })

  it('지출만 있으면 지출, 수입만 있으면 수입, 둘 다면 수입과 지출, 둘 다 0이면 비운다', async () => {
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-26', accountId: id.card, categoryId: id.food, amount: 28500 }),
      incomeOf({ occurredOn: '2026-11-25', accountId: id.salary, categoryId: id.pay, amount: 3200000 }),
      expenseOf({ occurredOn: '2026-11-25', accountId: id.card, categoryId: id.food, amount: 45000 }),
      incomeOf({ occurredOn: '2026-11-24', accountId: id.salary, categoryId: id.pay, amount: 10000 }),
      transferOf({ occurredOn: '2026-11-23', fromAccountId: id.salary, toAccountId: id.card, amount: 450000 }),
    ])
    await openList()
    expect(dayTotalsOf('11월 26일 (목)')).toBe('지출28,500원')
    expect(dayTotalsOf('11월 25일 (수)')).toBe('수입+3,200,000원지출45,000원')
    expect(dayTotalsOf('11월 24일 (화)')).toBe('수입+10,000원')
    expect(dayTotalsOf('11월 23일 (월)')).toBe('')
  })

  it('환불만 있는 날(#390)의 음수 그날 합계는 0이 아니라 보이고, 본문 글자색과 "-"다(00-common 2.2)', async () => {
    putNovember()
    list.days.set('2026-11-26', { income: 0, expense: -12000 })
    list.days.set('2026-11-25', { income: -3000, expense: -500 })
    await openList()
    expect(dayTotalsOf('11월 26일 (목)')).toBe('지출-12,000원')
    expect(dayTotalsOf('11월 25일 (수)')).toBe('수입-3,000원지출-500원')
    const amounts = [...dayHeading('11월 25일 (수)').nextElementSibling!.querySelectorAll('.tabular-nums')]
    expect(amounts.map((amount) => styleOf(amount).color)).toEqual(['var(--color-text)', 'var(--color-text)'])
  })

  it('그날 합계는 서버가 준 값이다(줄의 금액으로 다시 세지 않는다)', async () => {
    putNovember()
    list.days.set('2026-11-26', { income: 0, expense: 777 })
    await openList()
    expect(dayTotalsOf('11월 26일 (목)')).toBe('지출777원')
  })

  it('합계 덩어리는 이름(보조 글자색 캡션)과 금액(라벨) 사이 4px, 덩어리 사이 12px이고 안에서 줄을 바꾸지 않는다', async () => {
    putNovember()
    await openList()
    const sums = dayHeading('11월 25일 (수)').nextElementSibling!
    const [income] = sums.children
    const [name, amount] = income.children
    expect([styleOf(name).color, styleOf(name).font]).toEqual(['var(--color-text-secondary)', 'var(--text-caption)'])
    expect(styleOf(amount).font).toBe('var(--text-label)')
    expect(styleOf(amount.firstElementChild!).color).toBe('var(--color-accent)')
    expect(styleOf(income).columnGap).toBe('var(--space-4)')
    expect(styleOf(income).whiteSpace).toBe('nowrap')
    expect(styleOf(sums).columnGap).toBe('var(--space-12)')
  })

  it('날짜는 본문 글자색 라벨이고, 날짜와 합계가 한 줄에 안 들어가면 합계가 다음 줄 오른쪽으로 내려간다', async () => {
    putNovember()
    await openList()
    const heading = dayHeading('11월 25일 (수)')
    expect([styleOf(heading).color, styleOf(heading).font]).toEqual(['var(--color-text)', 'var(--text-label)'])
    expect(styleOf(heading.parentElement!).flexWrap).toBe('wrap')
    expect(styleOf(heading.nextElementSibling!).marginInlineStart).toBe('auto')
    expect(styleOf(heading.nextElementSibling!).justifyContent).toBe('flex-end')
  })

  it('스크롤하면 위에 붙는다: 휴대폰 배치는 상단 바 아래, 넓은 화면은 화면 위. 바탕은 화면 바탕색이고 선이 없다', async () => {
    putNovember()
    await openList()
    const head = dayHeading('11월 26일 (목)').parentElement!
    expect(styleOf(head).position).toBe('sticky')
    expect(styleOf(head).backgroundColor).toBe('var(--color-bg)')
    expect(readCssRule(CSS, '.dayHead')).toContain('top: calc(var(--size-topbar) + env(safe-area-inset-top))')
    expect(readCssRule(CSS, '.dayHead')).not.toContain('border')
    setViewportWidth(1280)
    expect(styleOf(head).top).toBe('0px')
  })

  it('머리는 위 16px, 아래 4px이다', () => {
    expect(readCssRule(CSS, '.dayHead')).toContain('padding: var(--space-16) var(--row-inset, var(--space-16)) var(--space-4)')
  })
})

describe('거래 줄(0.4)', () => {
  it('서버가 준 순서 그대로 그린다', async () => {
    // 일부러 시각이 앞선 줄을 먼저 준다. 화면은 다시 정렬하지 않는다
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-26', accountId: id.card, categoryId: id.food, amount: 1, payee: '시각 없음' }),
      expenseOf({ occurredOn: '2026-11-26', occurredTime: '08:00', accountId: id.card, categoryId: id.food, amount: 2, payee: '아침' }),
      expenseOf({ occurredOn: '2026-11-26', occurredTime: '21:00', accountId: id.card, categoryId: id.food, amount: 3, payee: '저녁' }),
    ])
    await openList()
    expect(rowsOf('11월 26일 (목)').map((row) => row.querySelector('[class*="title"]')!.textContent)).toEqual([
      '시각 없음',
      '아침',
      '저녁',
    ])
  })

  it('시각, 제목, 금액, "카테고리 · 계좌"를 보인다. 하위 카테고리면 하위 이름만이다', async () => {
    putNovember()
    await openList()
    expect(texts(rowsOf('11월 26일 (목)'))).toEqual([
      '12:30올래국수9,000원외식 · 신한카드',
      '08:10이름이 아주 길어서 한 줄에 다 들어가지 않는 가맹점 이름19,500원식비 · 급여통장',
    ])
  })

  it('가맹점이 없으면 카테고리 이름, 미분류면 "미분류"가 제목이다', async () => {
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-26', accountId: id.card, categoryId: id.traffic, amount: 20000 }),
      expenseOf({ occurredOn: '2026-11-26', accountId: id.card, categoryId: id.dining, amount: 1000 }),
      expenseOf({ occurredOn: '2026-11-26', accountId: id.wallet, categoryId: id.expenseNone, amount: 3000 }),
      incomeOf({ occurredOn: '2026-11-26', accountId: id.salary, categoryId: id.incomeNone, amount: 5000 }),
    ])
    await openList()
    expect(texts(rowsOf('11월 26일 (목)'))).toEqual([
      '교통20,000원교통 · 신한카드',
      '외식1,000원외식 · 신한카드',
      '미분류3,000원미분류 · 지갑',
      '미분류+5,000원미분류 · 급여통장',
    ])
  })

  it('이체는 제목이 "이체"이고 둘째 줄이 "보내는 계좌에서 받는 계좌로"다', async () => {
    list.months.set('2026-11', [
      transferOf({ occurredOn: '2026-11-25', fromAccountId: id.salary, toAccountId: id.card, amount: 450000 }),
      transferOf({ occurredOn: '2026-11-25', fromAccountId: id.card, toAccountId: id.saving, amount: 1000 }),
    ])
    await openList()
    expect(texts(rowsOf('11월 25일 (수)'))).toEqual([
      '이체450,000원급여통장에서 신한카드로',
      '이체1,000원신한카드에서 비상금으로',
    ])
  })

  it('금액 색과 부호: 지출은 본문색, 수입은 강조색과 "+", 이체는 보조색이다', async () => {
    const items = putNovember()
    await openList()
    const amountOf = (item: { amount: unknown }, text: string) => {
      const row = allRows().find((each) => each.getAttribute('href') === `/transactions/${(item as { id: string }).id}`)!
      return within(row).getByText(text)
    }
    expect(styleOf(amountOf(items.lunch, '9,000원')).color).toBe('var(--color-text)')
    expect(styleOf(amountOf(items.salary, '+3,200,000원')).color).toBe('var(--color-accent)')
    expect(styleOf(amountOf(items.payment, '450,000원')).color).toBe('var(--color-text-secondary)')
  })

  it('취소한 거래는 원래 부호의 금액을 보조색과 취소선으로 긋고, 둘째 줄 아래에 "취소" 칩을 둔다', async () => {
    const { canceled } = putNovember()
    await openList()
    const row = allRows().find((each) => each.getAttribute('href') === `/transactions/${canceled.id}`)!
    const amount = within(row).getByText('25,000원')
    expect(styleOf(amount).color).toBe('var(--color-text-secondary)')
    expect(styleOf(amount).textDecoration).toBe('line-through')
    expect(row.textContent).toBe('13:05김밥천국25,000원식비 · 지갑취소')
    const chip = within(row).getByText('취소')
    expect(styleOf(chip).borderRadius).toBe('var(--radius-full)')
    expect(readCssRule(CSS, '.status')).toContain('margin-top: var(--space-4)')
  })

  it('시각이 없으면 시각 자리를 비운다', async () => {
    const { bus } = putNovember()
    await openList()
    const row = allRows().find((each) => each.getAttribute('href') === `/transactions/${bus.id}`)!
    expect(row.firstElementChild!.textContent).toBe('')
    expect(row.textContent).toBe('교통20,000원교통 · 신한카드')
  })

  it('목록에 없는 계좌나 카테고리 id면 그 이름 자리를 비운다', async () => {
    const missing = 'ffffffff-0000-4000-8000-00000000ffff'
    list.months.set('2026-11', [
      expenseOf({ occurredOn: '2026-11-26', accountId: missing, categoryId: id.food, amount: 1000 }),
      expenseOf({ occurredOn: '2026-11-26', accountId: id.card, categoryId: missing, amount: 2000 }),
      expenseOf({ occurredOn: '2026-11-26', accountId: id.card, categoryId: missing, amount: 3000, payee: '가게' }),
      transferOf({ occurredOn: '2026-11-26', fromAccountId: missing, toAccountId: id.card, amount: 4000 }),
      transferOf({ occurredOn: '2026-11-26', fromAccountId: id.card, toAccountId: missing, amount: 5000 }),
    ])
    await openList()
    expect(texts(rowsOf('11월 26일 (목)'))).toEqual([
      '식비1,000원식비',
      '2,000원신한카드',
      '가게3,000원신한카드',
      '이체4,000원신한카드로',
      '이체5,000원신한카드에서',
    ])
  })

  it('줄 전체가 거래 상세(/transactions/{id})로 가는 링크다', async () => {
    const { lunch } = putNovember()
    await openList()
    const [row] = rowsOf('11월 26일 (목)')
    expect(row.getAttribute('href')).toBe(`/transactions/${lunch.id}`)
    expect(row.parentElement!.tagName).toBe('LI')
  })

  it('링크 이름에 제목 전체, 금액, 날짜, 시각, 둘째 줄, 상태가 들어간다(긴 제목도 다 읽힌다)', async () => {
    putNovember()
    await openList()
    expect(
      screen.getByRole('link', {
        name: '이름이 아주 길어서 한 줄에 다 들어가지 않는 가맹점 이름 19,500원 11월 26일 (목) 08:10 식비 · 급여통장',
      }),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: '김밥천국 25,000원 11월 25일 (수) 13:05 식비 · 지갑 취소' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '이체 450,000원 11월 25일 (수) 급여통장에서 신한카드로' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '급여 +3,200,000원 11월 25일 (수) 18:00 급여 · 급여통장' })).toBeTruthy()
  })

  it('제목과 둘째 줄은 한 줄로 말줄임하고 금액은 제목과 12px 떨어져 오른쪽에 붙는다', async () => {
    putNovember()
    await openList()
    const [, row] = rowsOf('11월 26일 (목)')
    const title = row.querySelector('[class*="title"]')!
    for (const line of [title, row.querySelector('[class*="detail"]')!]) {
      expect([styleOf(line).whiteSpace, styleOf(line).overflow, styleOf(line).textOverflow]).toEqual([
        'nowrap',
        'hidden',
        'ellipsis',
      ])
    }
    expect(styleOf(title).font).toBe('var(--text-body)')
    expect(styleOf(title.parentElement!).columnGap).toBe('var(--space-12)')
    const amount = title.nextElementSibling!
    expect([styleOf(amount).font, styleOf(amount).marginInlineStart]).toEqual(['var(--text-body)', 'auto'])
  })

  it('시각 칸은 40px, 보조 글자색 보조 글자, 고정폭 숫자이고 제목과 12px이다', async () => {
    putNovember()
    await openList()
    const [row] = rowsOf('11월 26일 (목)')
    const time = row.firstElementChild!
    expect(styleOf(row).gridTemplateColumns).toBe('var(--space-40) minmax(0, 1fr)')
    expect(styleOf(row).columnGap).toBe('var(--space-12)')
    expect([styleOf(time).color, styleOf(time).font]).toEqual(['var(--color-text-secondary)', 'var(--text-secondary)'])
    expect(time.classList).toContain('tabular-nums')
  })

  it('둘째 줄은 보조 글자색 보조 글자다', async () => {
    putNovember()
    await openList()
    const detail = rowsOf('11월 26일 (목)')[0].querySelector('[class*="detail"]')!
    expect([styleOf(detail).color, styleOf(detail).font]).toEqual(['var(--color-text-secondary)', 'var(--text-secondary)'])
  })

  it('줄은 56px 이상, 좌우 16px, 위아래 8px이고 선이 없다. 누르거나 올리면 누름 색이다', async () => {
    putNovember()
    await openList()
    const [row] = rowsOf('11월 26일 (목)')
    expect(styleOf(row).minHeight).toBe('var(--size-row)')
    expect(readCssRule(CSS, '.row')).toContain('padding: var(--space-8) var(--row-inset, var(--space-16))')
    expect(readCssRule(CSS, '.row')).not.toContain('border')
    expect(readCssRule(CSS, '.row:active')).toContain('background-color: var(--color-press)')
    expect(readCssRule(CSS, '.row:hover')).toContain('background-color: var(--color-press)')
  })

  it('초점 테두리는 휴대폰 배치에서 줄 안쪽(-2px)에 그린다', async () => {
    expect(readCssRule(CSS, '.row:focus-visible')).toContain('outline-offset: calc(-1 * var(--focus-ring-width))')
  })

  it('날짜의 줄 목록은 그 날짜 머리를 이름으로 갖는다', async () => {
    putNovember()
    await openList()
    expect(rowsOf('11월 25일 (수)')).toHaveLength(4)
  })
})

describe.each([
  ['Asia/Seoul', '+09:00'],
  ['UTC', 'Z'],
  ['America/Los_Angeles', '-08:00'],
  ['Pacific/Kiritimati', '+14:00'],
  ['Pacific/Pago_Pago', '-11:00'],
])('기기의 시간대가 %s일 때 달의 경계', (timeZone, offset) => {
  beforeEach(() => setDeviceClock(`2026-11-26T12:30:00${offset}`, timeZone))

  const on = (occurredOn: string, payee: string) =>
    expenseOf({ occurredOn, occurredTime: '00:00', accountId: id.card, categoryId: id.food, amount: 1000, payee })

  it('12월 31일과 1월 1일, 말일과 1일의 거래가 그 날짜와 맞는 달에 보인다', async () => {
    list.months.set('2026-12', [on('2026-12-31', '말일'), on('2026-12-01', '첫날')])
    list.months.set('2027-01', [on('2027-01-01', '새해')])
    const opened = await openList('/transactions?month=2026-12')
    expect(dayHeadings()).toEqual(['12월 31일 (목)', '12월 1일 (화)'])
    await opened.user.click(monthButton('다음 달')!)
    await screen.findByRole('heading', { level: 2, name: '2027년 1월 1일' })
    expect(dayHeadings()).toEqual(['2027년 1월 1일'])
    expect(pageRequests().map(({ month }) => month)).toEqual(['2026-12', '2027-01'])
  })

  it('윤년 2월의 말일은 2월에 있다', async () => {
    list.months.set('2024-02', [on('2024-02-29', '윤일')])
    await openList('/transactions?month=2024-02')
    expect(dayHeadings()).toEqual(['2024년 2월 29일'])
    expect(monthHeading().textContent).toBe('2024년 2월')
  })
})

/** 같은 날짜가 많은 달. 51번째(다음 쪽의 1건)는 26일이다. */
function manyItems(count: number, date = (index: number) => (index < 48 ? '2026-11-27' : '2026-11-26')) {
  return Array.from({ length: count }, (_, index) =>
    expenseOf({
      occurredOn: date(index),
      accountId: id.card,
      categoryId: id.food,
      amount: 1000 + index,
      payee: `가게 ${index + 1}`,
    }),
  )
}

describe('이어 불러오기(00-common 5.10)', () => {
  it('51건이면 첫 쪽에 50건, 목록 끝이 가까워지면 다음 cursor로 1건을 받는다', async () => {
    list.months.set('2026-11', manyItems(51))
    await openList()
    expect(allRows()).toHaveLength(50)
    expect(intersection.options()).toEqual([{ rootMargin: '0px 0px 100% 0px' }])
    await intersection.show()
    await waitFor(() => expect(allRows()).toHaveLength(51))
    expect(pageRequests().map(({ cursor }) => cursor)).toEqual([null, '2026-11|50'])
    expect(pageRequests()[1]).toMatchObject({ month: '2026-11', limit: '50' })
  })

  it('목록 끝을 지켜보는 자리는 마지막 줄 뒤에 있다', async () => {
    list.months.set('2026-11', manyItems(51))
    await openList()
    const [target] = intersection.targets()
    const lastRow = allRows().at(-1)!
    expect(lastRow.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('받은 건수를 화면 읽기에 알린다', async () => {
    list.months.set('2026-11', manyItems(101))
    await openList()
    expect(announcement().textContent).toBe('')
    await intersection.show()
    await waitFor(() => expect(announcement().textContent).toBe('50건을 더 불러왔어요'))
    await intersection.hide()
    await intersection.show()
    await waitFor(() => expect(announcement().textContent).toBe('1건을 더 불러왔어요'))
    expect(allRows()).toHaveLength(101)
  })

  it('두 쪽에 걸친 날은 한 묶음이고 머리의 합계는 서버가 준 그날 값이다', async () => {
    list.months.set('2026-11', manyItems(51))
    list.days.set('2026-11-26', { income: 0, expense: 123456 })
    await openList()
    expect(dayHeadings()).toEqual(['11월 27일 (금)', '11월 26일 (목)'])
    expect(dayTotalsOf('11월 26일 (목)')).toBe('지출123,456원')
    expect(rowsOf('11월 26일 (목)')).toHaveLength(2)
    await intersection.show()
    await waitFor(() => expect(rowsOf('11월 26일 (목)')).toHaveLength(3))
    expect(dayHeadings()).toEqual(['11월 27일 (금)', '11월 26일 (목)'])
    expect(dayTotalsOf('11월 26일 (목)')).toBe('지출123,456원')
  })

  it('불러오는 동안 목록 끝에 뼈대 줄 3개를 보이고, 같은 쪽을 두 번 요청하지 않는다', async () => {
    list.months.set('2026-11', manyItems(51))
    const slow = delayed()
    list.response = (sent) => (sent.cursor ? slow.respond() : undefined)
    await openList()
    await intersection.show()
    await intersection.hide()
    await intersection.show()
    await passTime(350)
    expect(pageRequests().filter(({ cursor }) => cursor)).toHaveLength(1)
    const shapes = main().querySelectorAll('div[aria-hidden="true"]')
    expect(shapes).toHaveLength(1)
    expect([...shapes[0].children].map((shape) => /_row_/.test(shape.className))).toEqual([true, true, true])
    expect(screen.getByText(loading)).toBeTruthy()
    expect(allRows()).toHaveLength(50)
    slow.answer(HttpResponse.json(pageOf('2026-11', list.months.get('2026-11')!, 50, 50)))
    await waitFor(() => expect(allRows()).toHaveLength(51))
    expect(main().querySelector('div[aria-hidden="true"]')).toBeNull()
  })

  it('더 받을 것이 없으면 덧붙이지 않고 요청하지 않는다', async () => {
    list.months.set('2026-11', manyItems(50))
    await openList()
    await intersection.show()
    await settle()
    expect(pageRequests()).toHaveLength(1)
    expect(screen.queryByText(moreFailed)).toBeNull()
    expect(main().querySelector('div[aria-hidden="true"]')).toBeNull()
  })

  it('다음 쪽을 못 받으면 목록 끝에 "더 불러오지 못했어요"와 "다시 시도"를 보이고 이미 보인 줄은 둔다', async () => {
    list.months.set('2026-11', manyItems(51))
    list.response = (sent) => (sent.cursor ? problem(500, 'INTERNAL_ERROR') : undefined)
    const opened = await openList()
    await intersection.show()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(moreFailed)
    expect(allRows()).toHaveLength(50)
    // 실패한 뒤에는 저절로 다시 보내지 않는다
    await intersection.hide()
    await intersection.show()
    await settle()
    expect(pageRequests().filter(({ cursor }) => cursor)).toHaveLength(1)
    list.response = undefined
    const retry = screen.getByRole('button', { name: '다시 시도' })
    await opened.user.click(retry)
    // 누른 버튼이 사라지므로 초점을 마지막 줄에 두어 다음 Tab이 새 줄로 간다
    expect(document.activeElement).toBe(allRows()[49])
    await waitFor(() => expect(allRows()).toHaveLength(51))
    expect(screen.queryByText(moreFailed)).toBeNull()
  })

  it('목록 끝의 실패도 응답이 약속과 다르면 같다', async () => {
    list.months.set('2026-11', manyItems(51))
    list.response = (sent) => (sent.cursor ? HttpResponse.json({ items: 'x' }) : undefined)
    await openList()
    await intersection.show()
    expect((await screen.findByRole('alert')).textContent).toBe(moreFailed)
  })
})

describe('첫 불러오기', () => {
  it('300ms 전에는 아무것도 없고, 그 뒤 합계 두 줄, 날짜 머리 1개, 거래 줄 5개 모양의 뼈대를 보인다', async () => {
    const slow = delayed()
    list.response = () => slow.respond()
    await openApp('/transactions?month=2026-11')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByText(loading)).toBeNull()
    expect(main().querySelector('div[aria-hidden="true"]')).toBeNull()
    await passTime(350)
    expect(screen.getByText(loading)).toBeTruthy()
    const shape = main().querySelector('div[aria-hidden="true"]')!
    const kinds = [...shape.children].map((child) => /_(totals|dayHead|row)_/.exec(child.className)?.[1])
    expect(kinds).toEqual(['totals', 'dayHead', 'row', 'row', 'row', 'row', 'row'])
    expect(shape.firstElementChild!.children).toHaveLength(2)
    expect(monthButton('이전 달')).not.toBeNull()
    slow.answer(HttpResponse.json(pageOf('2026-11', Object.values(november()), 0, 50)))
    await screen.findAllByText('수입')
    expect(screen.queryByText(loading)).toBeNull()
  })

  it('뼈대 막대는 실제와 같은 줄 안에 같은 글자 자리로 놓는다(내용으로 바뀔 때 밀리지 않는다)', async () => {
    const slow = delayed()
    list.response = () => slow.respond()
    await openApp('/transactions?month=2026-11')
    await screen.findByRole('heading', { level: 1 })
    await passTime(350)
    const shape = main().querySelector('div[aria-hidden="true"]')!
    const row = shape.lastElementChild!
    // 시각 칸, 제목과 금액의 첫 줄, 둘째 줄
    expect(row.children).toHaveLength(2)
    expect(row.children[1].children).toHaveLength(2)
    const [first, second] = row.children[1].children
    expect(first.className).toMatch(/_first_/)
    expect(second.className).toMatch(/_detail_/)
  })

  it('첫 쪽을 못 받으면 합계와 목록 자리에 "불러오지 못했어요."(달 이름 아래의 2단계 제목)와 "다시 시도"를 보인다', async () => {
    putNovember()
    list.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openList()
    expect(screen.getByRole('heading', { level: 2, name: failed })).toBeTruthy()
    expect(screen.getByText('잠시 후 다시 시도해 주세요.')).toBeTruthy()
    expect(monthHeading().textContent).toBe('11월')
    list.response = undefined
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findAllByText('수입')
    expect(dayHeadings()).toEqual(['11월 26일 (목)', '11월 25일 (수)'])
  })

  it('응답이 약속과 달라도 같다', async () => {
    list.response = () => HttpResponse.json({ items: [{ id: 1 }] })
    await openList()
    expect(screen.getByRole('heading', { level: 2, name: failed })).toBeTruthy()
  })

  it('계좌나 카테고리 목록을 못 받아도 같고, "다시 시도"는 못 받은 것만 다시 요청한다', async () => {
    putNovember()
    let failing = true
    server.use(
      // startServer의 카테고리보다 먼저 걸린다
      http.get('/api/v1/ledgers/:ledgerId/categories', () =>
        failing ? problem(500, 'INTERNAL_ERROR') : undefined,
      ),
    )
    const opened = await openList()
    expect(screen.getByRole('heading', { level: 2, name: failed })).toBeTruthy()
    const before = pageRequests().length
    failing = false
    await opened.user.click(screen.getByRole('button', { name: '다시 시도' }))
    await screen.findAllByText('수입')
    expect(pageRequests()).toHaveLength(before)
  })
})

describe('거래가 없는 달(4.2)', () => {
  it('목록 자리에 "11월에 입력한 거래가 없어요"와 주 버튼 "거래 입력"을 보인다', async () => {
    await openList()
    expect(screen.getByText('11월에 입력한 거래가 없어요')).toBeTruthy()
    const link = within(main()).getByRole('link', { name: '거래 입력' })
    expect(link.getAttribute('href')).toBe('/transactions/new')
    expect(link.className).toMatch(/_primary_/)
    expect(dayHeadings()).toEqual([])
  })

  it('다른 해의 달은 연도를 붙인다', async () => {
    await openList('/transactions?month=2025-12')
    expect(screen.getByText('2025년 12월에 입력한 거래가 없어요')).toBeTruthy()
  })

  it('"거래 입력"은 빠른 입력과 같이 누르는 순간 키보드를 올려 두고 지출 입력을 연다', async () => {
    const opened = await openList()
    const focused: Element[] = []
    const record = (event: FocusEvent) => void focused.push(event.target as Element)
    document.addEventListener('focusin', record)
    try {
      fireEvent.click(within(main()).getByRole('link', { name: '거래 입력' }))
      expect((focused[0] as HTMLElement).dataset.keyboardBridge).toBe('')
    } finally {
      document.removeEventListener('focusin', record)
    }
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    expect(opened.router.state.location.pathname).toBe('/transactions/new')
    // 화면 코드를 받는 동안의 틀(#251)에도 같은 제목이 있으므로 칸이 나오기를 기다린다
    expect((await screen.findByRole('radio', { name: '지출' })).getAttribute('aria-checked')).toBe('true')
  })

  it('보기 전용 구성원에게는 문장만 보이고 버튼이 없다', async () => {
    backend.meResponse = () => {
      const me = meOf('user-1')
      return HttpResponse.json({ ...me, ledgers: [{ ...me.ledgers[0], role: 'VIEWER' }] })
    }
    await openList()
    expect(screen.getByText('11월에 입력한 거래가 없어요')).toBeTruthy()
    // 월 이동 오른쪽의 "달력"(D-01 (2))은 보기 전용에게도 있다
    expect(within(main()).queryByRole('link', { name: '거래 입력' })).toBeNull()
  })
})

describe('받아 둔 목록을 다시 받는 때', () => {
  /**
   * `seconds`초가 지난 것으로 한다. 캐시가 오래됐는지는 라이브러리의 시계(Date)로 정한다. 받은 때부터 센 초를 정확히 맞추도록
   * 그 테스트는 목록을 받기 전에 시계를 멈추고(holdClock) 이것으로만 보낸다.
   */
  const advance = (seconds: number) => passTime(seconds * 1000)

  async function openTwoPages() {
    list.months.set('2026-11', manyItems(51))
    const opened = await openList()
    await intersection.show()
    await waitFor(() => expect(allRows()).toHaveLength(51))
    await act(() => opened.router.navigate('/more'))
    return opened
  }

  it('받은 지 30초 안에 돌아오면 다시 받지 않는다', async () => {
    holdClock()
    const opened = await openTwoPages()
    const before = pageRequests().length
    await advance(29)
    await act(() => opened.router.navigate('/transactions?month=2026-11'))
    await settle(100)
    expect(allRows()).toHaveLength(51)
    expect(pageRequests()).toHaveLength(before)
  })

  it('30초가 지나 돌아오면 불러온 쪽을 모두 차례로 다시 받는다', async () => {
    holdClock()
    const opened = await openTwoPages()
    const before = pageRequests().length
    await advance(31)
    await act(() => opened.router.navigate('/transactions?month=2026-11'))
    await waitFor(() => expect(pageRequests()).toHaveLength(before + 2))
    expect(pageRequests().slice(before).map(({ cursor }) => cursor)).toEqual([null, '2026-11|50'])
  })

  // 창에 다시 초점이 오면(탭으로 돌아오면) 브라우저가 visibilitychange를 보낸다
  it('30초가 지난 뒤 창에 초점이 오면 다시 받고, 30초 안이면 받지 않는다', async () => {
    holdClock()
    putNovember()
    await openList()
    const before = pageRequests().length
    await advance(29)
    await act(async () => window.dispatchEvent(new Event('visibilitychange')))
    await settle(100)
    expect(pageRequests()).toHaveLength(before)
    await advance(2)
    await act(async () => window.dispatchEvent(new Event('visibilitychange')))
    await waitFor(() => expect(pageRequests()).toHaveLength(before + 1))
  })

  it('30초 안이어도 거래를 저장하면(장부 무효화) 다시 받는다', async () => {
    putNovember()
    const opened = await openList()
    const before = pageRequests().length
    await opened.user.click(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('link', { name: '거래 입력' }))
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(() => expect(accountField().textContent).not.toBe(''))
    await saveAmount(opened.user)
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
    await waitFor(() => expect(pageRequests().length).toBeGreaterThan(before))
  })
})

describe('상세에서 뒤로 돌아오면', () => {
  it('달과 불러온 줄이 그대로이고 뼈대를 거치지 않는다', async () => {
    list.months.set('2026-10', manyItems(51, () => '2026-10-15'))
    const opened = await openList('/transactions?month=2026-10')
    await intersection.show()
    await waitFor(() => expect(allRows()).toHaveLength(51))
    const target = allRows()[50]
    await opened.user.click(target)
    await waitFor(() => expect(opened.router.state.location.pathname).toMatch(/^\/transactions\/0190/))
    // 상세의 코드가 와서 목록에 있던 값을 먼저 보인 뒤부터 본다. 그 전은 상세의 틀이다(#251)
    await screen.findByText('날짜·시각')
    const dom = recordDom()
    await act(() => opened.router.navigate(-1))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-10'))
    // 뒤로 가기(popstate)는 act 밖에서 온다. 주소는 화면보다 먼저 바뀌므로 목록이 그려진 뒤에 센다(#291)
    await untilShown(opened.router)
    expect(allRows()).toHaveLength(51)
    await passTime(400)
    expect(dom.sawText(loading)).toBe(false)
    expect(dom.sawElement('div[aria-hidden="true"]')).toBe(false)
  })
})

describe('저장한 뒤 돌아오면', () => {
  /** 화면이 보낸 거래를 목록의 맨 앞에 더해 주는 서버 */
  function listWithSaved() {
    const items = Object.values(november())
    list.response = (sent) => {
      const saved = transactions.sent.map(({ body }) => savedOf(body))
      const month = sent.month ?? ''
      const all = [...saved.filter(({ occurredOn }) => String(occurredOn).startsWith(month)), ...(month === '2026-11' ? items : [])]
      return HttpResponse.json(pageOf(month, all as never, 0, 50))
    }
  }

  async function saveFromTab(opened: Opened) {
    await opened.user.click(within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('link', { name: '거래 입력' }))
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await waitFor(() => expect(accountField().textContent).not.toBe(''))
    await saveAmount(opened.user)
  }

  const savedRow = () => allRows().find((row) => row.getAttribute('href') === `/transactions/${transactions.sent[0].body.id}`)

  it('지금 달의 거래면 목록을 다시 받아 그 줄을 1초 동안 면 색으로 강조하고 토스트를 함께 보인다', async () => {
    listWithSaved()
    const opened = await openList()
    const requestsBefore = pageRequests().length
    await saveFromTab(opened)
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
    await screen.findByText('저장했어요')
    await waitFor(() => expect(savedRow()?.className).toMatch(/_highlighted_/))
    expect(pageRequests().length).toBeGreaterThan(requestsBefore)
    expect(allRows().filter((row) => /_highlighted_/.test(row.className))).toHaveLength(1)
    expect(styleOf(savedRow()!).backgroundColor).toBe('var(--color-surface)')
    await passTime(1100)
    expect(savedRow()!.className).not.toMatch(/_highlighted_/)
  })

  it('강조는 움직임 없이 바로 나타나고 바로 사라진다', () => {
    const rule = readCssRule(CSS, '.highlighted')
    expect(rule).toContain('background-color: var(--color-surface)')
    expect(rule).not.toMatch(/transition|animation/)
  })

  it('다른 달의 거래면 보던 달을 그대로 두고 토스트만 보인다', async () => {
    listWithSaved()
    const opened = await openList('/transactions?month=2026-10')
    await saveFromTab(opened)
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-10'))
    await screen.findByText('저장했어요')
    await settle(200)
    expect(allRows().filter((row) => /_highlighted_/.test(row.className))).toEqual([])
  })

  it('다른 화면에서 저장했으면 뒤에 내역을 열어도 강조하지 않는다', async () => {
    listWithSaved()
    const opened = await openApp('/more')
    await screen.findByRole('navigation', { name: '주 메뉴' })
    await saveFromTab(opened)
    await waitFor(() => expect(addressOf(opened)).toBe('/more'))
    // 주소는 화면보다 먼저 바뀐다. 전체 화면 입력에는 없는 하단 탭이 돌아간 더보기에 그려지기를 기다린다(#291)
    const tabs = await screen.findByRole('navigation', { name: '주 메뉴' })
    await opened.user.click(within(tabs).getByRole('link', { name: '내역' }))
    await waitFor(() => expect(savedRow()).toBeTruthy())
    await settle(200)
    expect(savedRow()!.className).not.toMatch(/_highlighted_/)
  })

  it('강조 자리는 휴대폰 배치에서 줄 전체 폭, 768px부터 내용 폭이다', async () => {
    putNovember()
    await openList()
    const history = main().firstElementChild!
    const [row] = rowsOf('11월 26일 (목)')
    setViewportWidth(390)
    expect(styleOf(history).marginInline).toBe('calc(-1 * var(--bleed))')
    expect(row.className).toMatch(/_row_/)
    expect(readCssRule(CSS, '.row')).toContain('padding: var(--space-8) var(--row-inset, var(--space-16))')
    setViewportWidth(1280)
    expect(styleOf(history).getPropertyValue('--bleed')).toBe('0px')
  })
})

describe('하단 탭과 사이드바의 "내역"', () => {
  const tabBar = () => screen.getByRole('navigation', { name: '주 메뉴' })

  it('하단 탭은 홈, 내역, 거래 입력, 통계, 더보기 칸이고 내역은 ListBullets 24px이다', async () => {
    await openList()
    const cells = within(tabBar()).getAllByRole('listitem')
    expect(cells.map((cell) => cell.textContent)).toEqual(['홈', '내역', '', '통계', '더보기'])
    const link = within(cells[1]).getByRole('link', { name: '내역' })
    expect(link.getAttribute('href')).toBe('/transactions')
    const icon = link.querySelector('svg')!
    expect(styleOf(icon).width).toBe('var(--size-icon-24)')
    expect(icon.querySelector('path')!.getAttribute('d')).toMatch(/^M80,64a8,8,0,0,1,8-8H216/)
  })

  it('내역 화면에서 "내역"이 지금 화면으로 표시된다', async () => {
    await openList()
    const link = within(tabBar()).getByRole('link', { name: '내역' })
    expect(link.getAttribute('aria-current')).toBe('page')
  })

  it('넓은 화면의 사이드바 주 메뉴에 "내역"이 아이콘과 함께 있고 지금 화면으로 표시된다', async () => {
    await openList()
    setViewportWidth(1280)
    const sidebar = document.querySelector<HTMLElement>('[class*="sidebar"]')!
    const link = within(sidebar).getByRole('link', { name: '내역' })
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('내역에서 "내역"을 다시 누르면 같은 달에서 맨 위로 스크롤한다', async () => {
    const opened = await openList('/transactions?month=2026-08')
    await opened.user.click(within(tabBar()).getByRole('link', { name: '내역' }))
    expect(addressOf(opened)).toBe('/transactions?month=2026-08')
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)
  })
})
