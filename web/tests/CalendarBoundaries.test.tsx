import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { installIntersectionObserver } from './support/intersection'
import { startMockServer } from './support/mockServer'
import { expenseOf, incomeOf, startDailyTotals, startTransactionList, type TransactionList } from './support/transactionList'
import { id, openApp, resetGlobals, settle, startServer, type Opened } from './support/transactionScreen'
import { resetViewport } from './support/viewport'

/*
 * 달력(D-02)의 날짜·월 경계. 앱은 기기의 지금과 시간대를 시계(src/lib/clock)에서만 읽으므로, 테스트를 돌리는 기기의 TZ와
 * 상관없이 같아야 한다. 로컬에서는 이 파일을 다섯 시간대(TZ)로 한 번씩 돌린다.
 */

const server = startMockServer()
let backend: Backend
let list: TransactionList

beforeEach(() => {
  setDeviceClock('2026-11-26T12:30:00+09:00')
  vi.stubGlobal('scrollTo', vi.fn())
  ;({ backend } = startServer(server))
  list = startTransactionList(server, backend)
  startDailyTotals(server, backend, list)
  installIntersectionObserver()
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  resetViewport()
  resetGlobals()
})

const grid = () => screen.getByRole('grid')
const monthHeading = () => screen.getByRole('heading', { level: 2 })
const cell = (name: string) => within(grid()).getByRole('gridcell', { name: new RegExp(`^${name},`) })
const figuresOf = (name: string) => [...cell(name).querySelectorAll('[class*="_figure_"]')].map((figure) => figure.textContent)
const selected = () => within(grid()).getAllByRole('gridcell').find((each) => each.getAttribute('aria-selected') === 'true')
const today = () => grid().querySelector('[aria-current="date"]')
const monthButton = (name: '이전 달' | '다음 달') => within(screen.getByRole('main')).queryByRole('button', { name })
const addressOf = ({ router }: Opened) => router.state.location.pathname + router.state.location.search

async function openCalendar(path: string) {
  const opened = await openApp(path)
  await screen.findByRole('grid')
  await waitFor(() => expect(screen.queryAllByRole('heading', { level: 3 }).length).toBeGreaterThan(0))
  await settle()
  return opened
}

const expense = (occurredOn: string, amount: number) =>
  expenseOf({ occurredOn, accountId: id.card, categoryId: id.food, amount })

describe('1일과 말일의 거래가 그 달의 맞는 칸에 보인다', () => {
  it('2026년 2월: 1일과 28일', async () => {
    list.months.set('2026-02', [expense('2026-02-28', 2800), expense('2026-02-01', 100)])
    await openCalendar('/transactions/calendar?month=2026-02')
    expect(figuresOf('2월 1일')).toEqual(['100'])
    expect(figuresOf('2월 28일')).toEqual(['2,800'])
    expect(within(grid()).queryByRole('gridcell', { name: /^2월 29일,/ })).toBeNull()
  })

  it('윤년 2028년 2월: 29일이 있고 2월에 보인다', async () => {
    list.months.set('2028-02', [expense('2028-02-29', 2900)])
    // 2028년 2월은 2026-11-26이 속한 달의 12달 뒤를 넘으므로 그 해의 시계로 연다
    setDeviceClock('2028-02-10T09:00:00+09:00')
    await openCalendar('/transactions/calendar?month=2028-02')
    expect(figuresOf('2월 29일')).toEqual(['2,900'])
  })

  it('12월 31일과 1월 1일은 각자의 달에 있다', async () => {
    list.months.set('2026-12', [expense('2026-12-31', 3100)])
    list.months.set('2027-01', [incomeOf({ occurredOn: '2027-01-01', accountId: id.salary, categoryId: id.pay, amount: 1000000 })])
    const opened = await openCalendar('/transactions/calendar?month=2026-12')
    expect(figuresOf('12월 31일')).toEqual(['3,100'])
    await opened.user.click(monthButton('다음 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('2027년 1월'))
    await waitFor(() => expect(figuresOf('2027년 1월 1일')).toEqual(['+100만']))
  })
})

// 시간대마다 그 시간대의 시각을 오프셋으로 적는다(11월 말~1월이라 로스앤젤레스는 겨울 시간 −08:00)
describe.each([
  ['Asia/Seoul', '+09:00'],
  ['UTC', 'Z'],
  ['America/Los_Angeles', '-08:00'],
  ['Pacific/Kiritimati', '+14:00'],
  ['Pacific/Pago_Pago', '-11:00'],
])('기기의 시간대가 %s일 때 오늘 표시, 처음 고른 날, 달 이름과 범위는 기기의 오늘을 따른다', (timeZone, offset) => {
  it('월말 자정 전(11월 30일 23:59)은 11월이고 오늘과 고른 날이 30일이다', async () => {
    setDeviceClock(`2026-11-30T23:59:59${offset}`, timeZone)
    const opened = await openCalendar('/transactions/calendar')
    expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-11')
    expect(today()).toBe(cell('11월 30일'))
    expect(selected()).toBe(cell('11월 30일'))
  })

  it('월말 자정 뒤(12월 1일 00:00)는 12월이고 오늘과 고른 날이 1일이다', async () => {
    setDeviceClock(`2026-12-01T00:00:00${offset}`, timeZone)
    const opened = await openCalendar('/transactions/calendar')
    expect(addressOf(opened)).toBe('/transactions/calendar?month=2026-12')
    expect(monthHeading().textContent).toBe('12월')
    expect(today()).toBe(cell('12월 1일'))
    expect(selected()).toBe(cell('12월 1일'))
  })

  it('연말 자정 전(12월 31일 23:59)은 "12월"이고 범위의 끝은 2027년 12월이다', async () => {
    setDeviceClock(`2026-12-31T23:59:59${offset}`, timeZone)
    await openCalendar('/transactions/calendar?month=2027-12')
    expect(monthHeading().textContent).toBe('2027년 12월')
    expect(monthButton('다음 달')).toBeNull()
    cleanup()
    await openCalendar('/transactions/calendar')
    expect(monthHeading().textContent).toBe('12월')
    expect(today()).toBe(cell('12월 31일'))
  })

  it('연말 자정 뒤(1월 1일 00:00)는 "1월"이고 앞 달은 "2026년 12월", 범위의 끝은 2028년 1월이다', async () => {
    setDeviceClock(`2027-01-01T00:00:00${offset}`, timeZone)
    const opened = await openCalendar('/transactions/calendar')
    expect(addressOf(opened)).toBe('/transactions/calendar?month=2027-01')
    expect(monthHeading().textContent).toBe('1월')
    expect(today()).toBe(cell('1월 1일'))
    await opened.user.click(monthButton('이전 달')!)
    await waitFor(() => expect(monthHeading().textContent).toBe('2026년 12월'))
    cleanup()
    await openCalendar('/transactions/calendar?month=2028-01')
    expect(monthButton('다음 달')).toBeNull()
  })

  it('거래는 시간대 변환 없이 거래 날짜(occurredOn) 그대로의 칸에 보인다(P-202)', async () => {
    setDeviceClock(`2026-11-26T12:00:00${offset}`, timeZone)
    list.months.set('2026-11', [expense('2026-11-30', 3000), expense('2026-11-01', 1000)])
    await openCalendar('/transactions/calendar?month=2026-11')
    expect(figuresOf('11월 30일')).toEqual(['3,000'])
    expect(figuresOf('11월 1일')).toEqual(['1,000'])
    expect(figuresOf('11월 29일')).toEqual([])
    expect(figuresOf('11월 2일')).toEqual([])
  })
})
