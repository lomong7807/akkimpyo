import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountOf, type Accounts } from './support/accounts'
import { delayed, meOf, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { readCssRule } from './support/cssRule'
import { untilOpened } from './support/dialog'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { passTime } from './support/testClock'
import { startTransactionDetail, type TransactionDetailServer } from './support/transactionDetail'
import { expenseOf, incomeOf, pageOf, startTransactionList, transferOf, type TransactionList } from './support/transactionList'
import {
  categoryItems,
  id,
  LEDGER,
  openApp,
  resetGlobals,
  saveAmount,
  untilDefaultAccount,
  startServer,
  type Opened,
} from './support/transactionScreen'
import { TRANSACTION_LIST_STALE_MS } from '../src/features/transactions/transactionListQueries'
import { monthOf, today } from '../src/lib/calendarDate'
import { resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

/* C-01 홈(1A 최소판, #90). 목록 API(#15)와 계좌 목록(#13)은 가짜 서버가 계약대로 답한다. */

const CSS = 'src/features/home/Home.module.css'
const LIST_CSS = 'src/features/transactions/TransactionList.module.css'
const failed = '불러오지 못했어요.'
const later = '잠시 후 다시 시도해 주세요.'

const server = startMockServer()
let backend: Backend
let accounts: Accounts
let list: TransactionList
let detail: TransactionDetailServer

const NOW = '2026-11-26T12:30:00+09:00'

beforeEach(() => {
  // 기기의 지금(서울). 받아 둔 목록이 오래됐는지 세는 라이브러리의 시계(Date)와 누름을 막는 300ms는 공용 시계(testClock)다
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, accounts } = startServer(server))
  list = startTransactionList(server, backend)
  detail = startTransactionDetail(server, backend)
  installIntersectionObserver()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

/** 11월의 거래(서버의 순서). 미래 날짜는 장부 전체 목록에서 서버가 뺀다. */
function november() {
  return {
    rent: expenseOf({ occurredOn: '2026-11-28', accountId: id.salary, categoryId: id.food, amount: 700000, payee: '미리 적은 월세' }),
    lunch: expenseOf({
      occurredOn: '2026-11-26',
      occurredTime: '12:30',
      accountId: id.card,
      categoryId: id.dining,
      amount: 9000,
      payee: '올래국수',
    }),
    salary: incomeOf({ occurredOn: '2026-11-25', occurredTime: '18:00', accountId: id.salary, categoryId: id.pay, amount: 3200000 }),
    canceled: expenseOf(
      { occurredOn: '2026-11-25', occurredTime: '13:05', accountId: id.wallet, categoryId: id.food, amount: 25000, payee: '김밥천국' },
      { status: 'CANCELED' },
    ),
    payment: transferOf({ occurredOn: '2026-11-25', fromAccountId: id.salary, toAccountId: id.card, amount: 450000 }),
    bus: expenseOf({ occurredOn: '2026-11-25', accountId: id.card, categoryId: id.traffic, amount: 20000 }),
  }
}

/** 10월의 거래 여섯 건. 11월 다섯 건(미래 제외)과 합치면 열한 건이라 마지막 한 건은 최근 10건에 들지 않는다. */
function october() {
  return Array.from({ length: 6 }, (_, index) =>
    expenseOf({
      occurredOn: `2026-10-${String(30 - index).padStart(2, '0')}`,
      accountId: id.card,
      categoryId: id.grocery,
      amount: 1000 * (index + 1),
      payee: `10월 장보기 ${index + 1}`,
    }),
  )
}

function putTransactions() {
  const items = november()
  list.months.set('2026-11', Object.values(items))
  list.months.set('2026-10', october())
  return items
}

const main = () => screen.getByRole('main')
const region = (name: string | RegExp) => screen.getByRole('region', { name })
const totalsRegion = () => region(/월 합계$/)
const accountsRegion = () => region('계좌 잔액')
const recentRegion = () => region('최근 거래')
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const styleOf = (element: Element) => getComputedStyle(element)
const tabBar = () => document.querySelector<HTMLElement>('[class*="tabBar"]')!
const sidebar = () => document.querySelector<HTMLElement>('[class*="sidebar"]')!

/** 화면 읽기에 보이는 글. aria-hidden인 것(작은 글자로 내린 큰 숫자의 짝)은 뺀다. */
function shownText(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove())
  return copy.textContent ?? ''
}

/** `scope` 안의 이름이 `name`인 dt의 값(dd) */
function valueOf(scope: HTMLElement, name: string): HTMLElement {
  const term = [...scope.querySelectorAll('dt')].find((each) => each.textContent === name)
  if (!term) throw new Error(`${name} 줄이 없다`)
  return term.nextElementSibling as HTMLElement
}

/** 이번 달 합계의 [이름, 값] */
const totals = () =>
  [...totalsRegion().querySelectorAll('dt')].map((term) => [term.textContent, shownText(term.nextElementSibling!)])

/** 계좌 잔액의 [이름, 값] */
const balances = () =>
  [...accountsRegion().querySelectorAll('dt')].map((term) => [term.textContent, shownText(term.nextElementSibling!)])

const recentRows = () => within(recentRegion()).queryAllByRole('link').filter((link) => link.closest('li'))
const dayHeadings = () => within(recentRegion()).queryAllByRole('heading', { level: 3 }).map((each) => each.textContent)

/** 구역마다 내용이나 실패나 빈 상태가 그려졌는지 */
function settled(): boolean {
  const done = (scope: HTMLElement, ...marks: string[]) =>
    marks.some((mark) => within(scope).queryAllByText(mark).length > 0) || within(scope).queryAllByRole('link').length > 0
  return (
    done(totalsRegion(), '지출', failed) &&
    done(accountsRegion(), failed, '계좌가 없어요') &&
    (done(recentRegion(), failed, '거래를 입력하면 여기에 보여요', '아직 거래가 없어요') ||
      within(recentRegion()).queryAllByRole('list').length > 0)
  )
}

/** 홈을 열고 세 구역이 다 그려질 때까지 기다린다. */
async function openHome(path = '/home') {
  const opened = await openApp(path)
  await screen.findByRole('heading', { level: 1, name: '홈' })
  await waitFor(() => expect(settled()).toBe(true))
  return opened
}

/** 보기 전용 구성원으로 로그인한다. */
function asViewer() {
  const me = meOf('user-1')
  backend.meResponse = () => HttpResponse.json({ ...me, ledgers: [{ ...me.ledgers[0], role: 'VIEWER' }] })
}

/** 홈의 이번 달 합계 요청. 기기에 남기는 최근 한 달(#238)의 다른 달 합계는 뺀다(이번 달은 같은 캐시라 한 번이다) */
const totalsRequests = () => list.requests.filter(({ month }) => month !== null && month === monthOf(today()))
/** 홈의 최근 10건 요청. 기기에 남기는 최근 한 달(50건씩)은 뺀다 */
const recentRequests = () => list.requests.filter(({ month, limit }) => month === null && limit === '10')

describe('주소와 공통 틀', () => {
  it('/home은 공통 틀 안의 주 화면이다. 상단 바에 장부 이름만 있고 "뒤로"가 없으며 화면 이름은 "홈"(h1)이다', async () => {
    putTransactions()
    await openHome()
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByText('user-1의 장부')).toBeTruthy()
    expect(bar.queryByRole('button', { name: '뒤로' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('홈')
  })

  it('휴대폰 배치에서 화면 이름은 화면 읽기에만 있다(상단 바에 제목을 두지 않는다, 00-common 6.1)', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(390)
    const title = screen.getByRole('heading', { level: 1, name: '홈' })
    expect(styleOf(title).position).toBe('absolute')
    expect(styleOf(title).clipPath).toBe('inset(50%)')
  })

  it('넓은 화면에서는 내용 맨 위에 화면 이름 "홈"(text-title)을 두고 아래 8px 뒤에 구역이 온다', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(1280)
    const title = screen.getByRole('heading', { level: 1, name: '홈' })
    expect(styleOf(title).position).toBe('static')
    expect(styleOf(title).font).toBe('var(--text-title)')
    expect(styleOf(title).minHeight).toBe('var(--size-topbar)')
    expect(styleOf(title).marginBottom).toBe('var(--space-8)')
  })

  it('/ 로 열면 /home으로 바꿔 간다', async () => {
    putTransactions()
    const opened = await openHome('/')
    expect(addressOf(opened)).toBe('/home')
  })

  it('구역 순서는 한 줄 입력, 이번 달 합계, 계좌 잔액, 최근 거래다(예산, 이벤트, 확인할 거래는 2·3단계라 없다)', async () => {
    putTransactions()
    await openHome()
    const headings = within(main()).getAllByRole('heading', { level: 2 })
    expect(headings.map((each) => each.textContent)).toEqual(['11월 합계', '계좌 잔액', '최근 거래'])
    // 입력칸은 한 줄 입력 하나이고 맨 위 구역이다(C-01 (1), #233)
    const [oneLine] = within(main()).getAllByRole('textbox')
    expect(within(main()).getAllByRole('textbox')).toEqual([within(main()).getByRole('textbox', { name: '한 줄 입력' })])
    expect(oneLine.compareDocumentPosition(headings[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('하단 탭과 사이드바의 "홈"', () => {
  it('하단 탭은 홈, 내역, 거래 입력, 통계, 더보기 칸이고 홈은 맨 앞의 House 24px다', async () => {
    putTransactions()
    await openHome()
    const cells = within(tabBar()).getAllByRole('listitem')
    expect(cells.map((cell) => cell.textContent)).toEqual(['홈', '내역', '', '통계', '더보기'])
    const link = within(cells[0]).getByRole('link', { name: '홈' })
    expect(link.getAttribute('href')).toBe('/home')
    const icon = link.querySelector('svg')!
    expect(styleOf(icon).width).toBe('var(--size-icon-24)')
    expect(icon.querySelector('path')!.getAttribute('d')).toMatch(/^M219\.31,108\.68l-80-80/)
  })

  it('홈에서 하단 탭의 "홈"이 지금 화면으로 표시된다', async () => {
    putTransactions()
    await openHome()
    expect(within(tabBar()).getByRole('link', { name: '홈' }).getAttribute('aria-current')).toBe('page')
    expect(within(tabBar()).getByRole('link', { name: '내역' }).getAttribute('aria-current')).toBeNull()
  })

  it('넓은 화면의 사이드바 주 메뉴는 홈, 내역, 통계 순서이고 홈이 지금 화면이다', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(1280)
    const menu = within(sidebar()).getAllByRole('list')[0]
    const links = within(menu).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['홈', '내역', '통계'])
    expect(links[0].getAttribute('aria-current')).toBe('page')
    expect(links[0].querySelector('svg')).not.toBeNull()
  })

  it('다른 화면에서 "홈"을 누르면 홈으로 간다', async () => {
    putTransactions()
    const opened = await openApp('/transactions?month=2026-11')
    await screen.findByRole('heading', { level: 1, name: '11월' })
    await opened.user.click(within(tabBar()).getByRole('link', { name: '홈' }))
    await screen.findByRole('heading', { level: 1, name: '홈' })
    expect(addressOf(opened)).toBe('/home')
  })

  it('홈의 최근 거래에서 연 상세는 하단 탭의 홈을 강조한다(00-common 6.2)', async () => {
    const { lunch } = putTransactions()
    detail.put(lunch)
    const opened = await openHome()
    await opened.user.click(within(recentRegion()).getByRole('link', { name: /^올래국수/ }))
    await screen.findByRole('heading', { level: 1, name: '거래 상세' })
    expect(within(tabBar()).getByRole('link', { name: '홈' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('이번 달 합계(F-111, P-205)', () => {
  it('이번 달의 첫 쪽 하나(month, limit=1)를 받아 합계(totals)만 쓴다', async () => {
    putTransactions()
    await openHome()
    expect(totalsRequests()).toHaveLength(1)
    expect(totalsRequests()[0]).toMatchObject({ ledgerId: LEDGER, month: '2026-11', limit: '1', cursor: null })
    expect(totalsRequests()[0].names).toEqual(['month', 'limit'])
  })

  it('머리 줄은 "{달}월 합계"와 오른쪽 화살표이고, 구역 전체가 이번 달 월별 통계(E-01)로 가는 링크 하나다(#242)', async () => {
    putTransactions()
    list.totals.set('2026-11', { income: 3200000, expense: 1245300 })
    await openHome()
    const head = within(totalsRegion()).getByRole('heading', { level: 2 })
    expect(head.textContent).toBe('11월 합계')
    expect(within(totalsRegion()).queryByRole('button')).toBeNull()
    const [link] = within(totalsRegion()).getAllByRole('link')
    expect(within(totalsRegion()).getAllByRole('link')).toHaveLength(1)
    expect(link.getAttribute('href')).toBe('/stats/monthly?month=2026-11')
    expect(link.contains(head)).toBe(true)
    expect(head.parentElement!.querySelector('svg')).not.toBeNull()
    expect(link.className).toMatch(/sectionLink/)
    expect(totalsRegion().className).toMatch(/linkSection/)
  })

  it('합계 링크의 이름은 "{달}월 합계, 지출 {금액}, 수입 {금액}, 차액 {금액}"이다(designer #242)', async () => {
    putTransactions()
    list.totals.set('2026-11', { income: 100000, expense: 220000 })
    await openHome()
    expect(within(totalsRegion()).getByRole('link').getAttribute('aria-label')).toBe(
      '11월 합계, 지출 220,000원, 수입 +100,000원, 차액 -120,000원',
    )
  })

  it('수입이 0원이면 링크 이름에도 부호가 없다', async () => {
    putTransactions()
    list.totals.set('2026-11', { income: 0, expense: 0 })
    await openHome()
    expect(within(totalsRegion()).getByRole('link').getAttribute('aria-label')).toBe(
      '11월 합계, 지출 0원, 수입 0원, 차액 0원',
    )
  })

  it('불러오지 못했으면 링크가 아니고 구역 안에 "다시 시도"가 있다', async () => {
    list.response = (sent) => (sent.limit === '1' ? problem(500, 'INTERNAL_ERROR') : undefined)
    await openHome()
    await waitFor(() => expect(within(totalsRegion()).getByText(failed)).toBeTruthy())
    expect(within(totalsRegion()).queryByRole('link')).toBeNull()
    expect(within(totalsRegion()).getByRole('button', { name: '다시 시도' })).toBeTruthy()
  })

  it('지출이 큰 숫자이고 그 아래 수입(강조색, +)과 차액(부호)이 한 줄씩이다', async () => {
    putTransactions()
    list.totals.set('2026-11', { income: 3245000, expense: 1052500 })
    await openHome()
    expect(totals()).toEqual([
      ['지출', '1,052,500원'],
      ['수입', '+3,245,000원'],
      ['차액', '+2,192,500원'],
    ])
    const income = valueOf(totalsRegion(), '수입').querySelector('span')!
    expect(styleOf(income).color).toBe('var(--color-accent)')
    const difference = valueOf(totalsRegion(), '차액').querySelector('span')!
    expect(styleOf(difference).color).toBe('var(--color-text)')
  })

  it('지출이 수입보다 크면 차액에 "-"가 붙고, 수입이 0원이면 부호와 강조색 없이 "0원"이다', async () => {
    putTransactions()
    list.totals.set('2026-11', { income: 0, expense: 120000 })
    await openHome()
    expect(totals()).toEqual([
      ['지출', '120,000원'],
      ['수입', '0원'],
      ['차액', '-120,000원'],
    ])
    expect(styleOf(valueOf(totalsRegion(), '수입').querySelector('span')!).color).toBe('var(--color-text)')
  })

  it('수입과 지출이 같으면 차액은 부호 없이 "0원"이다', async () => {
    putTransactions()
    list.totals.set('2026-11', { income: 50000, expense: 50000 })
    await openHome()
    expect(shownText(valueOf(totalsRegion(), '차액'))).toBe('0원')
  })

  it('거래가 없으면 모두 0원이다', async () => {
    await openHome()
    expect(totals()).toEqual([
      ['지출', '0원'],
      ['수입', '0원'],
      ['차액', '0원'],
    ])
  })

  it('큰 지출 숫자는 text-hero이고, 칸을 넘을 때 쓰는 text-title 짝은 화면 읽기에 숨긴다', async () => {
    putTransactions()
    list.totals.set('2026-11', { income: 0, expense: 1052500 })
    await openHome()
    const spending = valueOf(totalsRegion(), '지출')
    expect(styleOf(spending).font).toBe('var(--text-hero)')
    const copies = spending.querySelectorAll('.tabular-nums')
    expect([...copies].map((copy) => copy.textContent)).toEqual(['1,052,500원', '1,052,500원'])
    const fallback = spending.querySelector('[aria-hidden="true"]')!
    expect(fallback.textContent).toBe('1,052,500원')
    expect(styleOf(fallback.querySelector('.tabular-nums')!.parentElement!).font).toBe('var(--text-title)')
  })

  it('큰 숫자를 재지 않고 CSS로 내린다: 한 줄에 들어가면 큰 숫자, 넘치면 작은 짝이 첫 줄을 차지한다', () => {
    const box = readCssRule(CSS, '.hero')
    expect(box).toContain('display: flex;')
    expect(box).toContain('flex-wrap: wrap;')
    expect(box).toContain('overflow: hidden;')
    expect(readCssRule(CSS, '.heroAmount')).toContain('height: 0;')
    expect(readCssRule(CSS, '.heroAmount')).toContain('white-space: nowrap;')
    expect(readCssRule(CSS, '.heroFallback')).toContain('flex: 1 0 0;')
    expect(readCssRule(CSS, '.heroFallback')).toContain('container-type: inline-size;')
    expect(readCssRule(CSS, '.heroFallbackAmount')).toContain('display: none;')
    // 큰 숫자가 들어간 때의 높이는 받침이 만들고, 작은 숫자로 내리면 받침을 뺀다
    expect(readCssRule(CSS, '.heroStrut')).toContain('height: 1lh;')
    expect(readWebFile(CSS)).toMatch(
      /@container \(width >= 1em\) \{\s*\.heroStrut \{\s*display: none;\s*\}\s*\.heroFallbackAmount \{\s*display: block;/,
    )
  })

  it('지출 이름과 수입·차액 이름은 보조 글자(text-secondary, 보조색), 수입·차액 금액은 text-body-strong이다', async () => {
    putTransactions()
    await openHome()
    for (const name of ['지출', '수입', '차액']) {
      const term = [...totalsRegion().querySelectorAll('dt')].find((each) => each.textContent === name)!
      expect(styleOf(term).font).toBe('var(--text-secondary)')
      expect(styleOf(term).color).toBe('var(--color-text-secondary)')
    }
    expect(styleOf(valueOf(totalsRegion(), '수입')).font).toBe('var(--text-body-strong)')
    expect(styleOf(valueOf(totalsRegion(), '차액')).font).toBe('var(--text-body-strong)')
  })

  it('수입은 큰 숫자 아래 16px, 차액은 수입 아래 8px이다', () => {
    expect(readCssRule(CSS, '.spending + .figure')).toContain('margin-top: var(--space-16);')
    expect(readCssRule(CSS, '.figure + .figure')).toContain('margin-top: var(--space-8);')
  })
})

describe('"이번 달"은 기기의 오늘이 속한 달이다(planner 결정 2026-11-25)', () => {
  // 그 시간대의 2026년 11월 말과 12월 말 오프셋(일광 절약 시간이 아니다)
  const zones = [
    ['Asia/Seoul', '+09:00'],
    ['UTC', 'Z'],
    ['America/Los_Angeles', '-08:00'],
    ['Pacific/Kiritimati', '+14:00'],
    ['Pacific/Pago_Pago', '-11:00'],
  ] as const

  describe.each(zones)('%s', (timeZone, offset) => {
    it.each([
      ['2026-11-30T23:59:59', '2026-11', '11월 합계'],
      ['2026-12-01T00:00:00', '2026-12', '12월 합계'],
      ['2026-12-31T23:59:59', '2026-12', '12월 합계'],
      ['2027-01-01T00:00:00', '2027-01', '1월 합계'],
    ])('기기의 %s이면 %s을 받고 머리 줄은 "%s"다', async (local, month, heading) => {
      setDeviceClock(`${local}${offset}`, timeZone)
      await openHome()
      expect(totalsRequests().map((each) => each.month)).toEqual([month])
      expect(within(totalsRegion()).getByRole('heading', { level: 2 }).textContent).toBe(heading)
    })
  })
})

describe('계좌 잔액(F-112, P-220)', () => {
  it('은행, 카드, 현금 종류별 합계와 구분선 아래 자산 합계(카드 음수 포함)를 보인다', async () => {
    await openHome()
    expect(balances()).toEqual([
      ['은행', '1,800,000원'],
      ['카드', '-120,000원'],
      ['현금', '20,000원'],
      ['자산 합계', '1,700,000원'],
    ])
  })

  it('계좌가 없는 종류는 숨긴다', async () => {
    accounts.items = [accountOf('급여통장', 'BANK', 1500000), accountOf('지갑', 'CASH', 0)]
    await openHome()
    expect(balances()).toEqual([
      ['은행', '1,500,000원'],
      ['현금', '0원'],
      ['자산 합계', '1,500,000원'],
    ])
  })

  it('계좌가 하나면 그 종류 한 줄과 자산 합계다', async () => {
    accounts.items = [accountOf('신한카드', 'CARD', -612400)]
    await openHome()
    expect(balances()).toEqual([
      ['카드', '-612,400원'],
      ['자산 합계', '-612,400원'],
    ])
  })

  it('구역 전체가 /accounts로 가는 링크 하나이고 이름은 "계좌 잔액, 자산 합계 {금액}"이다', async () => {
    const opened = await openHome()
    const link = within(accountsRegion()).getByRole('link')
    expect(within(accountsRegion()).getAllByRole('link')).toHaveLength(1)
    expect(link.getAttribute('aria-label')).toBe('계좌 잔액, 자산 합계 1,700,000원')
    expect(link.getAttribute('href')).toBe('/accounts')
    expect(link.querySelector('h2')!.textContent).toBe('계좌 잔액')
    expect(link.querySelector('svg')).not.toBeNull()
    await opened.user.click(link)
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    expect(addressOf(opened)).toBe('/accounts')
  })

  it('음수 자산 합계도 링크 이름에 부호가 들어간다', async () => {
    accounts.items = [accountOf('신한카드', 'CARD', -612400)]
    await openHome()
    expect(within(accountsRegion()).getByRole('link').getAttribute('aria-label')).toBe('계좌 잔액, 자산 합계 -612,400원')
  })

  it('종류 이름은 text-body 보조색, 금액은 text-body이고 자산 합계는 둘 다 text-body-strong이다', async () => {
    await openHome()
    const bank = [...accountsRegion().querySelectorAll('dt')].find((each) => each.textContent === '은행')!
    expect(styleOf(bank).font).toBe('var(--text-body)')
    expect(styleOf(bank).color).toBe('var(--color-text-secondary)')
    expect(styleOf(bank.nextElementSibling!).font).toBe('var(--text-body)')
    const total = [...accountsRegion().querySelectorAll('dt')].find((each) => each.textContent === '자산 합계')!
    expect(styleOf(total).font).toBe('var(--text-body-strong)')
    expect(styleOf(total).color).toBe('var(--color-text)')
    expect(styleOf(total.nextElementSibling!).font).toBe('var(--text-body-strong)')
    expect(total.parentElement!.className).toMatch(/assets/)
    const line = readCssRule(CSS, '.balance.assets')
    expect(line).toContain('border-top: 1px solid var(--color-border);')
    expect(line).toContain('margin-top: var(--space-12);')
    expect(line).toContain('padding-top: var(--space-12);')
    expect(readCssRule(CSS, '.balance + .balance')).toContain('margin-top: var(--space-8);')
  })

  it('누름·올림은 color-press 바탕이고 초점 테두리는 안쪽(-2px)에 그린다', () => {
    expect(readCssRule(CSS, '.sectionLink:active')).toContain('background-color: var(--color-press);')
    expect(readCssRule(CSS, '.sectionLink:hover')).toContain('background-color: var(--color-press);')
    expect(readCssRule(CSS, '.sectionLink:focus-visible')).toContain('outline-offset: calc(-1 * var(--focus-ring-width));')
  })

  it('보기 전용이고 계좌가 없으면 머리 줄 아래 "계좌가 없어요"만 보인다. 화살표와 링크가 없다(C-01 데이터 없음)', async () => {
    asViewer()
    accounts.items = []
    await openHome()
    expect(within(accountsRegion()).getByRole('heading', { level: 2 }).textContent).toBe('계좌 잔액')
    const none = within(accountsRegion()).getByText('계좌가 없어요')
    expect(styleOf(none).font).toBe('var(--text-body)')
    expect(styleOf(none).color).toBe('var(--color-text-secondary)')
    expect(none.parentElement!.className).toMatch(/body/)
    expect(within(accountsRegion()).queryByRole('link')).toBeNull()
    expect(accountsRegion().querySelector('svg')).toBeNull()
    expect(accountsRegion().querySelector('dl')).toBeNull()
  })

  it('편집 이상이 앱 안에서 홈으로 왔고 계좌가 없어도(안내는 들어올 때만 정한다) 같은 모양이다', async () => {
    accounts.items = []
    const opened = await openApp('/more')
    await waitFor(() => expect(tabBar()).not.toBeNull())
    await opened.user.click(within(tabBar()).getByRole('link', { name: '홈' }))
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await waitFor(() => expect(settled()).toBe(true))
    expect(addressOf(opened)).toBe('/home')
    expect(within(accountsRegion()).getByText('계좌가 없어요')).toBeTruthy()
    expect(within(accountsRegion()).queryByRole('link')).toBeNull()
  })

  // perf 권고(#90): 잔액 계산이 홈에서 가장 비싼 요청이라(perf PR #176) 거래 목록과 같은 30초 동안 새것으로 본다
  it('들어올 때 첫 실행 안내를 정하려고 받은 계좌 목록을 홈이 다시 받지 않는다', async () => {
    await openHome()
    expect(accounts.requests).toEqual([LEDGER])
  })

  it('30초 안에 계좌 목록 화면에 다녀오면 계좌 목록을 다시 받지 않는다', async () => {
    const opened = await openHome()
    await opened.user.click(within(accountsRegion()).getByRole('link'))
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    await act(() => opened.router.navigate(-1))
    await screen.findByRole('heading', { level: 1, name: '홈' })
    expect(accounts.requests).toEqual([LEDGER])
  })

  it('30초가 지나면 홈에 다시 들어올 때 계좌 목록을 다시 받는다', async () => {
    const opened = await openHome()
    await act(() => opened.router.navigate('/more'))
    // 라이브러리가 받은 때와 지금을 재는 시계(Date.now)도 공용 시계라 함께 간다
    await passTime(TRANSACTION_LIST_STALE_MS + 1)
    await act(() => opened.router.navigate('/home'))
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await waitFor(() => expect(accounts.requests).toHaveLength(2))
  })

  it('거래를 저장하면 30초 안이어도 계좌 목록을 다시 받아 홈과 계좌 목록 화면의 잔액이 바로 바뀐다', async () => {
    const opened = await openHome()
    expect(balances()[0]).toEqual(['은행', '1,800,000원'])
    await opened.user.click(within(tabBar()).getByRole('link', { name: '거래 입력' }))
    await untilDefaultAccount()
    accounts.items = accounts.items.map((each) => ((each as { id: string }).id === id.salary ? { ...each, balance: 1488000 } : each))
    await saveAmount(opened.user)
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await waitFor(() => expect(balances()[0]).toEqual(['은행', '1,788,000원']))
    expect(accounts.requests).toEqual([LEDGER, LEDGER])
    await opened.user.click(within(accountsRegion()).getByRole('link'))
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    // 계좌 화면의 코드가 오면(#251) 다시 받지 않고 바뀐 잔액을 그린다
    expect(await waitFor(() => within(main()).getByText('1,488,000원'))).toBeTruthy()
    expect(accounts.requests).toEqual([LEDGER, LEDGER])
  })

  it('계좌 목록 화면(G-01)과 같은 캐시를 쓴다. 홈에서 계좌로 가면 받아 둔 목록을 바로 그린다', async () => {
    const opened = await openHome()
    const answer = delayed()
    accounts.response = answer.respond
    await opened.user.click(within(accountsRegion()).getByRole('link'))
    await screen.findByRole('heading', { level: 1, name: '계좌' })
    // 계좌 화면의 코드가 오면(#251) 답을 기다리지 않고 받아 둔 목록을 그린다
    expect(await waitFor(() => within(main()).getByText('자산 합계'))).toBeTruthy()
    answer.answer(HttpResponse.json({ items: accounts.items }))
  })
})

describe('최근 거래(F-113)', () => {
  it('달 없이 장부 전체에서 10건(limit=10)을 한 번 받는다. 다음 쪽(cursor)은 받지 않는다', async () => {
    putTransactions()
    await openHome()
    expect(recentRequests()).toHaveLength(1)
    expect(recentRequests()[0]).toMatchObject({ ledgerId: LEDGER, month: null, limit: '10', cursor: null })
    expect(recentRequests()[0].names).toEqual(['limit'])
    expect(recentRows()).toHaveLength(10)
  })

  it('서버의 순서대로 날짜 묶음 머리(h3) 아래에 거래 줄을 놓는다. 서버가 뺀 미래 날짜 거래는 없다', async () => {
    putTransactions()
    await openHome()
    expect(dayHeadings()).toEqual([
      '11월 26일 (목)',
      '11월 25일 (수)',
      '10월 30일 (금)',
      '10월 29일 (목)',
      '10월 28일 (수)',
      '10월 27일 (화)',
      '10월 26일 (월)',
    ])
    expect(within(recentRegion()).queryByText('미리 적은 월세')).toBeNull()
    expect(within(recentRegion()).queryByText('10월 장보기 6')).toBeNull()
  })

  it('화면은 받은 거래를 거르지 않는다. 서버가 미래 날짜를 주면 그대로 보인다', async () => {
    const { rent, lunch } = november()
    list.response = (sent) => (sent.month === null ? HttpResponse.json(pageOf(null, [rent, lunch], 0, 10)) : undefined)
    await openHome()
    expect(dayHeadings()).toEqual(['11월 28일 (토)', '11월 26일 (목)'])
  })

  it('줄은 내역과 같은 구성이다: 시각, 제목, 금액(금액 색), 둘째 줄, 취소 표시. 누르면 상세로 간다', async () => {
    const { lunch } = putTransactions()
    detail.put(lunch)
    const opened = await openHome()
    const row = within(recentRegion()).getByRole('link', { name: /^올래국수/ })
    expect(row.getAttribute('href')).toBe(`/transactions/${lunch.id}`)
    expect(row.textContent).toBe('12:30올래국수9,000원외식 · 신한카드')
    const day25 = within(recentRegion()).getByRole('list', { name: '11월 25일 (수)' })
    // 시각 없는 두 건은 id 역순(나중에 만든 버스가 먼저)이다
    expect(within(day25).getAllByRole('link').map((link) => link.textContent)).toEqual([
      '18:00급여+3,200,000원급여 · 급여통장',
      '13:05김밥천국25,000원식비 · 지갑취소',
      '교통20,000원교통 · 신한카드',
      '이체450,000원급여통장에서 신한카드로',
    ])
    await opened.user.click(row)
    await screen.findByRole('heading', { level: 1, name: '거래 상세' })
    expect(addressOf(opened)).toBe(`/transactions/${lunch.id}`)
  })

  it('줄의 금액은 text-body이고 내역의 줄과 같은 CSS를 쓴다', async () => {
    putTransactions()
    await openHome()
    const row = within(recentRegion()).getByRole('link', { name: /^올래국수/ })
    const amount = within(row).getByText('9,000원').parentElement!
    expect(styleOf(amount).font).toBe('var(--text-body)')
    expect(row.className).toMatch(/row/)
  })

  it('날짜 묶음 머리의 합계는 받은 줄이 아니라 그날 전체(days)다', async () => {
    putTransactions()
    list.days.set('2026-11-26', { income: 0, expense: 40500 })
    await openHome()
    const head = within(recentRegion()).getByRole('heading', { level: 3, name: '11월 26일 (목)' })
    expect(head.nextElementSibling!.textContent).toBe('지출40,500원')
  })

  it('상세를 받는 동안 홈에서 받은 줄의 값을 먼저 보인다(D-06 상태)', async () => {
    const { lunch } = putTransactions()
    detail.getResponse = delayed().respond
    const opened = await openHome()
    await opened.user.click(within(recentRegion()).getByRole('link', { name: /^올래국수/ }))
    await screen.findByRole('heading', { level: 1, name: '거래 상세' })
    await waitFor(() => expect(main().querySelector('[class*="summary"]')!.textContent).toBe('지출9,000원올래국수'))
    expect(lunch.payee).toBe('올래국수')
  })

  it('머리 줄 오른쪽의 "모두 보기"는 내역(/transactions)으로 가는 글자 버튼이고 오른쪽에 CaretRight가 있다', async () => {
    putTransactions()
    const opened = await openHome()
    const all = within(recentRegion()).getByRole('link', { name: '모두 보기' })
    expect(all.getAttribute('href')).toBe('/transactions')
    expect(all.querySelector('svg')).not.toBeNull()
    await opened.user.click(all)
    await screen.findByRole('heading', { level: 1, name: '11월' })
    expect(addressOf(opened)).toBe('/transactions?month=2026-11')
  })

  it('"모두 보기"의 글자는 내용 오른쪽 선에 맞추고, 44px 누름 영역이 머리 줄 높이를 늘리지 않는다', () => {
    const action = readCssRule(CSS, '.headAction')
    expect(action).toContain('margin-inline-end: calc(-1 * var(--space-8));')
    expect(action).toContain('margin-block: calc((1lh - var(--size-touch)) / 2);')
  })

  // designer 검토(#90): 계좌 줄의 금액과 같은 규칙
  it('구역 제목은 줄을 바꾸지 않고, 제목과 "모두 보기"가 한 줄에 안 들어가면 "모두 보기"가 다음 줄 오른쪽으로 간다', () => {
    const head = readCssRule(CSS, '.head')
    expect(head).toContain('flex-wrap: wrap;')
    expect(head).toContain('row-gap: var(--space-8);')
    const heading = readCssRule(CSS, '.heading')
    expect(heading).toContain('flex: 1 0 auto;')
    expect(heading).toContain('white-space: nowrap;')
    expect(readCssRule(CSS, '.headAction')).toContain('margin-inline-start: auto;')
    expect(readCssRule(CSS, '.caret')).toContain('margin-inline-start: auto;')
  })

  it('장부에 거래가 없으면 "거래를 입력하면 여기에 보여요"와 주 버튼 "거래 입력"(빠른 입력과 같은 열기)이다', async () => {
    const opened = await openHome()
    expect(within(recentRegion()).getByText('거래를 입력하면 여기에 보여요')).toBeTruthy()
    const button = within(recentRegion()).getByRole('link', { name: '거래 입력' })
    expect(button.getAttribute('href')).toBe('/transactions/new')
    expect(button.className).toMatch(/primary/)
    await opened.user.click(button)
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
  })

  it('보기 전용에게는 "아직 거래가 없어요"만 보인다', async () => {
    asViewer()
    await openHome()
    expect(within(recentRegion()).getByText('아직 거래가 없어요')).toBeTruthy()
    expect(within(recentRegion()).queryByRole('link', { name: '거래 입력' })).toBeNull()
    expect(within(recentRegion()).queryByText('거래를 입력하면 여기에 보여요')).toBeNull()
  })

  it('보기 전용도 거래가 있으면 최근 거래와 합계, 계좌 잔액을 본다', async () => {
    asViewer()
    putTransactions()
    await openHome()
    expect(recentRows()).toHaveLength(10)
    expect(within(accountsRegion()).getByRole('link')).toBeTruthy()
  })
})

describe('배치(화면설계서 C-01, designer 결정 13·15)', () => {
  it('구역은 상자 없이 1px color-border 선과 위아래 24px로 나눈다. 휴대폰 배치는 세 구역이 한 줄로 이어진다', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(390)
    const [totalsSection, accountsSection, recentSection] = [totalsRegion(), accountsRegion(), recentRegion()]
    // 이번 달 합계와 계좌 잔액은 구역의 여백을 링크가 갖는다(누름 바탕이 선과 선 사이를 채운다, #242)
    for (const linked of [totalsSection, accountsSection]) {
      expect(linked.className).toMatch(/linkSection/)
      expect(within(linked).getByRole('link').className).toMatch(/sectionLink/)
    }
    expect(readCssRule(CSS, '.sectionLink')).toContain('padding: var(--space-24) var(--inset);')
    expect(readCssRule(CSS, '.section')).toContain('padding-top: var(--space-24);')
    expect(readCssRule(CSS, '.section')).toContain('padding-bottom: var(--space-24);')
    // jsdom은 아래 여백 0을 건 요소의 위 여백을 계산하지 못해 같은 규칙(.section)을 쓰는지만 본다
    expect(recentSection.className).toMatch(/section/)
    expect(recentSection.className).not.toMatch(/linkSection/)
    // 선은 둘째 구역(같은 칸)과 셋째 구역(다음 칸의 첫 구역) 위에 있다
    expect(accountsSection.previousElementSibling).toBe(totalsSection)
    expect(recentSection.parentElement!.previousElementSibling).toBe(accountsSection.parentElement)
    expect(readCssRule(CSS, '.column + .column > .section:first-child')).toContain(
      'border-top: 1px solid var(--color-border);',
    )
    expect(readWebFile(CSS)).toContain('.section + .section,\n.column + .column > .section:first-child {')
    for (const selector of ['.section', '.sectionLink']) {
      expect(readCssRule(CSS, selector)).not.toMatch(/background|border-radius|box-shadow/)
    }
  })

  it('휴대폰 배치에서 선은 화면 끝까지 닿고 글은 16px 안쪽에서 시작한다', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(390)
    const home = main().querySelector('[class*="home"]')!
    expect(styleOf(home).getPropertyValue('--bleed')).toBe('var(--space-16)')
    expect(styleOf(home).getPropertyValue('--inset')).toBe('var(--space-16)')
    expect(readCssRule(CSS, '.home')).toContain('margin-inline: calc(-1 * var(--bleed));')
  })

  it('화면 맨 아래 여백은 24px이다(마지막 구역은 아래 여백 없이 공통 틀의 24px만 둔다)', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(390)
    expect(styleOf(recentRegion()).paddingBottom).toMatch(/^0(px)?$/)
    expect(styleOf(main()).paddingBottom).toBe('var(--space-24)')
  })

  it('넓은 화면은 한 줄 입력(전체 폭) 아래 두 칸이다: 칸 사이 24px을 뺀 폭을 2:3으로 나누고 함께 스크롤한다', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(1280)
    const home = main().querySelector('[class*="home"]')!
    expect(styleOf(home).display).toBe('grid')
    expect(styleOf(home).gridTemplateColumns).toBe('minmax(0, 2fr) minmax(0, 3fr)')
    expect(styleOf(home).columnGap).toBe('var(--space-24)')
    const [oneLine, left, right] = [...home.children]
    expect(within(oneLine as HTMLElement).getByRole('textbox', { name: '한 줄 입력' })).toBeTruthy()
    expect(styleOf(oneLine).gridColumn).toBe('1 / -1')
    expect(within(left as HTMLElement).getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      '11월 합계',
      '계좌 잔액',
    ])
    expect(within(right as HTMLElement).getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      '최근 거래',
    ])
    expect(styleOf(left).overflowY).not.toBe('auto')
    expect(styleOf(right).overflowY).not.toBe('auto')
  })

  it('넓은 화면에서 오른쪽 칸의 첫 구역 위에는 선이 없고, 선과 거래 줄은 칸의 폭이다(좌우 여백 0)', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(1280)
    expect(styleOf(recentRegion()).borderTopWidth).toBe('0px')
    expect(readWebFile(CSS)).toMatch(
      /@media \(width >= 1024px\) \{\s*\.column \+ \.column > \.section:first-child \{\s*border-top: 0;/,
    )
    const home = main().querySelector('[class*="home"]')!
    expect(styleOf(home).getPropertyValue('--bleed')).toBe('0px')
    expect(styleOf(home).getPropertyValue('--inset')).toBe('0px')
    expect(styleOf(home).getPropertyValue('--row-inset')).toBe('0px')
    expect(readCssRule(LIST_CSS, '.row')).toContain('var(--row-inset, var(--space-16))')
    expect(readCssRule(LIST_CSS, '.dayHead')).toContain('var(--row-inset, var(--space-16))')
  })

  it('넓은 화면에서 홈은 가운데 720px로 모으지 않고 내용 영역 전체 폭을 쓴다(00-common 2.5)', async () => {
    putTransactions()
    await openHome()
    setViewportWidth(1280)
    expect(styleOf(main()).getPropertyValue('--content-width')).toBe('100%')
  })
})

/**
 * 받아 둔 것이 없는 상태로 홈에 들어간다. /home으로 열면 첫 실행 안내를 띄울지 정하느라 계좌 목록을 먼저 받으므로,
 * 더보기로 연 뒤 응답을 미루고 홈으로 간다.
 */
async function enterHomeWaiting() {
  const opened = await openApp('/more')
  await waitFor(() => expect(tabBar()).not.toBeNull())
  list.response = delayed().respond
  accounts.response = delayed().respond
  await act(() => opened.router.navigate('/home'))
  await screen.findByRole('heading', { level: 1, name: '홈' })
  return opened
}

/** 구역 안의 뼈대 자리(아이콘의 aria-hidden은 뺀다) */
const bones = (section: HTMLElement) => section.querySelector('div[aria-hidden="true"]')!

describe('불러오는 중', () => {
  it('구역마다 머리 줄은 바로 그리고 내용 자리에 뼈대를 둔다. 화면 읽기에는 "불러오고 있어요." 하나만 알린다', async () => {
    putTransactions()
    await enterHomeWaiting()
    await screen.findByText('불러오고 있어요.')
    expect(screen.getAllByText('불러오고 있어요.')).toHaveLength(1)
    expect(within(main()).getAllByRole('heading', { level: 2 }).map((each) => each.textContent)).toEqual([
      '11월 합계',
      '계좌 잔액',
      '최근 거래',
    ])
    // 합계: 이름, 큰 숫자, 두 줄 / 계좌: 세 줄과 합계 / 거래: 날짜 머리 하나와 줄 셋
    expect(bones(totalsRegion()).querySelectorAll('[class*="bar"]')).toHaveLength(6)
    expect(bones(accountsRegion()).querySelectorAll('[class*="bar"]')).toHaveLength(8)
    expect(bones(recentRegion()).querySelectorAll('[class*="dayHead"]')).toHaveLength(1)
    expect(bones(recentRegion()).querySelectorAll('[class*="row"]')).toHaveLength(3)
  })

  it('뼈대는 실제 줄과 같은 CSS로 놓는다(밀리지 않게)', async () => {
    await enterHomeWaiting()
    await screen.findByText('불러오고 있어요.')
    const totalsBones = bones(totalsRegion())
    expect(totalsBones.querySelector('[class*="hero"]')).not.toBeNull()
    expect(totalsBones.querySelectorAll('[class*="figure"]')).toHaveLength(2)
    expect(bones(accountsRegion()).querySelectorAll('[class*="balance"]')).toHaveLength(4)
  })

  it('300ms 전에는 뼈대를 보이지 않지만 자리는 차지한다', async () => {
    await enterHomeWaiting()
    expect(screen.queryByText('불러오고 있어요.')).toBeNull()
    expect(bones(totalsRegion()).className).toMatch(/reserved/)
  })
})

describe('구역 하나가 실패해도 다른 구역은 보인다', () => {
  it('이번 달 합계를 받지 못하면 그 구역에만 "불러오지 못했어요."와 "다시 시도"가 있고 머리 줄은 남는다', async () => {
    putTransactions()
    list.response = (sent) => (sent.month !== null ? problem(500, 'INTERNAL_ERROR') : undefined)
    const opened = await openHome()
    expect(within(totalsRegion()).getByText(failed)).toBeTruthy()
    expect(within(totalsRegion()).getByText(later)).toBeTruthy()
    expect(within(totalsRegion()).getByRole('heading', { level: 2 }).textContent).toBe('11월 합계')
    expect(within(accountsRegion()).getByRole('link')).toBeTruthy()
    expect(recentRows()).toHaveLength(10)
    list.response = undefined
    // 기기에 남기는 최근 한 달(#238)도 이번 달 합계를 같은 캐시로 받으므로 실패한 뒤 한 번 더 받았을 수 있다
    const before = totalsRequests().length
    await opened.user.click(within(totalsRegion()).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(within(totalsRegion()).queryByText(failed)).toBeNull())
    expect(totals()[0][0]).toBe('지출')
    expect(totalsRequests()).toHaveLength(before + 1)
  })

  it('최근 거래를 받지 못하면 그 구역에만 실패가 보인다', async () => {
    putTransactions()
    list.response = (sent) => (sent.month === null ? problem(500, 'INTERNAL_ERROR') : undefined)
    const opened = await openHome()
    // 기기의 최근 한 달(#238)을 읽은 뒤에 실패가 된다
    expect(await within(recentRegion()).findByText(failed)).toBeTruthy()
    expect(within(recentRegion()).getByRole('link', { name: '모두 보기' })).toBeTruthy()
    expect(totals()[0][0]).toBe('지출')
    expect(within(accountsRegion()).getByRole('link')).toBeTruthy()
    list.response = undefined
    await opened.user.click(within(recentRegion()).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(recentRows()).toHaveLength(10))
  })

  it('카테고리를 받지 못하면(줄 이름을 그릴 수 없어) 최근 거래만 실패이고, 다시 시도는 카테고리만 다시 받는다', async () => {
    putTransactions()
    const categories = startCategoriesFailing()
    const opened = await openHome()
    expect(await within(recentRegion()).findByText(failed)).toBeTruthy()
    expect(within(accountsRegion()).getByRole('link')).toBeTruthy()
    categories.fail = false
    const before = recentRequests().length
    await opened.user.click(within(recentRegion()).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(recentRows()).toHaveLength(10))
    expect(recentRequests()).toHaveLength(before)
  })

  it('계좌 목록을 받지 못하면 계좌 잔액과 (계좌 이름이 필요한) 최근 거래가 실패이고 합계는 보인다', async () => {
    putTransactions()
    accounts.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openHome()
    expect(within(accountsRegion()).getByText(failed)).toBeTruthy()
    expect(within(accountsRegion()).getByRole('heading', { level: 2 }).textContent).toBe('계좌 잔액')
    expect(within(accountsRegion()).queryByRole('link')).toBeNull()
    expect(within(recentRegion()).getByText(failed)).toBeTruthy()
    expect(totals()[0][0]).toBe('지출')
    accounts.response = undefined
    await opened.user.click(within(accountsRegion()).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(within(accountsRegion()).queryByRole('link')).not.toBeNull())
    await waitFor(() => expect(recentRows()).toHaveLength(10))
  })

  it('실패 문구는 구역 안에 왼쪽 정렬로 작게 둔다(가운데 큰 실패 모양이 아니다)', async () => {
    list.response = (sent) => (sent.month !== null ? problem(500, 'INTERNAL_ERROR') : undefined)
    await openHome()
    const title = within(totalsRegion()).getByText(failed)
    expect(title.tagName).toBe('P')
    expect(styleOf(title).font).toBe('var(--text-body)')
    expect(styleOf(within(totalsRegion()).getByText(later)).font).toBe('var(--text-secondary)')
    expect(styleOf(title.parentElement!).textAlign).not.toBe('center')
  })

  it('다시 받는 동안에는 문구를 둔 채 "다시 시도"에 도는 표시를 둔다', async () => {
    list.response = (sent) => (sent.month !== null ? problem(500, 'INTERNAL_ERROR') : undefined)
    const opened = await openHome()
    const answer = delayed()
    list.response = (sent) => (sent.month !== null ? answer.respond() : undefined)
    await opened.user.click(within(totalsRegion()).getByRole('button', { name: '다시 시도' }))
    await answer.arrived
    expect(within(totalsRegion()).getByText(failed)).toBeTruthy()
    expect(within(totalsRegion()).getByRole('button', { name: '다시 시도' }).getAttribute('aria-busy')).toBe('true')
    answer.answer(HttpResponse.json(pageOf('2026-11', [], 0, 1)))
    await waitFor(() => expect(within(totalsRegion()).queryByText(failed)).toBeNull())
  })
})

describe('거래를 저장하거나 지우고 돌아오면 바뀐 값으로 보인다', () => {
  it('빠른 입력으로 저장하고 돌아오면 합계, 잔액, 최근 거래를 다시 받아 바뀐 값을 보이고 토스트 "저장했어요"가 뜬다', async () => {
    putTransactions()
    const opened = await openHome()
    // 달 합계에는 그 달의 미래 날짜(28일 월세 700,000원)도 든다(#15). 취소와 이체는 빠진다
    expect(totals()[0]).toEqual(['지출', '729,000원'])
    const [totalsBefore, recentBefore, accountsBefore] = [
      totalsRequests().length,
      recentRequests().length,
      accounts.requests.length,
    ]
    await opened.user.click(within(tabBar()).getByRole('link', { name: '거래 입력' }))
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    // 서버에 새 거래가 생기고 잔액이 바뀐다
    const added = expenseOf({ occurredOn: '2026-11-26', occurredTime: '13:00', accountId: id.salary, categoryId: id.food, amount: 12000, payee: '새 점심' })
    list.months.set('2026-11', [added, ...list.months.get('2026-11')!])
    accounts.items = accounts.items.map((each) => ((each as { id: string }).id === id.salary ? { ...each, balance: 1488000 } : each))
    await saveAmount(opened.user)
    await screen.findByRole('heading', { level: 1, name: '홈' })
    expect(addressOf(opened)).toBe('/home')
    await waitFor(() => expect(totals()[0]).toEqual(['지출', '741,000원']))
    await waitFor(() => expect(balances()[0]).toEqual(['은행', '1,788,000원']))
    await waitFor(() => expect(within(recentRegion()).queryByRole('link', { name: /^새 점심/ })).not.toBeNull())
    expect(totalsRequests().length).toBeGreaterThan(totalsBefore)
    expect(recentRequests().length).toBeGreaterThan(recentBefore)
    expect(accounts.requests.length).toBeGreaterThan(accountsBefore)
    await waitFor(() => expect(document.querySelector('[class*="region"]')!.textContent).toBe('저장했어요'))
  })

  it('저장하고 돌아온 홈의 줄은 강조하지 않는다(C-01에 없다)', async () => {
    putTransactions()
    const opened = await openHome()
    await opened.user.click(within(tabBar()).getByRole('link', { name: '거래 입력' }))
    await screen.findByRole('heading', { level: 1, name: '거래 입력' })
    await saveAmount(opened.user)
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await waitFor(() => expect(recentRows().length).toBeGreaterThan(0))
    expect(recentRegion().querySelector('[class*="highlighted"]')).toBeNull()
  })

  it('최근 거래에서 연 상세에서 지우고 돌아오면 그 줄이 없고 합계가 바뀐다', async () => {
    const { lunch } = putTransactions()
    detail.put(lunch)
    const opened = await openHome()
    expect(totals()[0]).toEqual(['지출', '729,000원'])
    await opened.user.click(within(recentRegion()).getByRole('link', { name: /^올래국수/ }))
    await waitFor(() => expect(within(main()).queryByText('작성자')).toBeTruthy())
    await opened.user.click(within(main()).getByRole('button', { name: '삭제' }))
    await untilOpened()
    const dialog = screen.getByRole('dialog', { name: '이 거래를 삭제할까요?' })
    await opened.user.click(within(dialog).getAllByRole('button', { name: '삭제' }).at(-1)!)
    await screen.findByRole('heading', { level: 1, name: '홈' })
    expect(addressOf(opened)).toBe('/home')
    await waitFor(() => expect(within(recentRegion()).queryByRole('link', { name: /^올래국수/ })).toBeNull())
    await waitFor(() => expect(totals()[0]).toEqual(['지출', '720,000원']))
  })
})

describe('받아 둔 값을 다시 받는 때', () => {
  it('30초 안에 내역에 다녀오면 합계와 최근 거래를 다시 받지 않는다', async () => {
    putTransactions()
    const opened = await openHome()
    const before = list.requests.length
    await act(() => opened.router.navigate('/transactions?month=2026-11'))
    await screen.findByRole('heading', { level: 1, name: '11월' })
    await act(() => opened.router.navigate('/home'))
    await screen.findByRole('heading', { level: 1, name: '홈' })
    await waitFor(() => expect(settled()).toBe(true))
    // 내역이 받은 11월 목록 하나만 늘었다
    expect(list.requests.length).toBe(before + 1)
  })
})

/** 카테고리 목록이 실패하다가 fail을 끄면 성공하는 가짜 서버 */
function startCategoriesFailing() {
  const state = { fail: true }
  server.use(
    http.get('/api/v1/ledgers/:ledgerId/categories', () =>
      state.fail ? problem(500, 'INTERNAL_ERROR') : HttpResponse.json({ items: categoryItems }),
    ),
  )
  return state
}
