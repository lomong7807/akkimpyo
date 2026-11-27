import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, meOf, type Backend } from './support/backend'
import type { Categories } from './support/categories'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { readCssRule } from './support/cssRule'
import { startMockServer } from './support/mockServer'
import { startMonthlyStats, statsOf, type MonthlyStatsServer } from './support/monthlyStats'
import { problem } from './support/problem'
import { holdClock, passTime } from './support/testClock'
import { id, LEDGER, openApp, resetGlobals, settle, startServer, type Opened } from './support/transactionScreen'
import { resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

/*
 * E-01 월별 통계(#242, F-301, E 공통). 계산은 서버가 한다(P-205, #16 응답 계약). 카테고리 이름은 카테고리 목록(#34)에서 찾는다.
 * 통계는 기기에 저장하지 않는 읽기 화면이다(P-902, F-908, #238의 범위 밖 표).
 * 1B 임시: 전환 줄은 "월별" 칸 하나라 숨기고(designer #242), 카테고리 줄은 누를 수 없다(E-02는 1C, planner #102).
 */

const CSS = 'src/features/stats/MonthlyStats.module.css'
const loading = '불러오고 있어요.'
const failed = '불러오지 못했어요.'
const later = '잠시 후 다시 시도해 주세요.'
const waitForConnection = '연결되면 자동으로 불러올게요.'

const server = startMockServer()
let backend: Backend
let categories: Categories
let stats: MonthlyStatsServer

/** 기기의 지금(서울 2026-11-26 목 12:30) */
const NOW = '2026-11-26T12:30:00+09:00'

beforeEach(() => {
  setDeviceClock(NOW)
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend, categories } = startServer(server))
  stats = startMonthlyStats(server, backend)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

/** 디자인 시안과 같은 11월. 상위 카테고리는 서버가 주는 순서다 */
function putNovember() {
  const november = statsOf('2026-11', {
    income: 3200000,
    expense: 1245300,
    top: [
      [id.food, 412000],
      [id.traffic, 206000],
      [id.expenseNone, 103000],
    ],
  })
  stats.months.set('2026-11', november)
  return november
}

const main = () => screen.getByRole('main')
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const styleOf = (element: Element) => getComputedStyle(element)
/** 달 이동의 달 이름(h2, 바뀌면 화면 읽기에 알린다) */
const monthHeading = () => main().querySelector<HTMLElement>('h2[aria-live="polite"]')!
const monthButton = (name: '이전 달' | '다음 달') => within(main()).queryByRole('button', { name })
const tabBar = () => screen.getByRole('navigation', { name: '주 메뉴' })
/** 화면 읽기에 보이는 글. aria-hidden인 것은 뺀다 */
function shownText(element: Element): string {
  const copy = element.cloneNode(true) as Element
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove())
  return copy.textContent ?? ''
}
/** (5) 수입·지출·차액의 [이름, 값] */
const totals = () => [...main().querySelectorAll('dt')].map((term) => [term.textContent, shownText(term.nextElementSibling!)])
const totalOf = (name: string) =>
  [...main().querySelectorAll('dt')].find((term) => term.textContent === name)!.nextElementSibling!.querySelector('span')!
const topRegion = () => screen.getByRole('region', { name: '지출이 큰 카테고리' })
const queryTopRegion = () => screen.queryByRole('region', { name: '지출이 큰 카테고리' })
const topRows = () => within(topRegion()).getAllByRole('listitem')
/** 카테고리 줄의 막대(채움) */
const barOf = (row: HTMLElement) => row.querySelector<HTMLElement>('[aria-hidden="true"] > span')!
const basis = () => within(main()).queryByText(/ 기준$/)
const failure = () => within(main()).queryByRole('heading', { level: 2, name: failed })
const retry = () => within(main()).queryByRole('button', { name: '다시 시도' })

/** 통계를 열고 내용(합계나 불러오지 못함)이 그려질 때까지 기다린다 */
async function openStats(path = '/stats/monthly?month=2026-11') {
  const opened = await openApp(path)
  await untilContent()
  return opened
}

async function untilContent() {
  await waitFor(() => expect(screen.queryAllByText('차액').length + screen.queryAllByText(failed).length).toBeGreaterThan(0))
}

