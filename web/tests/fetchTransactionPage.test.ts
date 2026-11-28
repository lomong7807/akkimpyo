import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api/apiError'
import { fetchTransactionPage } from '../src/features/transactions/transactionPages'
import { startMockServer } from './support/mockServer'
import { problem } from './support/problem'
import { expenseOf, incomeOf, pageOf, transferOf } from './support/transactionList'

const server = startMockServer()

const ledgerId = '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60'
const path = `/api/v1/ledgers/${ledgerId}/transactions`
const account = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f'
const card = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const food = 'aaaaaaaa-0000-4000-8000-000000000001'

const lunch = expenseOf({ occurredOn: '2026-11-26', occurredTime: '12:30', accountId: account, categoryId: food, amount: 9000, payee: '올래국수' })
const salary = incomeOf({ occurredOn: '2026-11-25', occurredTime: '18:00', accountId: account, categoryId: food, amount: 3200000 })
const payment = transferOf({ occurredOn: '2026-11-25', fromAccountId: account, toAccountId: card, amount: 450000 })
const items = [lunch, salary, payment]

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

const firstPage = () => pageOf('2026-11', items, 0, 50)

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.catch((thrown: unknown) => thrown)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('거래 목록(GET /api/v1/ledgers/{ledgerId}/transactions)', () => {
  it('달과 50건을 보내고, 첫 쪽에는 cursor를 보내지 않는다', async () => {
    respondWith(firstPage())
    await fetchTransactionPage(ledgerId, '2026-11', null)
    const query = sentQueries.at(-1)!
    expect([...query.keys()].toSorted()).toEqual(['limit', 'month'])
    expect(query.get('month')).toBe('2026-11')
    expect(query.get('limit')).toBe('50')
  })

  it('다음 쪽은 받은 cursor를 해석하지 않고 그대로 보낸다', async () => {
    const cursor = 'opaque/+= 글자&month=1999-01'
    respondWith({ ...pageOf('2026-11', items, 0, 50), totals: null })
    await fetchTransactionPage(ledgerId, '2026-11', cursor)
    const query = sentQueries.at(-1)!
    expect(query.get('cursor')).toBe(cursor)
    expect(query.getAll('month')).toEqual(['2026-11'])
  })

  it('거래, 다음 cursor, 그 달의 합계, 그날 합계를 받은 그대로(순서 포함) 준다', async () => {
    const body = { ...firstPage(), nextCursor: 'next-1', totals: { income: 1, expense: 2 } }
    respondWith(body)
    const page = await fetchTransactionPage(ledgerId, '2026-11', null)
    expect(page.items.map(({ id }) => id)).toEqual(items.map(({ id }) => id))
    expect(page.items[0]).toMatchObject({
      type: 'EXPENSE',
      occurredOn: '2026-11-26',
      occurredTime: '12:30',
      accountId: account,
      categoryId: food,
      amount: 9000,
      payee: '올래국수',
      status: 'POSTED',
    })
    expect(page.items[2]).toMatchObject({ type: 'TRANSFER', fromAccountId: account, toAccountId: card })
    expect(page.nextCursor).toBe('next-1')
    expect(page.totals).toEqual({ income: 1, expense: 2 })
    expect(page.days).toEqual(body.days)
  })

  it('거래가 없는 달도 받는다. 합계는 0이다', async () => {
    respondWith({ items: [], nextCursor: null, totals: { income: 0, expense: 0 }, days: [] })
    const page = await fetchTransactionPage(ledgerId, '2026-11', null)
    expect(page).toEqual({ items: [], nextCursor: null, totals: { income: 0, expense: 0 }, days: [] })
  })

  it('다음 쪽의 합계는 없다(null)', async () => {
    respondWith({ ...firstPage(), totals: null })
    const page = await fetchTransactionPage(ledgerId, '2026-11', 'next-1')
    expect(page.totals).toBeNull()
  })

  it('취소한 거래도 받는다', async () => {
    const canceled = expenseOf({ occurredOn: '2026-11-26', accountId: account, categoryId: food, amount: 25000 }, { status: 'CANCELED' })
    respondWith(pageOf('2026-11', [canceled], 0, 50))
    const page = await fetchTransactionPage(ledgerId, '2026-11', null)
    expect(page.items[0].status).toBe('CANCELED')
  })

  it('환불이 더 큰 달과 날의 음수 합계(#390)를 그대로 받는다. 환불만 있는 날, 0원이 된 날, 달의 첫날과 마지막 날', async () => {
    const spend = (occurredOn: string) => expenseOf({ occurredOn, accountId: account, categoryId: food, amount: 1000 })
    const days = new Map([
      ['2026-11-30', { income: -3000, expense: -(2 ** 53 - 1) }],
      ['2026-11-15', { income: 0, expense: 0 }],
      ['2026-11-01', { income: 0, expense: -12000 }],
    ])
    const totals = { income: -3000, expense: -12000 }
    respondWith(pageOf('2026-11', [spend('2026-11-30'), spend('2026-11-15'), spend('2026-11-01')], 0, 50, { totals, days }))
    const page = await fetchTransactionPage(ledgerId, '2026-11', null)
    expect(page.totals).toEqual(totals)
    expect(page.days).toEqual([...days].map(([date, sums]) => ({ date, ...sums })))
  })

  it.each([null, 'REFUND', 'REIMBURSEMENT'])(
    '거래에 refund가 없고 refundKind(%s)가 있어도 받는다(서버 #8, 웹은 둘 다 읽지 않는다)',
    async (refundKind) => {
      const changed = { ...Object.fromEntries(Object.entries(lunch).filter(([key]) => key !== 'refund')), refundKind }
      respondWith({ ...firstPage(), items: [changed, salary, payment] })
      const page = await fetchTransactionPage(ledgerId, '2026-11', null)
      expect(page.items[0]).toEqual(changed)
    },
  )

  it('모르는 필드가 있어도 된다', async () => {
    const body = firstPage()
    respondWith({ ...body, added: 1, items: [{ ...lunch, added: 2 }], days: [{ ...body.days[0], added: 3 }] })
    const page = await fetchTransactionPage(ledgerId, '2026-11', null)
    expect(page.items[0].payee).toBe('올래국수')
  })

  const withItem = (fields: object) => {
    const body = firstPage()
    return { ...body, items: [lunch, { ...lunch, ...fields }] }
  }
  const withPayment = (fields: object) => ({ ...firstPage(), items: [payment, { ...payment, ...fields }] })
  const withDay = (day: object) => ({ ...firstPage(), days: [...firstPage().days, day] })

  it.each([
    ['목록이 없음', { ...firstPage(), items: undefined }],
    ['목록이 배열이 아님', { ...firstPage(), items: lunch }],
    ['거래가 null', { ...firstPage(), items: [lunch, null] }],
    ['id가 UUID가 아님', withItem({ id: '../more' })],
    ['모르는 유형', withItem({ type: 'REFUND' })],
    ['모르는 상태', withItem({ status: 'DONE' })],
    ['version이 없음', withItem({ version: undefined })],
    ['날짜가 없음', withItem({ occurredOn: undefined })],
    ['없는 날짜', withItem({ occurredOn: '2026-11-31' })],
    ['다른 달의 날짜', withItem({ occurredOn: '2026-12-01' })],
    ['시각이 없음(undefined)', withItem({ occurredTime: undefined })],
    ['시각 모양이 다름', withItem({ occurredTime: '12:30:00' })],
    ['금액이 없음', withItem({ amount: undefined })],
    ['금액이 0', withItem({ amount: 0 })],
    ['금액이 음수', withItem({ amount: -9000 })],
    ['금액이 소수', withItem({ amount: 9000.5 })],
    ['금액이 글자', withItem({ amount: '9000' })],
    ['지출의 계좌가 없음', withItem({ accountId: null })],
    ['지출의 카테고리가 없음', withItem({ categoryId: undefined })],
    ['가맹점이 글자가 아님', withItem({ payee: 1 })],
    ['이체의 보내는 계좌가 없음', withPayment({ fromAccountId: null })],
    ['이체의 받는 계좌가 없음', withPayment({ toAccountId: undefined })],
    ['다음 cursor가 없음(undefined)', { ...firstPage(), nextCursor: undefined }],
    ['다음 cursor가 빈 글자', { ...firstPage(), nextCursor: '' }],
    ['다음 cursor가 숫자', { ...firstPage(), nextCursor: 1 }],
    ['첫 쪽의 합계가 없음', { ...firstPage(), totals: null }],
    ['합계의 지출이 없음', { ...firstPage(), totals: { income: 0 } }],
    ['합계가 음수 소수', { ...firstPage(), totals: { income: 0, expense: -0.5 } }],
    ['합계가 안전한 정수 범위 밖', { ...firstPage(), totals: { income: -(2 ** 53), expense: 0 } }],
    ['그날 합계가 안전한 정수 범위 밖', withDay({ date: '2026-11-01', income: 0, expense: -(2 ** 53) })],
    ['음수인 그날 합계의 날짜가 다음 달', withDay({ date: '2026-12-01', income: 0, expense: -1 })],
    ['그날 합계가 없음', { ...firstPage(), days: undefined }],
    ['거래가 있는 날의 합계가 빠짐', { ...firstPage(), days: firstPage().days.slice(1) }],
    ['그날 합계의 날짜가 다른 달', withDay({ date: '2026-10-31', income: 0, expense: 1 })],
    ['그날 합계의 수입이 글자', withDay({ date: '2026-11-01', income: '0', expense: 1 })],
    ['그날 합계가 null', withDay(null)],
    ['묶지 않은 배열', items],
    ['null', null],
  ])('약속과 다른 응답은 서버 오류로 본다: %s', async (_, body) => {
    respondWith(body)
    expect((await failureOf(fetchTransactionPage(ledgerId, '2026-11', null))).kind).toBe('server')
  })

  it('빈 응답도 서버 오류로 본다', async () => {
    server.use(http.get(path, () => new HttpResponse(null, { status: 204 })))
    await expect(fetchTransactionPage(ledgerId, '2026-11', null)).rejects.toMatchObject({ kind: 'server' })
  })

  it('서버가 거부하면 그 오류를 그대로 던진다', async () => {
    server.use(http.get(path, () => problem(400, 'VALIDATION_FAILED')))
    await expect(fetchTransactionPage(ledgerId, '2026-11', null)).rejects.toMatchObject({
      kind: 'rejected',
      status: 400,
      code: 'VALIDATION_FAILED',
    })
  })

  it('장부 id가 UUID가 아니면 요청하지 않는다', async () => {
    const before = sentQueries.length
    expect((await failureOf(fetchTransactionPage('../me', '2026-11', null))).kind).toBe('server')
    expect(sentQueries).toHaveLength(before)
  })
})
