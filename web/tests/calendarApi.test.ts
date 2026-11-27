import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { fetchDailyTotals } from '../src/features/transactions/dailyTotals'
import { fetchDayPage } from '../src/features/transactions/transactions'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { expenseOf, incomeOf, pageOf } from './support/transactionList'

const server = startMockServer()

const ledgerId = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const account = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const food = 'aaaaaaaa-0000-4000-8000-000000000001'

const sentQueries: URLSearchParams[] = []

function respondAt(path: string, body: unknown) {
  server.use(
    http.get(path, ({ request }) => {
      sentQueries.push(new URL(request.url).searchParams)
      return HttpResponse.json(body as object)
    }),
  )
}

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.catch((thrown: unknown) => thrown)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('달력용 날짜별 합계(GET .../stats/daily, #66 응답 계약)', () => {
  const path = `/api/v1/ledgers/${ledgerId}/stats/daily`
  const body = {
    month: '2026-11',
    days: [
      { date: '2026-11-01', income: 0, expense: 16500 },
      { date: '2026-11-30', income: 3200000, expense: 0 },
    ],
  }

  it('달 하나만 보내고 그 달의 날짜별 합계를 받는다', async () => {
    respondAt(path, body)
    expect(await fetchDailyTotals(ledgerId, '2026-11')).toEqual(body.days)
    const query = sentQueries.at(-1)!
    expect([...query.keys()]).toEqual(['month'])
    expect(query.get('month')).toBe('2026-11')
  })

  it('거래가 없는 달은 빈 목록이다', async () => {
    respondAt(path, { month: '2026-11', days: [] })
    expect(await fetchDailyTotals(ledgerId, '2026-11')).toEqual([])
  })

  it.each([
    ['다른 달', { ...body, month: '2026-10' }],
    ['다른 달의 날짜', { ...body, days: [{ date: '2026-10-31', income: 0, expense: 1 }] }],
    ['없는 날짜', { ...body, days: [{ date: '2026-11-31', income: 0, expense: 1 }] }],
    ['음수 금액', { ...body, days: [{ date: '2026-11-01', income: 0, expense: -1 }] }],
    ['소수 금액', { ...body, days: [{ date: '2026-11-01', income: 0.5, expense: 0 }] }],
    ['글자 금액', { ...body, days: [{ date: '2026-11-01', income: '0', expense: 0 }] }],
    ['같은 날 두 번', { ...body, days: [body.days[0], body.days[0]] }],
    ['날짜 역순', { ...body, days: [body.days[1], body.days[0]] }],
    ['days 없음', { month: '2026-11' }],
  ])('응답이 약속과 다르면(%s) 받지 않는다', async (_, wrong) => {
    respondAt(path, wrong)
    const error = await failureOf(fetchDailyTotals(ledgerId, '2026-11'))
    expect(error.kind).toBe('server')
  })

  it('서버의 거부는 ApiError로 던진다', async () => {
    server.use(http.get(path, () => problem(400, 'INVALID_REQUEST')))
    const error = await failureOf(fetchDailyTotals(ledgerId, '2026-11'))
    expect(error.status).toBe(400)
  })
})

describe('고른 날의 거래 목록(GET .../transactions?date=, #15 하루 모드)', () => {
  const path = `/api/v1/ledgers/${ledgerId}/transactions`
  const lunch = expenseOf({ occurredOn: '2026-11-18', occurredTime: '12:30', accountId: account, categoryId: food, amount: 12000 })
  const cafe = expenseOf({ occurredOn: '2026-11-18', occurredTime: '09:10', accountId: account, categoryId: food, amount: 4500 })
  const items = [lunch, cafe]

  it('날짜와 50건을 보내고 달은 보내지 않는다. 첫 쪽에는 cursor가 없다', async () => {
    respondAt(path, pageOf('2026-11-18', items, 0, 50))
    const page = await fetchDayPage(ledgerId, '2026-11-18', null)
    expect(page.items.map(({ id }) => id)).toEqual([lunch.id, cafe.id])
    expect(page.totals).toEqual({ income: 0, expense: 16500 })
    const query = sentQueries.at(-1)!
    expect([...query.keys()].toSorted()).toEqual(['date', 'limit'])
    expect(query.get('date')).toBe('2026-11-18')
    expect(query.get('limit')).toBe('50')
  })

  it('다음 쪽은 받은 cursor를 그대로 보내고, 합계가 없어도 받는다', async () => {
    respondAt(path, { ...pageOf('2026-11-18', items, 1, 50), totals: null })
    await fetchDayPage(ledgerId, '2026-11-18', '2026-11-18|1')
    expect(sentQueries.at(-1)!.get('cursor')).toBe('2026-11-18|1')
  })

  it.each([
    ['다른 날의 거래', () => pageOf('2026-11-18', [lunch, incomeOf({ occurredOn: '2026-11-19', accountId: account, categoryId: food, amount: 1 })], 0, 50)],
    ['다른 날의 합계', () => ({ ...pageOf('2026-11-18', items, 0, 50), days: [{ date: '2026-11-19', income: 0, expense: 1 }] })],
    ['첫 쪽에 합계 없음', () => ({ ...pageOf('2026-11-18', items, 0, 50), totals: null })],
  ])('응답이 약속과 다르면(%s) 받지 않는다', async (_, wrong) => {
    respondAt(path, wrong())
    const error = await failureOf(fetchDayPage(ledgerId, '2026-11-18', null))
    expect(error.kind).toBe('server')
  })
})