describe('주소와 공통 틀', () => {
  it('/stats/monthly?month=2026-11은 탭의 첫 화면이다. 상단 바에 장부 이름만 있고 "뒤로"가 없으며 화면 제목은 "통계"다', async () => {
    putNovember()
    await openStats()
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByText(meOf('user-1').ledgers[0].name)).toBeTruthy()
    expect(bar.queryByRole('button', { name: '뒤로' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: '통계' })).toBeTruthy()
  })

  it('화면 제목은 화면 읽기에만 있다(휴대폰과 넓은 화면 모두, designer #242)', async () => {
    await openStats()
    const title = readCssRule(CSS, '.title')
    expect(title).toContain('clip-path: inset(50%);')
    expect(title).toContain('position: absolute;')
    setViewportWidth(1280)
    expect(styleOf(screen.getByRole('heading', { level: 1, name: '통계' })).position).toBe('absolute')
  })

  it('하단 탭은 홈, 내역, 거래 입력, 통계, 더보기 다섯 칸이고 통계는 ChartBar 24px다', async () => {
    await openStats()
    const cells = within(tabBar()).getAllByRole('listitem')
    expect(cells.map((cell) => cell.textContent)).toEqual(['홈', '내역', '', '통계', '더보기'])
    const link = within(cells[3]).getByRole('link', { name: '통계' })
    expect(link.getAttribute('href')).toBe('/stats/monthly')
    const icon = link.querySelector('svg')!
    expect(styleOf(icon).width).toBe('var(--size-icon-24)')
    expect(icon.querySelector('path')!.getAttribute('d')).toMatch(/^M224,200h-8V40/)
  })

  it('하단 탭의 "통계"가 지금 화면이다', async () => {
    await openStats()
    const current = within(tabBar()).getAllByRole('link', { current: 'page' })
    expect(current.map((link) => link.textContent)).toEqual(['통계'])
  })

  it('넓은 화면의 사이드바 주 메뉴는 홈, 내역, 통계 순서이고 통계가 지금 화면이다', async () => {
    await openStats()
    setViewportWidth(1280)
    const sidebar = document.querySelector<HTMLElement>('[class*="sidebar"]')!
    const links = within(within(sidebar).getAllByRole('list')[0]).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['홈', '내역', '통계'])
    expect(links[2].getAttribute('aria-current')).toBe('page')
    expect(links[2].querySelector('svg')).not.toBeNull()
  })

  it('달이 없으면 이번 달로 바꿔 간다(방문 기록을 쌓지 않는다)', async () => {
    const opened = await openStats('/stats/monthly')
    expect(addressOf(opened)).toBe('/stats/monthly?month=2026-11')
    expect(opened.router.state.historyAction).toBe('REPLACE')
  })

  it.each(['2026-13', '2026-1', '1999-12', '2027-12', 'abc', ''])('고를 수 없는 달(%s)이면 이번 달로 바꿔 간다', async (month) => {
    const opened = await openStats(`/stats/monthly?month=${month}`)
    expect(addressOf(opened)).toBe('/stats/monthly?month=2026-11')
    expect(stats.requests.map((each) => each.month)).toEqual(['2026-11'])
  })

  it('그 장부의 그 달 하나만 month로 요청한다', async () => {
    await openStats('/stats/monthly?month=2026-10')
    expect(stats.requests).toEqual([{ ledgerId: LEDGER, month: '2026-10', names: ['month'] }])
  })

  it('1B에는 전환 줄의 칸이 "월별" 하나라 줄을 보이지 않는다(designer #242)', async () => {
    putNovember()
    await openStats()
    expect(within(main()).queryByRole('navigation')).toBeNull()
    expect(within(main()).queryByText('월별')).toBeNull()
    expect(main().querySelector('[aria-current]')).toBeNull()
  })
})

