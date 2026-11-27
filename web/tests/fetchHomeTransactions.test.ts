import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { fetchMonthTotals, fetchRecentTransactions } from '../src/features/transactions/transactions'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { expenseOf, incomeOf, pageOf, transferOf } from './support/transactionList'

/* 홈(C-01)이 쓰는 거래 목록 조회(#15의 응답 계약): 이번 달 합계(month, limit=1)와 최근 10건(달 없이 limit=10) */

const server = startMockServer()

const ledgerId = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const path = `/api/v1/ledgers/${ledgerId}/transactions`
const account = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const card = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const food = 'aaaaaaaa-0000-4000-8000-000000000001'

const lunch = expenseOf({ occurredOn: '2026-11-26', occurredTime: '12:30', accountId: account, categoryId: food, amount: 9000, payee: '올래국수' })
const salary = incomeOf({ occurredOn: '2026-10-25', occurredTime: '18:00', accountId: account, categoryId: food, amount: 3200000 })
const payment = transferOf({ occurredOn: '2025-12-31', fromAccountId: account, toAccountId: card, amount: 450000 })

/** 받은 요청의 쿼리 */
const sentQueries: URLSearchParams[] = []

function respondWith(body: unknown) {
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

describe('이번 달 합계(month, limit=1)', () => {
  it('달과 1건만 보내고 cursor를 보내지 않는다', async () => {
    respondWith(pageOf('2026-11', [lunch], 0, 1))
    await fetchMonthTotals(ledgerId, '2026-11')
    const query = sentQueries.at(-1)!
    expect([...query.entries()]).toEqual([
      ['month', '2026-11'],
      ['limit', '1'],
    ])
  })

  it('그 달 전체의 합계(totals)를 그대로 준다', async () => {
    respondWith({ ...pageOf('2026-11', [lunch], 0, 1), totals: { income: 3245000, expense: 1052500 } })
    expect(await fetchMonthTotals(ledgerId, '2026-11')).toEqual({ income: 3245000, expense: 1052500 })
  })

  it('거래가 없는 달은 합계가 0이다', async () => {
    respondWith(pageOf('2026-11', [], 0, 1))
    expect(await fetchMonthTotals(ledgerId, '2026-11')).toEqual({ income: 0, expense: 0 })
  })

  it.each([
    ['합계가 없다', { totals: null }],
    ['합계가 음수다', { totals: { income: -1, expense: 0 } }],
    ['합계가 정수가 아니다', { totals: { income: 1.5, expense: 0 } }],
    ['다른 달의 거래가 왔다', { items: [salary], days: [{ date: '2026-10-25', income: 3200000, expense: 0 }] }],
  ])('약속과 다른 응답(%s)은 받지 않는다', async (_, changes) => {
    respondWith({ ...pageOf('2026-11', [lunch], 0, 1), ...changes })
    expect((await failureOf(fetchMonthTotals(ledgerId, '2026-11'))).kind).toBe('server')
  })

  it('서버가 거부하면 그 오류를 그대로 던진다', async () => {
    server.use(http.get(path, () => problem(500, 'INTERNAL_ERROR')))
    expect((await failureOf(fetchMonthTotals(ledgerId, '2026-11'))).status).toBe(500)
  })
})

describe('최근 거래(달 없이 limit=10)', () => {
  it('달 없이 10건만 보낸다', async () => {
    respondWith(pageOf(null, [lunch, salary, payment], 0, 10))
    await fetchRecentTransactions(ledgerId)
    expect([...sentQueries.at(-1)!.entries()]).toEqual([['limit', '10']])
  })

  it('여러 달에 걸친 거래와 그날 전체 합계(days)를 받은 순서대로 준다. 다음 cursor는 쓰지 않는다', async () => {
    const body = { ...pageOf(null, [lunch, salary, payment], 0, 10), nextCursor: 'all-next' }
    respondWith(body)
    const recent = await fetchRecentTransactions(ledgerId)
    expect(recent.items.map(({ id }) => id)).toEqual([lunch.id, salary.id, payment.id])
    expect(recent.days).toEqual(body.days)
    expect(recent).not.toHaveProperty('nextCursor')
  })

  it('미래 날짜 거래도 거르지 않는다(거르는 것은 서버다)', async () => {
    const future = expenseOf({ occurredOn: '2027-01-02', accountId: account, categoryId: food, amount: 1 })
    respondWith(pageOf(null, [future, lunch], 0, 10))
    expect((await fetchRecentTransactions(ledgerId)).items.map(({ id }) => id)).toEqual([future.id, lunch.id])
  })

  it('거래가 없으면 빈 목록이다', async () => {
    respondWith(pageOf(null, [], 0, 10))
    expect(await fetchRecentTransactions(ledgerId)).toEqual({ items: [], days: [] })
  })

  it.each([
    ['합계가 왔다', { totals: { income: 0, expense: 0 } }],
    ['그날 합계가 없는 날짜의 거래가 있다', { days: [] }],
    ['거래가 배열이 아니다', { items: null }],
    ['빈 cursor', { nextCursor: '' }],
  ])('약속과 다른 응답(%s)은 받지 않는다', async (_, changes) => {
    respondWith({ ...pageOf(null, [lunch, salary], 0, 10), ...changes })
    expect((await failureOf(fetchRecentTransactions(ledgerId))).kind).toBe('server')
  })

  it('장부 id가 UUID가 아니면 요청하지 않는다', async () => {
    const before = sentQueries.length
    expect((await failureOf(fetchRecentTransactions('../me'))).kind).toBe('server')
    expect(sentQueries).toHaveLength(before)
  })
})