describe('들어가는 길과 돌아가기', () => {
  it('하단 탭의 "통계"를 누르면 이번 달의 통계다', async () => {
    const opened = await openApp('/more')
    await opened.user.click(await waitFor(() => within(tabBar()).getByRole('link', { name: '통계' })))
    await untilContent()
    expect(addressOf(opened)).toBe('/stats/monthly?month=2026-11')
    expect(monthHeading().textContent).toBe('11월')
  })

  it('홈의 이번 달 합계 구역을 누르면 이번 달의 통계로 가고, 뒤로 가면 홈이다', async () => {
    putNovember()
    const opened = await openApp('/home')
    const link = await waitFor(() => within(screen.getByRole('region', { name: '11월 합계' })).getByRole('link'))
    expect(link.getAttribute('href')).toBe('/stats/monthly?month=2026-11')
    await opened.user.click(link)
    await untilContent()
    expect(addressOf(opened)).toBe('/stats/monthly?month=2026-11')
    expect(totals()[0]).toEqual(['수입', '+3,200,000원'])
    await act(() => opened.router.navigate(-1))
    await screen.findByRole('heading', { level: 1, name: '홈' })
    expect(addressOf(opened)).toBe('/home')
  })

  it('홈에서 오면 기억한 달이 있어도 이번 달이다', async () => {
    const opened = await openStats('/stats/monthly?month=2026-08')
    await act(() => opened.router.navigate('/home'))
    const link = await waitFor(() => within(screen.getByRole('region', { name: '11월 합계' })).getByRole('link'))
    await opened.user.click(link)
    await waitFor(() => expect(monthHeading()?.textContent).toBe('11월'))
    expect(addressOf(opened)).toBe('/stats/monthly?month=2026-11')
  })

  it('고른 달을 기억해, 다른 화면에 다녀와 하단 탭으로 오면 그 달이다', async () => {
    const opened = await openStats('/stats/monthly?month=2026-11')
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('10월'))
    await act(() => opened.router.navigate('/more'))
    await opened.user.click(await waitFor(() => within(tabBar()).getByRole('link', { name: '통계' })))
    await waitFor(() => expect(addressOf(opened)).toBe('/stats/monthly?month=2026-10'))
  })

  it('통계의 달과 내역의 달은 따로 기억한다', async () => {
    const opened = await openStats('/stats/monthly?month=2026-08')
    await act(() => opened.router.navigate('/transactions'))
    await waitFor(() => expect(addressOf(opened)).toBe('/transactions?month=2026-11'))
  })

  it('기억한 달은 기기 저장소에 남기지 않는다', async () => {
    const opened = await openStats('/stats/monthly?month=2026-08')
    await act(() => opened.router.navigate('/more'))
    const stored = [localStorage, sessionStorage].flatMap((storage) =>
      Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`),
    )
    expect(stored.join()).not.toContain('2026-08')
  })

  it('로그아웃하면 기억한 달이 사라진다', async () => {
    const opened = await openStats('/stats/monthly?month=2026-08')
    const { logout } = await import('../src/api/session')
    act(() => logout())
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    await opened.user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('navigation', { name: '주 메뉴' })
    await act(() => opened.router.navigate('/stats/monthly'))
    await waitFor(() => expect(addressOf(opened)).toBe('/stats/monthly?month=2026-11'))
  })
})

describe('달 이동(00-common 5.9)', () => {
  it('가운데 달 이름은 h2이고 바뀌면 화면 읽기에 알리며, 양옆에 "이전 달"과 "다음 달"이 있다', async () => {
    await openStats()
    expect(monthHeading().textContent).toBe('11월')
    expect(styleOf(monthHeading()).font).toBe('var(--text-body-strong)')
    for (const name of ['이전 달', '다음 달'] as const) expect(monthButton(name)!.querySelector('svg')).not.toBeNull()
  })

  it('누르면 주소의 달을 바꾸고(방문 기록을 쌓지 않는다) 그 달을 불러온다', async () => {
    const opened = await openStats()
    await opened.user.click(monthButton('다음 달')!)
    await waitFor(() => expect(addressOf(opened)).toBe('/stats/monthly?month=2026-12'))
    expect(opened.router.state.historyAction).toBe('REPLACE')
    await waitFor(() => expect(monthHeading().textContent).toBe('12월'))
    await waitFor(() => expect(stats.requests.at(-1)?.month).toBe('2026-12'))
  })

  it('올해가 아닌 달은 연도를 붙인다', async () => {
    await openStats('/stats/monthly?month=2025-12')
    expect(monthHeading().textContent).toBe('2025년 12월')
  })

  it('2000년 1월에서는 "이전 달"을, 오늘이 속한 달의 12달 뒤에서는 "다음 달"을 숨긴다', async () => {
    const opened = await openStats('/stats/monthly?month=2000-01')
    expect(monthButton('이전 달')).toBeNull()
    expect(monthButton('다음 달')).not.toBeNull()
    await act(() => opened.router.navigate('/stats/monthly?month=2027-11'))
    await waitFor(() => expect(monthHeading().textContent).toBe('2027년 11월'))
    expect(monthButton('다음 달')).toBeNull()
    expect(monthButton('이전 달')).not.toBeNull()
  })

  it('달을 옮기면 내용 자리만 뼈대로 바뀌고 달 이동은 그대로다', async () => {
    putNovember()
    const opened = await openStats()
    const slow = delayed()
    stats.response = (month) => (month === '2026-10' ? slow.respond() : HttpResponse.json(statsOf(month!)))
    const bar = monthHeading().parentElement
    await opened.user.click(monthButton('이전 달')!)
    await passTime(350)
    expect(screen.getByText(loading)).toBeTruthy()
    expect(monthHeading().parentElement).toBe(bar)
    expect(monthHeading().textContent).toBe('10월')
    expect(screen.queryAllByText('차액')).toEqual([])
    slow.answer(HttpResponse.json(statsOf('2026-10', { income: 1000 })))
    await waitFor(() => expect(totals()[0]).toEqual(['수입', '+1,000원']))
  })
})

describe('월 경계(기기의 오늘이 속한 달, planner 2026-11-26)', () => {
  it.each([
    ['2026-11-30T23:59:59+09:00', 'Asia/Seoul', '2026-11', '11월'],
    ['2026-12-01T00:00:00+09:00', 'Asia/Seoul', '2026-12', '12월'],
    ['2026-12-31T23:59:59+09:00', 'Asia/Seoul', '2026-12', '12월'],
    ['2027-01-01T00:00:00+09:00', 'Asia/Seoul', '2027-01', '1월'],
    // 서울은 12월 1일 10시지만 기기(로스앤젤레스)는 11월 30일 17시다
    ['2026-12-01T10:00:00+09:00', 'America/Los_Angeles', '2026-11', '11월'],
    // 서울은 12월 31일 23시지만 기기(키리티마티, UTC+14)는 1월 1일 4시다
    ['2026-12-31T23:00:00+09:00', 'Pacific/Kiritimati', '2027-01', '1월'],
  ])('기기의 지금이 %s(%s)이면 처음 달은 %s(%s)다', async (at, timeZone, month, label) => {
    setDeviceClock(at, timeZone)
    const opened = await openStats('/stats/monthly')
    expect(addressOf(opened)).toBe(`/stats/monthly?month=${month}`)
    expect(monthHeading().textContent).toBe(label)
  })

  it('1월 1일에는 지난해 12월에 연도를 붙인다', async () => {
    setDeviceClock('2027-01-01T00:00:00+09:00')
    const opened = await openStats('/stats/monthly')
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('2026년 12월'))
  })

  it('말일에서 1일로 넘어가면 다음 달 끝(12달 뒤)까지 고를 수 있다', async () => {
    setDeviceClock('2026-11-30T23:59:59+09:00')
    const before = await openStats('/stats/monthly?month=2027-12')
    expect(addressOf(before)).toBe('/stats/monthly?month=2026-11')
    cleanup()
    setDeviceClock('2026-12-01T00:00:00+09:00')
    const after = await openStats('/stats/monthly?month=2027-12')
    expect(addressOf(after)).toBe('/stats/monthly?month=2027-12')
    expect(monthButton('다음 달')).toBeNull()
  })

  it('홈의 합계 링크도 기기의 오늘이 속한 달로 간다(1일 0시)', async () => {
    setDeviceClock('2026-12-01T00:00:00+09:00')
    await openApp('/home')
    const link = await waitFor(() => within(screen.getByRole('region', { name: '12월 합계' })).getByRole('link'))
    expect(link.getAttribute('href')).toBe('/stats/monthly?month=2026-12')
  })
})

describe('(5) 수입, 지출, 차액', () => {
  it('서버가 준 값을 수입, 지출, 차액 순서로 보인다. 수입은 강조색과 "+", 지출과 차액은 본문 글자색이다', async () => {
    putNovember()
    await openStats()
    expect(totals()).toEqual([
      ['수입', '+3,200,000원'],
      ['지출', '1,245,300원'],
      ['차액', '+1,954,700원'],
    ])
    expect(styleOf(totalOf('수입')).color).toBe('var(--color-accent)')
    expect(styleOf(totalOf('지출')).color).toBe('var(--color-text)')
    expect(styleOf(totalOf('차액')).color).toBe('var(--color-text)')
  })

  it('차액은 서버가 준 값이고 음수면 "-"를 붙인다', async () => {
    stats.months.set('2026-11', { ...statsOf('2026-11', { income: 100000, expense: 220000 }), net: -120000 })
    await openStats()
    expect(totals()).toEqual([
      ['수입', '+100,000원'],
      ['지출', '220,000원'],
      ['차액', '-120,000원'],
    ])
  })

  it('수입이 0원이면 부호와 강조색 없이 "0원"이다', async () => {
    stats.months.set('2026-11', statsOf('2026-11', { expense: 5000, top: [[id.food, 5000]] }))
    await openStats()
    expect(totals()[0]).toEqual(['수입', '0원'])
    expect(styleOf(totalOf('수입')).color).toBe('var(--color-text)')
  })

  it('환불이 더 커 지출이 음수인 달은 "-"를 붙인 본문 글자색이다(0.2)', async () => {
    stats.months.set('2026-11', statsOf('2026-11', { expense: -12000 }))
    await openStats()
    expect(totals()).toEqual([
      ['수입', '0원'],
      ['지출', '-12,000원'],
      ['차액', '+12,000원'],
    ])
    expect(styleOf(totalOf('지출')).color).toBe('var(--color-text)')
  })

  it('휴대폰 배치는 세 줄(사이 8px)이고 이름은 보조 글자색 본문, 금액은 굵은 본문으로 오른쪽 끝이다', async () => {
    putNovember()
    await openStats()
    setViewportWidth(390)
    const list = styleOf(main().querySelector('dl')!)
    expect(list.flexDirection).toBe('column')
    expect(list.rowGap).toBe('var(--space-8)')
    const name = styleOf(main().querySelector('dt')!)
    expect(name.color).toBe('var(--color-text-secondary)')
    expect(name.font).toBe('var(--text-body)')
    const amount = styleOf(main().querySelector('dd')!)
    expect(amount.font).toBe('var(--text-body-strong)')
    expect(amount.marginInlineStart).toBe('auto')
  })

  it('넓은 화면은 세 칸이 가로로 나란히이고 칸마다 이름 아래 금액이다(왼쪽 정렬)', async () => {
    putNovember()
    await openStats()
    setViewportWidth(1280)
    const list = styleOf(main().querySelector('dl')!)
    expect(list.display).toBe('grid')
    expect(list.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
    const figure = styleOf(main().querySelector('dt')!.parentElement!)
    expect(figure.flexDirection).toBe('column')
    expect(styleOf(main().querySelector('dd')!).marginInlineStart).toBe('0px')
    expect(styleOf(main().querySelector('dd')!).textAlign).toBe('start')
  })
})

describe('(6)(7) 지출이 큰 카테고리', () => {
  it('머리 "지출이 큰 카테고리"(h2) 아래에 서버 순서대로 카테고리 이름과 금액을 보인다', async () => {
    putNovember()
    await openStats()
    const head = within(topRegion()).getByRole('heading', { level: 2 })
    expect(head.textContent).toBe('지출이 큰 카테고리')
    expect(styleOf(head).font).toBe('var(--text-body-strong)')
    expect(topRows().map(shownText)).toEqual(['식비412,000원', '교통206,000원', '미분류103,000원'])
  })

  it('이름은 카테고리 목록(#34)의 최상위 이름이고, 목록에 없는 id면 이름 자리를 비운다(planner #242)', async () => {
    stats.months.set(
      '2026-11',
      statsOf('2026-11', {
        expense: 30000,
        top: [
          ['cccccccc-0000-4000-8000-000000000009', 20000],
          [id.food, 10000],
        ],
      }),
    )
    await openStats()
    expect(topRows().map(shownText)).toEqual(['20,000원', '식비10,000원'])
  })

  it('다섯 개면 다섯 줄, 하나면 한 줄이다', async () => {
    categories.items = [
      ...categories.items,
      ...['a', 'b', 'c'].map((letter, index) => ({
        id: `dddddddd-0000-4000-8000-00000000000${index}`,
        kind: 'EXPENSE',
        name: `카테고리 ${letter}`,
        system: false,
        children: [],
      })),
    ]
    stats.months.set(
      '2026-11',
      statsOf('2026-11', {
        expense: 150,
        top: [
          [id.food, 50],
          ['dddddddd-0000-4000-8000-000000000000', 40],
          ['dddddddd-0000-4000-8000-000000000001', 30],
          ['dddddddd-0000-4000-8000-000000000002', 20],
          [id.traffic, 10],
        ],
      }),
    )
    const opened = await openStats()
    expect(topRows()).toHaveLength(5)
    stats.months.set('2026-10', statsOf('2026-10', { expense: 7000, top: [[id.traffic, 7000]] }))
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(topRows().map(shownText)).toEqual(['교통7,000원']))
  })

  it('줄은 누를 수 없다: 링크·버튼이 아니고 초점을 받지 않으며 ">"가 없다(1B, designer #242)', async () => {
    putNovember()
    await openStats()
    expect(within(topRegion()).queryAllByRole('link')).toEqual([])
    expect(within(topRegion()).queryAllByRole('button')).toEqual([])
    expect(topRegion().querySelectorAll('[tabindex], svg')).toHaveLength(0)
    expect(readCssRule(CSS, '.topRow')).not.toMatch(/cursor|transition/)
    expect(readWebFile(CSS)).not.toMatch(/\.topRow:(active|hover|focus)/)
  })

  it('막대는 5개 중 가장 큰 금액을 전체 폭으로 보고 금액에 비례하며, 화면 읽기에서 숨긴다', async () => {
    putNovember()
    await openStats()
    const rows = topRows()
    expect(rows.map((row) => barOf(row).style.getPropertyValue('--share'))).toEqual(['100%', '50%', '25%'])
    for (const row of rows) expect(barOf(row).parentElement!.getAttribute('aria-hidden')).toBe('true')
    expect(barOf(rows[0]).getAttribute('style')).toBe('--share: 100%;')
  })

  it('막대의 비율은 소수 둘째 자리까지 반올림한다(금액은 원 단위 정수이고 폭만 비율이다)', async () => {
    stats.months.set('2026-11', statsOf('2026-11', { expense: 4, top: [[id.food, 3], [id.traffic, 1]] }))
    await openStats()
    expect(topRows().map((row) => barOf(row).style.getPropertyValue('--share'))).toEqual(['100%', '33.33%'])
  })

  it('막대는 높이 8px, 모서리 0, 바탕 color-border, 채움은 보조 글자색이다(00-common 2.6)', () => {
    const track = readCssRule(CSS, '.bar')
    expect(track).toContain('height: var(--space-8);')
    expect(track).toContain('background-color: var(--color-border);')
    expect(track).not.toMatch(/radius/)
    const fill = readCssRule(CSS, '.barFill')
    expect(fill).toContain('width: var(--share);')
    expect(fill).toContain('background-color: var(--color-text-secondary);')
    expect(fill).not.toMatch(/radius/)
  })

  it('줄은 56px 이상, 좌우 16px, 위아래 8px이고 이름은 본문, 금액은 굵은 본문 오른쪽 끝이다', async () => {
    putNovember()
    await openStats()
    setViewportWidth(390)
    expect(styleOf(topRows()[0]).minHeight).toBe('var(--size-row)')
    expect(readCssRule(CSS, '.topRow')).toContain('padding: var(--space-8) var(--space-16);')
    expect(readCssRule(CSS, '.topRow')).not.toMatch(/border|background/)
    expect(styleOf(topRows()[0].querySelector('[class*="topName"]')!).font).toBe('var(--text-body)')
    const amount = styleOf(topRows()[0].querySelector('[class*="topAmount"]')!)
    expect(amount.font).toBe('var(--text-body-strong)')
    expect(amount.textAlign).toBe('end')
  })

  it('휴대폰 배치는 이름과 금액 아래 4px에 막대가 전체 폭이고, 넓은 화면은 한 줄에 이름 25%, 막대, 금액이다', async () => {
    putNovember()
    await openStats()
    setViewportWidth(390)
    const row = topRows()[0]
    expect(styleOf(row).gridTemplateAreas).toBe('"name amount" "bar bar"')
    expect(styleOf(row).rowGap).toBe('var(--space-4)')
    setViewportWidth(1280)
    expect(styleOf(row).gridTemplateAreas).toBe('"name bar amount"')
    expect(styleOf(row).gridTemplateColumns).toBe('25% minmax(0, 1fr) auto')
    expect(styleOf(row).columnGap).toBe('var(--space-12)')
  })
})

describe('데이터 없음', () => {
  it('거래가 없는 달은 합계가 모두 0원이고 (6) 자리에 "{달}월에 입력한 거래가 없어요"와 "거래 입력"(지출)이다', async () => {
    const opened = await openStats('/stats/monthly?month=2026-10')
    expect(totals()).toEqual([
      ['수입', '0원'],
      ['지출', '0원'],
      ['차액', '0원'],
    ])
    expect(queryTopRegion()).toBeNull()
    expect(screen.getByText('10월에 입력한 거래가 없어요')).toBeTruthy()
    const entry = within(main()).getByRole('link', { name: '거래 입력' })
    expect(entry.getAttribute('href')).toBe('/transactions/new')
    await opened.user.click(entry)
    await waitFor(() => expect(screen.getByRole('radio', { name: '지출' }).getAttribute('aria-checked')).toBe('true'))
    expect(addressOf(opened)).toBe('/transactions/new')
  })

  it('다른 해의 빈 달은 연도를 붙인다', async () => {
    await openStats('/stats/monthly?month=2025-12')
    expect(screen.getByText('2025년 12월에 입력한 거래가 없어요')).toBeTruthy()
  })

  it('보기 전용은 문장만 보이고 "거래 입력"이 없다', async () => {
    backend.meResponse = () =>
      HttpResponse.json({ ...meOf('user-1'), ledgers: [{ ...meOf('user-1').ledgers[0], role: 'VIEWER' }] })
    await openStats()
    expect(screen.getByText('11월에 입력한 거래가 없어요')).toBeTruthy()
    expect(within(main()).queryByRole('link', { name: '거래 입력' })).toBeNull()
  })

  it('수입만 있고 지출이 없으면 (6) 자리에 "{달}월에는 지출이 없어요"만 있다', async () => {
    stats.months.set('2026-11', statsOf('2026-11', { income: 3200000 }))
    await openStats()
    expect(totals()[0]).toEqual(['수입', '+3,200,000원'])
    expect(screen.getByText('11월에는 지출이 없어요')).toBeTruthy()
    expect(queryTopRegion()).toBeNull()
    expect(within(main()).queryByRole('link')).toBeNull()
  })

  it('환불이 더 커 지출이 0원 이하인 달도 "{달}월에는 지출이 없어요"다(planner #242)', async () => {
    stats.months.set('2026-11', statsOf('2026-11', { expense: -12000 }))
    await openStats()
    expect(screen.getByText('11월에는 지출이 없어요')).toBeTruthy()
  })
})

describe('불러오는 중', () => {
  it('300ms 뒤에 합계 세 줄과 카테고리 줄 3개 모양의 뼈대를 보이고 달 이동은 바로 보인다', async () => {
    const slow = delayed()
    stats.response = () => slow.respond()
    holdClock()
    await openApp('/stats/monthly?month=2026-11')
    await waitFor(() => expect(monthHeading()?.textContent).toBe('11월'))
    await slow.arrived
    expect(screen.queryByText(loading)).toBeNull()
    await passTime(300)
    expect(screen.getByText(loading)).toBeTruthy()
    const bones = main().querySelector('[aria-hidden="true"] [class*="totals"]')!.parentElement!
    expect(bones.querySelectorAll('[class*="totals"] > div')).toHaveLength(3)
    expect(bones.querySelectorAll('[class*="topRow"]')).toHaveLength(3)
    slow.answer(HttpResponse.json(statsOf('2026-11')))
    await untilContent()
  })
})

describe('네트워크 오류(F-907, F-908)', () => {
  it('서버 오류면 내용 자리에 "불러오지 못했어요.", "잠시 후 다시 시도해 주세요."와 "다시 시도"이고, 누르면 다시 받는다', async () => {
    stats.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openStats()
    expect(failure()).toBeTruthy()
    expect(within(main()).getByText(later)).toBeTruthy()
    expect(monthHeading().textContent).toBe('11월')
    putNovember()
    stats.response = undefined
    await opened.user.click(retry()!)
    await waitFor(() => expect(totals()[0]).toEqual(['수입', '+3,200,000원']))
  })

  it('응답이 15초 동안 없으면 서버 오류와 같다', async () => {
    const slow = delayed()
    stats.response = () => slow.respond()
    holdClock()
    await openApp('/stats/monthly?month=2026-11')
    await slow.arrived
    await passTime(15_000)
    await waitFor(() => expect(failure()).toBeTruthy())
    expect(retry()).toBeTruthy()
  })

  it('카테고리 목록을 받지 못하고 기기에도 없으면 불러오지 못함이고, "다시 시도"는 받지 못한 것만 다시 받는다', async () => {
    putNovember()
    categories.response = () => problem(500, 'INTERNAL_ERROR')
    const opened = await openStats()
    expect(failure()).toBeTruthy()
    const before = stats.requests.length
    categories.response = undefined
    await opened.user.click(retry()!)
    await waitFor(() => expect(topRows()).toHaveLength(3))
    expect(stats.requests).toHaveLength(before)
  })

  it('보던 중 연결이 끊기면 불러온 통계를 두고 합계 위에 "{시각} 기준"을 붙인다. 연결이 돌아오면 다시 받고 지운다', async () => {
    putNovember()
    await openStats()
    expect(basis()).toBeNull()
    act(() => goOffline())
    expect(basis()!.textContent).toBe('12:30 기준')
    expect(totals()[0]).toEqual(['수입', '+3,200,000원'])
    expect(topRows()).toHaveLength(3)
    const before = stats.requests.length
    act(() => goOnline())
    await waitFor(() => expect(basis()).toBeNull())
    expect(stats.requests.length).toBe(before + 1)
  })

  it('기준 시각은 합계 바로 위 한 줄 오른쪽 끝의 보조 글자색 캡션이다(designer #242)', async () => {
    putNovember()
    await openStats()
    act(() => goOffline())
    const line = basis()!.parentElement!
    expect(line.nextElementSibling).toBe(main().querySelector('dl'))
    expect(styleOf(line).color).toBe('var(--color-text-secondary)')
    expect(styleOf(line).font).toBe('var(--text-caption)')
    expect(styleOf(line).textAlign).toBe('end')
  })

  it('연결이 없을 때 달을 바꾸면 내용 자리에 "불러오지 못했어요."와 "연결되면 자동으로 불러올게요."(버튼 없음)이고, 연결이 돌아오면 저절로 불러온다', async () => {
    putNovember()
    const opened = await openStats()
    act(() => goOffline())
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(failure()).toBeTruthy())
    expect(within(main()).getByText(waitForConnection)).toBeTruthy()
    expect(retry()).toBeNull()
    expect(basis()).toBeNull()
    stats.months.set('2026-10', statsOf('2026-10', { income: 500 }))
    act(() => goOnline())
    await waitFor(() => expect(totals()[0]).toEqual(['수입', '+500원']))
  })

  it('연결 없이 새로 들어오면 "불러오지 못했어요."와 "연결되면 자동으로 불러올게요."만 있고, 연결이 돌아오면 저절로 불러온다', async () => {
    putNovember()
    const opened = await openApp('/home')
    await screen.findByRole('region', { name: '11월 합계' })
    act(() => goOffline())
    await act(() => opened.router.navigate('/stats/monthly?month=2026-11'))
    await waitFor(() => expect(failure()).toBeTruthy())
    expect(within(main()).getByText(waitForConnection)).toBeTruthy()
    expect(retry()).toBeNull()
    act(() => goOnline())
    await waitFor(() => expect(totals()[0]).toEqual(['수입', '+3,200,000원']))
  })

  it('서버 오류 상태에서 연결까지 끊기면 둘째 줄이 바뀌고 "다시 시도"가 사라진다', async () => {
    stats.response = () => problem(503, 'UNAVAILABLE')
    await openStats()
    expect(retry()).toBeTruthy()
    act(() => goOffline())
    expect(within(main()).getByText(waitForConnection)).toBeTruthy()
    expect(retry()).toBeNull()
  })

  it('다시 들어와 새로 받지 못하면 받아 둔 통계를 기준 시각과 함께 둔다(N-03)', async () => {
    putNovember()
    const opened = await openStats()
    await act(() => opened.router.navigate('/more'))
    stats.response = () => problem(500, 'INTERNAL_ERROR')
    await act(() => opened.router.navigate('/stats/monthly?month=2026-11'))
    await waitFor(() => expect(basis()?.textContent).toBe('12:30 기준'))
    expect(totals()[0]).toEqual(['수입', '+3,200,000원'])
    await settle()
    expect(failure()).toBeNull()
  })
})

describe('비로그인 상태', () => {
  it('로그인(A-02)으로 보내고, 로그인하면 같은 달의 통계로 돌아온다', async () => {
    backend.cookieUser = undefined
    putNovember()
    stats.months.set('2026-08', statsOf('2026-08', { income: 800 }))
    const opened = await openApp('/stats/monthly?month=2026-08')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(addressOf(opened)).toBe('/login')
    await opened.user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await untilContent()
    expect(addressOf(opened)).toBe('/stats/monthly?month=2026-08')
    expect(totals()[0]).toEqual(['수입', '+800원'])
  })
})
